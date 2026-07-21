"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import {
  Loader2,
  ImageIcon,
  VideoIcon,
  MessageCircle,
  Clock,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  XCircle,

  History,

} from "lucide-react";
import { FrameReferencePicker } from "./frame-reference-picker";
import { formatChainSourceHint, type FrameReferenceType } from "@/lib/storyboard/frame-reference";
import { getShotVideoReadiness, resolveShotNextStep } from "@/lib/storyboard/shot-video-readiness";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { Scissors } from "lucide-react";
import { useShotFrameActions } from "@/hooks/use-shot-frame-actions";
import { ShotFrameToolbar } from "./shot-frame-toolbar";
import { ShotFrameAssets } from "./shot-frame-assets";
import { ShotVideoHistoryDialog } from "./shot-video-history-dialog";
import { ShotExternalFrameHelper } from "./shot-external-frame-helper";
import { ShotRestoreFromScriptButton } from "./shot-restore-from-script-button";
import { RemoteVideoRecoveryHint } from "./remote-video-recovery-hint";
import { ShotVideoEnhanceButton } from "./shot-video-enhance-button";

interface Dialogue {
  id: string;
  text: string;
  characterName: string;
}

interface ShotCardProps {
  id: string;
  projectId: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  anchorFirst: string | null;
  anchorLastAi: string | null;
  /** Seedance 视频真实尾帧（生成视频后写入） */
  cutPoint?: string | null;
  videoUrl: string | null;
  remoteVideoUrl?: string | null;
  remoteVideoStatus?: string | null;
  remoteVideoExpiresAt?: string | Date | null;
  remoteVideoLastDownloadAt?: string | Date | null;
  videoPrompt?: string | null;
  status: string;
  dialogues: Dialogue[];
  onUpdate: () => void;
  episodeId?: string;
  /** 本集第一镜且存在上一集时显示「承接上一集尾帧」 */
  showAdoptPrevEpisode?: boolean;
  videoRatio?: string;
  versionId?: string | null;
  isCompact?: boolean;
  onOpenDrawer?: (id: string) => void;
  batchGeneratingVideoPrompts?: boolean;
  warnings?: string | null;
  videoResolution?: string | null;
  /** 生成视频时使用的分辨率，传递给后端 */
  videoGenerationResolution?: "480p" | "720p";
  /** 上一镜视频切点 cut_point（参考用） */
  prevCutPoint?: string | null;
  /** 上一镜 AI 尾帧 anchor_last_ai（参考用） */
  prevAnchorLastAi?: string | null;
  /** 上一镜 id，用于承接后进入 strict initialImage 链源模式 */
  prevChainFrameShotId?: string | null;
  /** 上一镜实际承接帧类型：优先 cut_point，其次 anchor_last_ai */
  prevChainFrameType?: FrameReferenceType | null;
  /** 同版本其他分镜（用于首帧参考图选择器） */
  frameRefShots?: Array<{
    id: string;
    sequence: number;
    anchorFirst?: string | null;
    anchorLastAi?: string | null;
    cutPoint?: string | null;
  }>;
  chainSourceShotId?: string | null;
  chainSourceType?: string | null;
  chainSourceSequence?: number | null;
  /** "strict_start"=像素级严格首帧承接；"reference_redraw"/null=普通。决定视频生成用 initialImage 还是 multimodal 模式 */
  anchorFirstContinuityMode?: string | null;
  /** Track 分组标识（Seedance 多参模式批量生成用） */
  track?: string | null;
  /** 本镜命名角色数量（用于动态计算用户可手选的参考图上限） */
  namedCharacterCount?: number;
  /** 分镜级道具绑定（JSON 数组字符串，存 character_assets.id） */
  propRefs?: string | null;
  /** 本镜角色的 prop 类型资产（由 storyboard/page.tsx 传入） */
  availablePropAssets?: Array<{ id: string; imagePath: string | null; tag: string; characterName: string }>;
}

type StepState = "done" | "generating" | "error" | "idle";

function StepIndicator({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
  if (state === "generating") return <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />;
  if (state === "error") return <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />;
  return <Circle className="h-4 w-4 text-[--text-muted] flex-shrink-0" />;
}

function StepRow({
  label,
  state,
  children,
  defaultOpen = false,
  isNext = false,
}: {
  label: string;
  state: StepState;
  children: React.ReactNode;
  defaultOpen?: boolean;
  isNext?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || isNext);

  return (
    <div className={`rounded-xl border transition-colors ${
      isNext
        ? "border-primary/30 bg-primary/3"
        : state === "done"
          ? "border-emerald-100 bg-emerald-50/40"
          : state === "error"
            ? "border-destructive/20 bg-destructive/3"
            : "border-[--border-subtle] bg-[--surface]/50"
    }`}>
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <StepIndicator state={state} />
        <span className={`flex-1 text-[13px] font-medium ${
          isNext ? "text-primary" : state === "done" ? "text-emerald-700" : "text-[--text-secondary]"
        }`}>
          {label}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-[--text-muted]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-[--text-muted]" />
        )}
      </button>
      {open && (
        <div className="border-t border-[--border-subtle] px-3 pb-3 pt-2.5">
          {children}
        </div>
      )}
    </div>
  );
}

export function ShotCard({
  id,
  projectId,
  sequence,
  prompt,
  startFrameDesc,
  endFrameDesc,
  motionScript,
  cameraDirection,
  duration,
  anchorFirst,
  anchorLastAi,
  cutPoint,
  videoUrl,
  remoteVideoUrl,
  remoteVideoStatus,
  remoteVideoExpiresAt,
  remoteVideoLastDownloadAt,
  videoPrompt,
  status,
  dialogues,
  onUpdate,
  episodeId,
  showAdoptPrevEpisode = false,
  videoRatio = "16:9",
  versionId = null,
  isCompact = false,
  onOpenDrawer,
  batchGeneratingVideoPrompts = false,
  warnings,
  videoResolution,
  videoGenerationResolution,
  prevCutPoint,
  prevAnchorLastAi,
  prevChainFrameShotId,
  prevChainFrameType,
  frameRefShots = [],
  chainSourceShotId,
  chainSourceType,
  chainSourceSequence,
  anchorFirstContinuityMode,
  track,
  namedCharacterCount = 0,
  propRefs,
  availablePropAssets = [],
}: ShotCardProps) {
  const t = useTranslations();
  const videoReadiness = getShotVideoReadiness(
    { anchorFirst, anchorLastAi, chainSourceShotId, anchorFirstContinuityMode }
  );
  const canGenerateVideo = videoReadiness.ready;
  const chainSourceHint = formatChainSourceHint(chainSourceSequence, chainSourceType);
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const frameActions = useShotFrameActions({
    projectId,
    shotId: id,
    episodeId,
    videoRatio,
    versionId,
    frameRefShots,
    prevCutPoint,
    prevAnchorLastAi,
    prevChainFrameShotId,
    prevChainFrameType,
    namedCharacterCount,
    onUpdate,
  });
  const videoModelMax = getModelMaxDuration(getModelConfig().video?.modelId);
  const [splittingShot, setSplittingShot] = useState(false);

  // Edit state
  const [editPrompt, setEditPrompt] = useState(prompt);
  const [editStartFrame, setEditStartFrame] = useState(startFrameDesc ?? "");
  const [editEndFrame, setEditEndFrame] = useState(endFrameDesc ?? "");
  const [editMotionScript, setEditMotionScript] = useState(motionScript ?? "");
  const [editVideoPrompt, setEditVideoPrompt] = useState(videoPrompt ?? "");
  const [editCameraDirection, setEditCameraDirection] = useState(cameraDirection ?? "static");
  const [editDuration, setEditDuration] = useState(duration);
  // 道具参考图本地选中态（乐观更新）
  const [localPropRefs, setLocalPropRefs] = useState<string[]>(() => {
    try { return propRefs ? JSON.parse(propRefs) : []; } catch { return []; }
  });

  // Derived: is the stored duration over the selected video model's limit?
  const durationOverLimit = editDuration > videoModelMax;

  useEffect(() => { setEditPrompt(prompt); }, [prompt]);
  useEffect(() => { setEditStartFrame(startFrameDesc ?? ""); }, [startFrameDesc]);
  useEffect(() => { setEditEndFrame(endFrameDesc ?? ""); }, [endFrameDesc]);
  useEffect(() => { setEditMotionScript(motionScript ?? ""); }, [motionScript]);
  useEffect(() => { setEditVideoPrompt(videoPrompt ?? ""); }, [videoPrompt]);
  useEffect(() => {
    try { setLocalPropRefs(propRefs ? JSON.parse(propRefs) : []); } catch { setLocalPropRefs([]); }
  }, [id, propRefs]);
  useEffect(() => { setEditCameraDirection(cameraDirection ?? "static"); }, [cameraDirection]);
  useEffect(() => { setEditDuration(duration); }, [duration]);

  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [splitingContent, setSplitingContent] = useState(false);
  const [videoHistoryOpen, setVideoHistoryOpen] = useState(false);
  // UI state
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close, { once: true });
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  const videoGuard = useModelGuard("video");

  // Derived state
  const hasText = !!(prompt || startFrameDesc || motionScript);
  const hasFrame = !!(anchorFirst || anchorLastAi || cutPoint);
  const hasVideoPrompt = !!videoPrompt;
  const hasVideo = !!videoUrl;
  const isGenerating = status === "generating";

  // Step states
  const textState: StepState = hasText ? "done" : "idle";
  const frameState: StepState =
    frameActions.generatingFrames ? "generating"
    : status === "failed" && !hasFrame ? "error"
    : hasFrame ? "done" : "idle";
  const promptState: StepState = generatingPrompt || batchGeneratingVideoPrompts ? "generating" : hasVideoPrompt ? "done" : "idle";
  const videoState: StepState =
    generatingVideo || (isGenerating && !hasVideo) ? "generating"
    : status === "failed" && !hasVideo ? "error"
    : hasVideo ? "done" : "idle";

  // Which step is "next"（红色高亮，纯引导性建议，不驱动 disabled；与 shot-drawer.tsx 共用同一份判断）
  const nextStep = resolveShotNextStep({ anchorFirst, anchorLastAi, cutPoint, videoPrompt, videoUrl });

  async function patchShot(fields: Record<string, unknown>) {
    await apiFetch(`/api/projects/${projectId}/shots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function handleSplitShot() {
    if (!durationOverLimit) return;
    setSplittingShot(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots/${id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxDuration: videoModelMax }),
      });
      const data = await res.json();
      toast.success(`已拆分为 ${data.splits} 个镜头（每个 ≤${videoModelMax}s）`);
      onUpdate();
    } catch (err) {
      toast.error("拆分失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSplittingShot(false);
    }
  }

  async function handleGenerateVideoPrompt() {
    setGeneratingPrompt(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_prompt",
          payload: { shotId: id },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingPrompt(false);
  }

  async function handleGenerateVideo() {
    if (!videoGuard()) return;
    if (!canGenerateVideo) {
      toast.error(!videoReadiness.ready ? videoReadiness.message : t("common.generationFailed"));
      return;
    }
    setGeneratingVideo(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_generate",
          payload: {
            shotId: id,
            ratio: videoRatio,
            ...(videoGenerationResolution && { resolution: videoGenerationResolution }),
          },
          modelConfig: getModelConfig(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || t("common.generationFailed"));
      }
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingVideo(false);
  }
  async function handleContentSplit() {
    setSplitingContent(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "split_shot",
          payload: { shotId: id },
          modelConfig: getModelConfig(),
        }),
      });
      toast.success("已拆分为两个连续分镜");
      onUpdate();
    } catch (err) {
      toast.error("拆分失败：" + (err instanceof Error ? err.message : String(err)));
    }
    setSplitingContent(false);
  }

  function handleCopyPrompt() {
    const text = videoPrompt || `${motionScript || prompt}\nCamera: ${cameraDirection}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Progress dots: how many steps done out of 4
  if (isCompact) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-[--border-subtle] bg-white px-3 py-2 cursor-pointer hover:border-primary/30 hover:bg-primary/2 transition-colors"
        onClick={() => onOpenDrawer?.(id)}
      >
        {/* Sequence */}
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/8 font-mono text-xs font-bold text-primary">
          {sequence}
        </div>
        {/* Thumbnails */}
        <div className="flex gap-1">
          {[anchorFirst, anchorLastAi, cutPoint, videoUrl].map((src, i) => {
            const isVid = i === 3;
            return (
              <div key={i} className="h-8 w-11 flex-shrink-0 overflow-hidden rounded-md border border-[--border-subtle] bg-[--surface]">
                {src ? (
                  isVid
                    ? <video className="h-full w-full object-cover" src={uploadUrl(src)} />
                    : <img src={uploadUrl(src)} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {isVid
                      ? <VideoIcon className="h-3 w-3 text-[--text-muted]" />
                      : <ImageIcon className="h-3 w-3 text-[--text-muted]" />
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Scene text */}
        <p className="flex-1 truncate text-xs text-[--text-secondary]">{prompt}</p>
        {/* Progress dots */}
        <div className="flex items-center gap-1">
          {[hasText, hasFrame, hasVideoPrompt, hasVideo].map((done, i) => (
            <div key={i} className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-[--border-subtle]"}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[--border-subtle] bg-white transition-colors hover:border-[--border-hover]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Sequence + Track badge */}
        <div className="flex flex-col items-center gap-0.5">
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/8 font-mono text-sm font-bold text-primary cursor-pointer hover:bg-primary/15 transition-colors"
            onClick={() => onOpenDrawer?.(id)}
            title="Open editor"
          >
            {sequence}
          </div>
          {track && (
            <span className="rounded bg-violet-100 px-1 py-0.5 text-[8px] font-bold text-violet-700 leading-none">
              {track}
            </span>
          )}
        </div>

        {/* Media thumbnails */}
        <div className="flex gap-1.5">
          {[anchorFirst, anchorLastAi, cutPoint, videoUrl].map((src, i) => {
            const isVideo = i === 3;
            return (
              <div
                key={i}
                className={`h-12 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-[--border-subtle] ${src ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                onClick={() => src && setPreviewSrc(uploadUrl(src))}
              >
                {src ? (
                  isVideo ? (
                    <video className="h-full w-full object-cover" src={uploadUrl(src)} />
                  ) : (
                    <img src={uploadUrl(src)} className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[--surface]">
                    {isVideo
                      ? <VideoIcon className="h-3.5 w-3.5 text-[--text-muted]" />
                      : <ImageIcon className="h-3.5 w-3.5 text-[--text-muted]" />
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Scene summary + meta */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[--text-primary]">{prompt}</p>
          <div className="mt-1 flex items-center gap-2">
            {/* Duration */}
            <span className={`flex items-center gap-1 text-xs rounded px-1 -mx-1 ${durationOverLimit ? "text-orange-600" : "text-[--text-muted]"}`}>
              <Clock className="h-3 w-3" />
              <input
                type="number"
                min={5}
                max={videoModelMax}
                value={editDuration}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Math.min(videoModelMax, Math.max(5, Number(e.target.value)));
                  setEditDuration(v);
                  patchShot({ duration: v });
                }}
                className={`w-9 rounded border px-1 py-0.5 text-center text-[11px] font-medium outline-none ${
                  durationOverLimit
                    ? "border-orange-400 bg-orange-50 text-orange-700 focus:border-orange-500"
                    : "border-[--border-subtle] bg-white text-[--text-primary] focus:border-primary/50"
                }`}
              />
              <span className="text-[11px]">s</span>
              {durationOverLimit && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleSplitShot(); }}
                  disabled={splittingShot}
                  title={`时长超过模型上限 ${videoModelMax}s，点击自动拆分`}
                  className="ml-0.5 flex items-center gap-0.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50 transition-colors"
                >
                  {splittingShot
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Scissors className="h-3 w-3" />}
                  拆分
                </button>
              )}
            </span>
            {dialogues.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-[--text-muted]">
                <MessageCircle className="h-3 w-3" />
                {dialogues.length}
              </span>
            )}
            {/* Pipeline progress dots */}
            <div className="flex items-center gap-1 ml-1">
              {[hasText, hasFrame, hasVideoPrompt, hasVideo].map((done, i) => (
                <div key={i} className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-[--border-subtle]"}`} />
              ))}
            </div>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopyPrompt}
            title={t("shot.copyPrompt")}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Warnings */}
      {warnings && (
        <div className="mx-4 mt-1 mb-2 flex items-start gap-2 rounded-lg bg-amber-50/70 px-3 py-2 border border-amber-100">
          <Sparkles className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-amber-800">资产不全提醒</p>
            <p className="text-[10.5px] leading-relaxed text-amber-700/90">{warnings}</p>
          </div>
        </div>
      )}

      {/* ── Pipeline Steps ── */}
      <div className="space-y-2 border-t border-[--border-subtle] px-4 pb-3 pt-3">

        {/* Step 1: 分镜描述 */}
        <StepRow
          label={t("shot.stepDesc")}
          state={textState}
          defaultOpen={false}
        >
          <div className="space-y-2.5">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.sceneDescription")}</p>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onBlur={async () => { await patchShot({ prompt: editPrompt }); onUpdate(); }}
                rows={2}
                placeholder={t("shot.prompt")}
              />
            </div>
            <>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-500">{t("shot.startFrame")}</p>
                  <Textarea
                    value={editStartFrame}
                    onChange={(e) => setEditStartFrame(e.target.value)}
                    onBlur={async () => { await patchShot({ startFrameDesc: editStartFrame }); onUpdate(); }}
                    rows={2}
                    placeholder={t("shot.startFrame")}
                    className="border-blue-200 bg-blue-50/30 text-sm"
                  />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-500">{t("shot.endFrame")}</p>
                  <Textarea
                    value={editEndFrame}
                    onChange={(e) => setEditEndFrame(e.target.value)}
                    onBlur={async () => { await patchShot({ endFrameDesc: editEndFrame }); onUpdate(); }}
                    rows={2}
                    placeholder={t("shot.endFrame")}
                    className="border-amber-200 bg-amber-50/30 text-sm"
                  />
                </div>
            </>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-600">{t("shot.motionScript")}</p>
              <Textarea
                value={editMotionScript}
                onChange={(e) => setEditMotionScript(e.target.value)}
                onBlur={async () => { await patchShot({ motionScript: editMotionScript }); onUpdate(); }}
                rows={2}
                placeholder={t("shot.motionScript")}
                className="border-emerald-200 bg-emerald-50/30 text-sm"
              />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.cameraDirection")}</p>
              <input
                value={editCameraDirection}
                onChange={(e) => setEditCameraDirection(e.target.value)}
                onBlur={async () => { await patchShot({ cameraDirection: editCameraDirection }); onUpdate(); }}
                className="w-full rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-sm outline-none focus:border-primary/50"
                placeholder="static / pan-left / zoom-in ..."
              />
            </div>
            {/* 台词：只读展示，由剧本解析写入，不支持手动编辑 */}
            {dialogues.length > 0 && (
              <div className="rounded-xl border border-[--border-subtle] bg-[--surface] p-3 space-y-1.5">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
                  <MessageCircle className="h-3 w-3" />
                  台词
                </p>
                {dialogues.map((d) => {
                  const dtype = (d as { type?: string }).type ?? "dialogue";
                  const typeLabel: Record<string, string> = { dialogue: "对白", os: "OS", vo: "VO" };
                  return (
                    <p key={d.id} className="text-[12px]">
                      <span className="font-semibold text-primary">{d.characterName}</span>
                      {dtype !== "dialogue" && (
                        <span className="mx-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700">{typeLabel[dtype]}</span>
                      )}
                      <span className="mx-1.5 text-[--text-muted]">—</span>
                      <span className="text-[--text-secondary]">{d.text}</span>
                    </p>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">

              <div className="flex flex-col gap-0.5">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleContentSplit}
                  disabled={splitingContent}
                  title="AI 将此分镜拆成两个连续分镜（用于角色中途入镜等首帧锚点问题）"
                >
                  {splitingContent ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                  {splitingContent ? "拆分中…" : "AI 拆分分镜"}
                </Button>
                <p className="text-[9px] text-[--text-muted] leading-tight px-0.5">
                  适用：角色中途入镜、首帧无法锚定主体
                </p>
              </div>
              <ShotRestoreFromScriptButton
                projectId={projectId}
                shotId={id}
                onRestored={onUpdate}
                disabled={splitingContent}
              />
            </div>
          </div>
        </StepRow>

        {/* Step 2: 帧 */}
        <StepRow
          label={t("shot.stepFrames")}
          state={frameState}
          isNext={nextStep === "frame"}
        >
          {chainSourceHint && (
            <div className="mb-2 flex items-center gap-2 flex-wrap rounded-lg bg-amber-50/60 border border-amber-100 px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-amber-700 flex-1">{chainSourceHint}</span>
              <Button
                size="xs"
                variant="ghost"
                onClick={frameActions.handleGenerateFirstFrameFresh}
                disabled={frameActions.frameActionsBusy || generatingVideo}
                title="忽略继承，根据当前首帧描述 + 本镜定妆图重新生成"
                className="h-5 px-1.5 text-[10px] text-amber-700 hover:bg-amber-100 hover:text-amber-900"
              >
                {frameActions.generatingFrames && frameActions.generatingFrameTarget === "first"
                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  : <RefreshCw className="h-2.5 w-2.5" />}
                刷新首帧
              </Button>
            </div>
          )}
          <ShotFrameAssets
            projectId={projectId}
            shotId={id}
            anchorFirst={anchorFirst}
            anchorLastAi={anchorLastAi}
            cutPoint={cutPoint}
            onPreview={setPreviewSrc}
            onUpdate={onUpdate}
            generatingFrames={frameActions.generatingFrames}
            generatingFrameTarget={frameActions.generatingFrameTarget}
            onGenerateOneFrame={frameActions.handleGenerateOneFrame}
            disabled={generatingVideo}
          />
          <div className="mt-2 space-y-1.5">
            <ShotFrameToolbar
              hasFrame={hasFrame}
              frameRefShotsCount={frameRefShots.length}
              showAdoptPrevEpisode={showAdoptPrevEpisode}
              prevChainFrame={frameActions.prevChainFrame}
              prevChainFrameSource={frameActions.prevChainFrameSource}
              generatingFrames={frameActions.generatingFrames}
              adoptingPrevEpisode={frameActions.adoptingPrevEpisode}
              adoptingPrevFrame={frameActions.adoptingPrevFrame}
              disabled={generatingVideo}
              onGenerateFrames={frameActions.handleGenerateFirstFrameFresh}
              onPickReference={() => frameActions.openFrameReferencePicker("first")}
              onAdoptPrevEpisode={frameActions.handleAdoptPrevEpisodeFrame}
              onAdoptPrevChain={frameActions.handleAdoptPrevChainFrame}
              trailing={
                <ShotExternalFrameHelper
                  projectId={projectId}
                  shotId={id}
                  disabled={frameActions.frameActionsBusy || generatingVideo}
                />
              }
            />

            {/* 道具参考图（分镜级手动绑定，有 prop 资产时显示） */}
            {availablePropAssets.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">道具参考图</p>
                <div className="flex flex-wrap gap-1.5">
                  {availablePropAssets.map((prop) => {
                    const isSelected = localPropRefs.includes(prop.id);
                    const toggle = async () => {
                      const next = isSelected
                        ? localPropRefs.filter((x) => x !== prop.id)
                        : [...localPropRefs, prop.id];
                      setLocalPropRefs(next);
                      await patchShot({ propRefs: JSON.stringify(next) });
                      onUpdate();
                    };
                    return (
                      <button
                        key={prop.id}
                        type="button"
                        title={`${prop.characterName} · ${prop.tag || "道具"}`}
                        onClick={toggle}
                        className={`relative h-10 w-10 overflow-hidden rounded-lg border-2 transition-all ${
                          isSelected
                            ? "border-amber-400 ring-1 ring-amber-300"
                            : "border-[--border-subtle] opacity-50 hover:opacity-100"
                        }`}
                      >
                        {prop.imagePath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={uploadUrl(prop.imagePath)} alt={prop.tag} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-[--surface-alt] text-[7px] text-[--text-muted]">无图</div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-x-0 bottom-0 bg-amber-400/80 text-center text-[7px] font-bold text-white leading-tight">✓</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </StepRow>

        {/* Step 3: 视频提示词 */}
        <StepRow
          label={t("shot.stepVideoPrompt")}
          state={promptState}
          isNext={nextStep === "prompt"}
        >
          {hasVideoPrompt && (
            <Textarea
              value={editVideoPrompt}
              onChange={(e) => setEditVideoPrompt(e.target.value)}
              onBlur={async () => { await patchShot({ videoPrompt: editVideoPrompt }); onUpdate(); }}
              className="mb-2 min-h-[5rem] resize-none font-mono text-xs leading-relaxed"
            />
          )}
          <Button
            size="xs"
            variant={nextStep === "prompt" ? "default" : "outline"}
            onClick={handleGenerateVideoPrompt}
            disabled={generatingPrompt || batchGeneratingVideoPrompts}
          >
            {(generatingPrompt || batchGeneratingVideoPrompts) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {(generatingPrompt || batchGeneratingVideoPrompts)
              ? t("common.generating")
              : hasVideoPrompt ? t("shot.regeneratePrompt") : t("shot.generateVideoPrompt")
            }
          </Button>
        </StepRow>

        {/* Step 4: 视频 */}
        <StepRow
          label={t("shot.stepVideo")}
          state={videoState}
          isNext={nextStep === "video"}
        >
          {hasVideo && (
            <div
              className="group relative mb-2.5 w-full overflow-hidden rounded-xl border border-[--border-subtle] bg-black cursor-pointer"
              style={{ aspectRatio: "16/9" }}
              onClick={() => setPreviewSrc(uploadUrl(videoUrl!))}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
            >
              <video className="h-full w-full object-contain" src={uploadUrl(videoUrl!)} />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
                  <VideoIcon className="h-4 w-4 text-[--text-primary] translate-x-0.5" />
                </div>
              </div>
              {/* Resolution badge */}
              {videoResolution && (
                <div className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  videoResolution === "720p"
                    ? "bg-emerald-600/90 text-white"
                    : "bg-amber-500/90 text-white"
                }`}>
                  {videoResolution}
                </div>
              )}
              {/* 右键提示角标 */}
              <div className="absolute bottom-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white/70">右键查看历史版本</span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <RemoteVideoRecoveryHint
              remoteVideoUrl={remoteVideoUrl}
              remoteVideoStatus={remoteVideoStatus}
              remoteVideoExpiresAt={remoteVideoExpiresAt}
              remoteVideoLastDownloadAt={remoteVideoLastDownloadAt}
              hasLocalVideo={hasVideo}
            />
            <Button
              size="xs"
              variant={nextStep === "video" ? "default" : "outline"}
              onClick={handleGenerateVideo}
              disabled={generatingVideo || isGenerating || !canGenerateVideo}
              title={!canGenerateVideo && !videoReadiness.ready ? videoReadiness.message : undefined}
            >
              {(generatingVideo || (isGenerating && !hasVideo))
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <VideoIcon className="h-3 w-3" />
              }
              {(generatingVideo || (isGenerating && !hasVideo))
                ? t("common.generating")
                : hasVideo ? t("shot.regenerateVideo") : t("project.generateVideo")
              }
              {videoGenerationResolution && (
                <span className="ml-1 rounded bg-white/20 px-1 text-[10px] font-bold">{videoGenerationResolution}</span>
              )}
            </Button>
            <ShotVideoEnhanceButton
              projectId={projectId}
              shotId={id}
              videoUrl={videoUrl}
              videoResolution={videoResolution}
              onEnhanced={onUpdate}
              disabled={generatingVideo || isGenerating}
            />
          </div>
        </StepRow>

      </div>

      {/* Preview lightbox */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {previewSrc.match(/\.(mp4|webm|mov)/) ? (
              <video src={previewSrc} controls autoPlay className="max-h-[85vh] rounded-xl" />
            ) : (
              <img src={previewSrc} alt="Preview" className="max-h-[85vh] rounded-xl" />
            )}
            <button
              onClick={() => setPreviewSrc(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-sm font-bold shadow-lg hover:scale-110 transition-transform"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          className="fixed z-[100] min-w-[140px] rounded-lg border border-[--border-subtle] bg-white py-1 shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[--text-primary] hover:bg-[--surface] transition-colors"
            onClick={() => {
              setCtxMenu(null);
              setVideoHistoryOpen(true);
            }}
          >
            <History className="h-3.5 w-3.5 text-[--text-muted]" />
            版本历史
          </button>
        </div>
      )}

      <ShotVideoHistoryDialog
        open={videoHistoryOpen}
        onOpenChange={setVideoHistoryOpen}
        projectId={projectId}
        shotId={id}
        onReverted={onUpdate}
      />

      <FrameReferencePicker
        open={frameActions.frameRefPickerOpen}
        onOpenChange={frameActions.setFrameRefPickerOpen}
        shots={frameRefShots}
        currentShotId={id}
        frameTarget={frameActions.pendingFrameTarget === "last" ? "last" : "first"}
        onConfirm={frameActions.handleFrameReferenceConfirm}
        maxSelectable={frameActions.crossShotRefLimit}
      />
    </div>
  );
}
