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
  Trash2,
  History,
  Plus,
} from "lucide-react";
import { AiOptimizeButton } from "./ai-optimize-button";
import { FrameReferencePicker } from "./frame-reference-picker";
import { formatChainSourceHint } from "@/lib/storyboard/frame-reference";
import { describeShotAutoLinkToast, type ShotAutoLinkResult } from "@/lib/storyboard/shot-auto-link-messages";
import { getShotVideoReadiness } from "@/lib/storyboard/shot-video-readiness";
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
  videoScript: string | null;
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
  /** 是否开启 AI Prompt 增强（透传给生成 API） */
  enhancePrompts?: boolean;
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
  /** 群演镜头（无命名角色）— 影响视频/尾帧校验 */
  isCrowdShot?: boolean;
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
  videoScript,
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
  enhancePrompts = false,
  frameRefShots = [],
  chainSourceShotId,
  chainSourceType,
  chainSourceSequence,
  isCrowdShot = false,
}: ShotCardProps) {
  const t = useTranslations();
  const videoReadiness = getShotVideoReadiness(
    { anchorFirst, anchorLastAi },
    isCrowdShot
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
    enhancePrompts,
    frameRefShots,
    prevCutPoint,
    prevAnchorLastAi,
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

  // Derived: is the stored duration over the selected video model's limit?
  const durationOverLimit = editDuration > videoModelMax;

  useEffect(() => { setEditPrompt(prompt); }, [prompt]);
  useEffect(() => { setEditStartFrame(startFrameDesc ?? ""); }, [startFrameDesc]);
  useEffect(() => { setEditEndFrame(endFrameDesc ?? ""); }, [endFrameDesc]);
  useEffect(() => { setEditMotionScript(motionScript ?? ""); }, [motionScript]);
  useEffect(() => { setEditVideoPrompt(videoPrompt ?? ""); }, [videoPrompt]);
  useEffect(() => { setEditCameraDirection(cameraDirection ?? "static"); }, [cameraDirection]);
  useEffect(() => { setEditDuration(duration); }, [duration]);

  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [rewritingText, setRewritingText] = useState(false);
  const [videoHistoryOpen, setVideoHistoryOpen] = useState(false);

  // 台词编辑状态
  type EditDialogue = { id?: string; characterName: string; text: string };
  const [editingDialogues, setEditingDialogues] = useState(false);
  const [editDialogues, setEditDialogues] = useState<EditDialogue[]>(
    dialogues.map((d) => ({ id: d.id, characterName: d.characterName, text: d.text }))
  );
  const [savingDialogues, setSavingDialogues] = useState(false);
  useEffect(() => {
    setEditDialogues(dialogues.map((d) => ({ id: d.id, characterName: d.characterName, text: d.text })));
  }, [dialogues]);

  async function handleSaveDialogues() {
    setSavingDialogues(true);
    try {
      await patchShot({ dialogues: editDialogues });
      setEditingDialogues(false);
      onUpdate();
      toast.success("台词已保存");
    } catch (err) {
      toast.error("保存台词失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingDialogues(false);
    }
  }

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
  const textState: StepState = rewritingText ? "generating" : hasText ? "done" : "idle";
  const frameState: StepState =
    frameActions.generatingFrames ? "generating"
    : status === "failed" && !hasFrame ? "error"
    : hasFrame ? "done" : "idle";
  const promptState: StepState = generatingPrompt || batchGeneratingVideoPrompts ? "generating" : hasVideoPrompt ? "done" : "idle";
  const videoState: StepState =
    generatingVideo || (isGenerating && !hasVideo) ? "generating"
    : status === "failed" && !hasVideo ? "error"
    : hasVideo ? "done" : "idle";

  // Which step is "next"
  const nextStep = !hasFrame ? "frame" : !hasVideoPrompt ? "prompt" : !hasVideo ? "video" : null;

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
          enhancePrompts,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        shotLink?: ShotAutoLinkResult;
      };
      if (!res.ok) {
        throw new Error(data.error || t("common.generationFailed"));
      }
      const linkToast = describeShotAutoLinkToast(data.shotLink, sequence);
      if (linkToast) {
        if (linkToast.variant === "success") toast.success(linkToast.message);
        else toast.info(linkToast.message);
      }
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingVideo(false);
  }

  async function handleRewriteText() {
    setRewritingText(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_shot_rewrite",
          payload: { shotId: id },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setRewritingText(false);
  }

  function handleCopyPrompt() {
    const text = videoPrompt || `${videoScript || motionScript || prompt}\nCamera: ${cameraDirection}`;
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
        {/* Sequence */}
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/8 font-mono text-sm font-bold text-primary cursor-pointer hover:bg-primary/15 transition-colors"
          onClick={() => onOpenDrawer?.(id)}
          title="Open editor"
        >
          {sequence}
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
              <div className="mb-1 flex items-center gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.sceneDescription")}</p>
                <AiOptimizeButton
                  value={editPrompt}
                  onOptimized={(v) => { setEditPrompt(v); patchShot({ prompt: v }); }}
                  fieldLabel="sceneDescription"
                  projectId={projectId}
                />
              </div>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onBlur={() => patchShot({ prompt: editPrompt })}
                rows={2}
                placeholder={t("shot.prompt")}
              />
            </div>
            <>
                <div>
                  <div className="mb-1 flex items-center gap-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-500">{t("shot.startFrame")}</p>
                    <AiOptimizeButton
                      value={editStartFrame}
                      onOptimized={(v) => { setEditStartFrame(v); patchShot({ startFrameDesc: v }); }}
                      fieldLabel="startFrame"
                      projectId={projectId}
                    />
                  </div>
                  <Textarea
                    value={editStartFrame}
                    onChange={(e) => setEditStartFrame(e.target.value)}
                    onBlur={() => patchShot({ startFrameDesc: editStartFrame })}
                    rows={2}
                    placeholder={t("shot.startFrame")}
                    className="border-blue-200 bg-blue-50/30 text-sm"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-500">{t("shot.endFrame")}</p>
                    <AiOptimizeButton
                      value={editEndFrame}
                      onOptimized={(v) => { setEditEndFrame(v); patchShot({ endFrameDesc: v }); }}
                      fieldLabel="endFrame"
                      projectId={projectId}
                    />
                  </div>
                  <Textarea
                    value={editEndFrame}
                    onChange={(e) => setEditEndFrame(e.target.value)}
                    onBlur={() => patchShot({ endFrameDesc: editEndFrame })}
                    rows={2}
                    placeholder={t("shot.endFrame")}
                    className="border-amber-200 bg-amber-50/30 text-sm"
                  />
                </div>
            </>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-600">{t("shot.motionScript")}</p>
                <AiOptimizeButton
                  value={editMotionScript}
                  onOptimized={(v) => { setEditMotionScript(v); patchShot({ motionScript: v }); }}
                  fieldLabel="motionScript"
                  projectId={projectId}
                />
              </div>
              <Textarea
                value={editMotionScript}
                onChange={(e) => setEditMotionScript(e.target.value)}
                onBlur={() => patchShot({ motionScript: editMotionScript })}
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
                onBlur={() => patchShot({ cameraDirection: editCameraDirection })}
                className="w-full rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-sm outline-none focus:border-primary/50"
                placeholder="static / pan-left / zoom-in ..."
              />
            </div>
            {/* 台词区域 */}
            <div className="rounded-xl border border-[--border-subtle] bg-[--surface] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
                  <MessageCircle className="h-3 w-3" />
                  台词
                </p>
                {!editingDialogues ? (
                  <button
                    onClick={() => {
                      setEditDialogues(dialogues.map((d) => ({ id: d.id, characterName: d.characterName, text: d.text })));
                      setEditingDialogues(true);
                    }}
                    className="text-[10px] text-primary hover:underline"
                  >
                    编辑
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setEditingDialogues(false)} className="text-[10px] text-[--text-muted] hover:underline">取消</button>
                    <button onClick={handleSaveDialogues} disabled={savingDialogues} className="text-[10px] text-primary font-semibold hover:underline disabled:opacity-50">
                      {savingDialogues ? "保存中…" : "保存"}
                    </button>
                  </div>
                )}
              </div>
              {!editingDialogues ? (
                dialogues.length > 0 ? (
                  dialogues.map((d) => (
                    <p key={d.id} className="text-[12px]">
                      <span className="font-semibold text-primary">{d.characterName}</span>
                      <span className="mx-1.5 text-[--text-muted]">—</span>
                      <span className="text-[--text-secondary]">{d.text}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-[11px] text-[--text-muted]">无台词，点「编辑」可添加</p>
                )
              ) : (
                <div className="space-y-2">
                  {editDialogues.map((d, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <input
                        value={d.characterName}
                        onChange={(e) => {
                          const next = [...editDialogues];
                          next[i] = { ...next[i], characterName: e.target.value };
                          setEditDialogues(next);
                        }}
                        placeholder="角色名"
                        className="w-20 shrink-0 rounded border border-[--border-subtle] bg-white px-1.5 py-1 text-[11px] font-semibold text-primary outline-none focus:border-primary/50"
                      />
                      <textarea
                        value={d.text}
                        onChange={(e) => {
                          const next = [...editDialogues];
                          next[i] = { ...next[i], text: e.target.value };
                          setEditDialogues(next);
                        }}
                        rows={2}
                        placeholder="台词内容"
                        className="flex-1 rounded border border-[--border-subtle] bg-white px-1.5 py-1 text-[11px] text-[--text-secondary] outline-none focus:border-primary/50 resize-none"
                      />
                      <button
                        onClick={() => setEditDialogues(editDialogues.filter((_, j) => j !== i))}
                        className="mt-1 text-red-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setEditDialogues([...editDialogues, { characterName: "", text: "" }])}
                    className="flex items-center gap-1 text-[11px] text-[--text-muted] hover:text-primary"
                  >
                    <Plus className="h-3 w-3" />
                    添加台词
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={handleRewriteText}
                disabled={rewritingText}
              >
                {rewritingText ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {rewritingText ? t("common.generating") : t("shot.rewriteText")}
              </Button>
              <ShotRestoreFromScriptButton
                projectId={projectId}
                shotId={id}
                onRestored={onUpdate}
                disabled={rewritingText}
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
            <p className="mb-2 text-[11px] font-medium text-primary/90">{chainSourceHint}</p>
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
          <div className="mt-2">
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
              onGenerateFrames={frameActions.handleGenerateFrames}
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
          </div>
        </StepRow>

        {/* Step 3: 视频提示词 */}
        <StepRow
          label={t("shot.stepVideoPrompt")}
          state={promptState}
          isNext={nextStep === "prompt"}
        >
          {hasVideoPrompt && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-1">
                <AiOptimizeButton
                  value={editVideoPrompt}
                  onOptimized={(v) => { setEditVideoPrompt(v); patchShot({ videoPrompt: v }); }}
                  fieldLabel="videoPrompt"
                  projectId={projectId}
                />
              </div>
              <Textarea
                value={editVideoPrompt}
                onChange={(e) => setEditVideoPrompt(e.target.value)}
                onBlur={() => patchShot({ videoPrompt: editVideoPrompt })}
                className="min-h-[5rem] resize-none font-mono text-xs leading-relaxed"
              />
            </div>
          )}
          <Button
            size="xs"
            variant={nextStep === "prompt" ? "default" : "outline"}
            onClick={handleGenerateVideoPrompt}
            disabled={generatingPrompt || batchGeneratingVideoPrompts || !hasFrame}
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
        title={t("shot.frameReferenceTitle")}
        onConfirm={frameActions.handleFrameReferenceConfirm}
      />
    </div>
  );
}
