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
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ImageIcon,
  VideoIcon,
  Sparkles,
  RefreshCw,
  Clock,
  Scissors,
  History,
} from "lucide-react";
import { getModelMaxDuration } from "@/lib/ai/video-capabilities";
import { getShotVideoReadiness, resolveShotNextStep } from "@/lib/storyboard/shot-video-readiness";
import { formatChainSourceHint, type FrameReferenceType } from "@/lib/storyboard/frame-reference";
import { useShotFrameActions } from "@/hooks/use-shot-frame-actions";
import { FrameReferencePicker, type FrameRefPickerShot } from "./frame-reference-picker";
import { ShotFrameToolbar } from "./shot-frame-toolbar";
import { ShotFrameAssets } from "./shot-frame-assets";
import { ShotVideoHistoryDialog } from "./shot-video-history-dialog";
import { ShotExternalFrameHelper } from "./shot-external-frame-helper";
import { ShotRestoreFromScriptButton } from "./shot-restore-from-script-button";
import { RemoteVideoRecoveryHint } from "./remote-video-recovery-hint";
import { ShotVideoEnhanceButton } from "./shot-video-enhance-button";
import { PrevizBench } from "./previz-bench";

interface Dialogue {
  id: string;
  text: string;
  characterName: string;
}

/** 单个道具资产（用于分镜级道具勾选 UI） */
interface PropAsset {
  id: string;
  imagePath: string | null;
  tag: string;
  characterName: string;
}

interface DrawerShot {
  id: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  anchorFirst: string | null;
  anchorLastAi: string | null;
  cutPoint?: string | null;
  videoPrompt?: string | null;
  videoUrl: string | null;
  remoteVideoUrl?: string | null;
  remoteVideoStatus?: string | null;
  remoteVideoExpiresAt?: string | Date | null;
  remoteVideoLastDownloadAt?: string | Date | null;
  videoResolution?: string | null;
  /** 3D 导演台导出的构图参考图 */
  previzLayoutUrl?: string | null;
  dialogues: Dialogue[];
  chainSourceShotId?: string | null;
  /** "strict_start"=像素级严格首帧承接；"reference_redraw"/null=普通。决定视频生成用 initialImage 还是 multimodal 模式 */
  anchorFirstContinuityMode?: string | null;
  /** 分镜级道具绑定（JSON 数组字符串，存 character_assets.id） */
  propRefs?: string | null;
  /** 本镜角色的道具资产列表（由 storyboard/page.tsx 计算后传入） */
  availablePropAssets?: PropAsset[];
}

interface ShotDrawerProps {
  shots: DrawerShot[];
  openShotId: string | null;
  onClose: () => void;
  onShotChange: (id: string) => void;
  onUpdate: () => void;
  projectId: string;
  episodeId?: string;
  videoRatio: string;
  selectedVersionId: string | null;
  anyGenerating: boolean;
  videoGenerationResolution?: string;
  showAdoptPrevEpisode?: boolean;
  prevCutPoint?: string | null;
  prevAnchorLastAi?: string | null;
  prevChainFrameShotId?: string | null;
  prevChainFrameType?: FrameReferenceType | null;
  frameRefShots?: FrameRefPickerShot[];
  chainSourceSequence?: number | null;
  chainSourceType?: string | null;
  /** 本镜命名角色数量，用于动态计算用户可手选的参考图上限 */
  namedCharacterCount?: number;
  /** 本镜出场的具名角色（3D 导演台首次打开时据此自动建演员） */
  shotCharacters?: { id: string; name: string }[];
}

export function ShotDrawer({
  shots,
  openShotId,
  onClose,
  onShotChange,
  onUpdate,
  projectId,
  videoRatio,
  selectedVersionId,
  anyGenerating,
  videoGenerationResolution,
  episodeId,
  showAdoptPrevEpisode = false,
  prevCutPoint = null,
  prevAnchorLastAi = null,
  prevChainFrameShotId = null,
  prevChainFrameType = null,
  frameRefShots = [],
  chainSourceSequence = null,
  chainSourceType = null,
  namedCharacterCount = 0,
  shotCharacters = [],
}: ShotDrawerProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const videoGuard = useModelGuard("video");
  const videoModelMax = getModelMaxDuration(getModelConfig().video?.modelId);
  const [splittingShot, setSplittingShot] = useState(false);

  const currentIndex = shots.findIndex((s) => s.id === openShotId);
  const shot = currentIndex >= 0 ? shots[currentIndex] : null;

  // Local edit state
  const [editPrompt, setEditPrompt] = useState("");
  const [editStartFrame, setEditStartFrame] = useState("");
  const [editEndFrame, setEditEndFrame] = useState("");
  const [editMotionScript, setEditMotionScript] = useState("");
  const [editVideoPrompt, setEditVideoPrompt] = useState("");
  const [editCameraDirection, setEditCameraDirection] = useState("static");
  const [editDuration, setEditDuration] = useState(5);
  // 道具参考图本地选中态（乐观更新）
  const [localPropRefs, setLocalPropRefs] = useState<string[]>([]);

  // Local generating state (independent of page-level anyGenerating)
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [videoHistoryOpen, setVideoHistoryOpen] = useState(false);

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // Sync local state when shot changes
  useEffect(() => {
    if (!shot) return;
    setEditPrompt(shot.prompt ?? "");
    setEditStartFrame(shot.startFrameDesc ?? "");
    setEditEndFrame(shot.endFrameDesc ?? "");
    setEditMotionScript(shot.motionScript ?? "");
    setEditVideoPrompt(shot.videoPrompt ?? "");
    setEditCameraDirection(shot.cameraDirection ?? "static");
    setEditDuration(shot.duration ?? 5);
    setGeneratingVideo(false);
    setGeneratingPrompt(false);
    // 同步道具选中态
    try { setLocalPropRefs(shot.propRefs ? JSON.parse(shot.propRefs) : []); }
    catch { setLocalPropRefs([]); }
  }, [shot?.id]);

  // Escape key to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const frameActions = useShotFrameActions({
    projectId,
    shotId: shot?.id ?? "",
    episodeId,
    videoRatio,
    versionId: selectedVersionId,
    frameRefShots,
    prevCutPoint,
    prevAnchorLastAi,
    prevChainFrameShotId,
    prevChainFrameType,
    namedCharacterCount,
    onUpdate,
  });

  if (!shot) return null;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < shots.length - 1;

  const hasFrame = !!(shot.anchorFirst || shot.anchorLastAi || shot.cutPoint);
  const videoReadiness = getShotVideoReadiness({
    anchorFirst: shot.anchorFirst,
    anchorLastAi: shot.anchorLastAi,
    chainSourceShotId: shot.chainSourceShotId,
    anchorFirstContinuityMode: shot.anchorFirstContinuityMode,
  });
  const canGenerateVideo = videoReadiness.ready;
  const hasVideoPrompt = !!shot.videoPrompt;
  const hasVideo = !!shot.videoUrl;
  // 红色高亮的"推荐下一步"，跟主页面 shot-card.tsx 共用同一份判断，避免再次跑偏
  const nextStep = resolveShotNextStep(shot);
  const localGenerating =
    frameActions.frameActionsBusy || generatingVideo || generatingPrompt;
  const chainSourceHint = formatChainSourceHint(chainSourceSequence, chainSourceType);

  async function patchShot(fields: Record<string, unknown>) {
    if (!shot) return;
    try {
      await apiFetch(`/api/projects/${projectId}/shots/${shot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
  }

  async function handleSplitShot() {
    if (!shot) return;
    setSplittingShot(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots/${shot.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxDuration: videoModelMax }),
      });
      const data = await res.json();
      toast.success(`已拆分为 ${data.splits} 个镜头（每个 ≤${videoModelMax}s）`);
      onUpdate();
      onClose();
    } catch (err) {
      toast.error("拆分失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSplittingShot(false);
    }
  }

  async function handleGenerateVideoPrompt() {
    setGeneratingPrompt(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_prompt",
          payload: { shotId: shot!.id, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
      const data = (await res.json()) as { videoPrompt?: string; error?: string };
      if (!res.ok) throw new Error(data.error || t("common.generationFailed"));
      if (typeof data.videoPrompt === "string") setEditVideoPrompt(data.videoPrompt);
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingPrompt(false);
    }
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
            shotId: shot!.id,
            ratio: videoRatio,
            versionId: selectedVersionId,
            ...(videoGenerationResolution && { resolution: videoGenerationResolution }),
          },
          modelConfig: getModelConfig(),
        }),
      });
      const data = (await res.json()) as { error?: string; capabilityNotes?: string[] };
      if (!res.ok) throw new Error(data.error || t("common.generationFailed"));
      // 模型能力降级说明（如"该模型不支持多模态参考，本次未用定妆图锁外貌"）。
      // 降级不能静默：否则用户切换品牌后只会觉得"效果莫名变差"，无从判断原因。
      data.capabilityNotes?.forEach((note) => toast.warning(note));
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingVideo(false);
    }
  }

  // handleRewriteText 已废弃 — single_shot_rewrite route handler 已移除
  // 请使用分镜页「批量优化文本」（batch_storyboard_rewrite）

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[560px] max-w-[90vw] flex-col border-l border-[--border-subtle] bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-[--border-subtle] px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 font-mono text-sm font-bold text-primary">
            {shot.sequence}
          </div>
          <p className="flex-1 truncate text-sm font-medium text-[--text-primary]">{shot.prompt}</p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => hasPrev && onShotChange(shots[currentIndex - 1].id)}
              disabled={!hasPrev || localGenerating}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => hasNext && onShotChange(shots[currentIndex + 1].id)}
              disabled={!hasNext || localGenerating}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {/* Step 1: Text */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.stepText")}</p>
            <div className="space-y-2">
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onBlur={async () => { await patchShot({ prompt: editPrompt }); onUpdate(); }}
                rows={2}
                placeholder={t("shot.prompt")}
              />
              <Textarea
                value={editStartFrame}
                onChange={(e) => setEditStartFrame(e.target.value)}
                onBlur={async () => { await patchShot({ startFrameDesc: editStartFrame }); onUpdate(); }}
                rows={2}
                placeholder={t("shot.startFrame")}
                className="border-blue-200 bg-blue-50/30 text-sm"
              />
              <Textarea
                value={editEndFrame}
                onChange={(e) => setEditEndFrame(e.target.value)}
                onBlur={async () => { await patchShot({ endFrameDesc: editEndFrame }); onUpdate(); }}
                rows={2}
                placeholder={t("shot.endFrame")}
                className="border-amber-200 bg-amber-50/30 text-sm"
              />
              <Textarea
                value={editMotionScript}
                onChange={(e) => setEditMotionScript(e.target.value)}
                onBlur={async () => { await patchShot({ motionScript: editMotionScript }); onUpdate(); }}
                rows={2}
                placeholder={t("shot.motionScript")}
                className="border-emerald-200 bg-emerald-50/30 text-sm"
              />
              <input
                value={editCameraDirection}
                onChange={(e) => setEditCameraDirection(e.target.value)}
                onBlur={async () => { await patchShot({ cameraDirection: editCameraDirection }); onUpdate(); }}
                className="w-full rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-sm outline-none focus:border-primary/50"
                placeholder="static / pan-left / zoom-in ..."
              />
              <div className="flex items-center gap-2">
                <span className={`flex items-center gap-1 text-xs ${editDuration > videoModelMax ? "text-orange-600" : "text-[--text-muted]"}`}>
                  <Clock className="h-3 w-3" />
                  <input
                    type="number"
                    min={5}
                    max={videoModelMax}
                    value={editDuration}
                    onChange={(e) => {
                      const v = Math.min(videoModelMax, Math.max(5, Number(e.target.value)));
                      setEditDuration(v);
                      patchShot({ duration: v });
                    }}
                    className={`w-9 rounded border px-1 py-0.5 text-center text-[11px] font-medium outline-none ${
                      editDuration > videoModelMax
                        ? "border-orange-400 bg-orange-50 text-orange-700"
                        : "border-[--border-subtle] bg-white focus:border-primary/50"
                    }`}
                  />
                  <span className="text-[11px]">s</span>
                  {editDuration > videoModelMax && (
                    <span className="ml-1 text-[10px] font-semibold text-orange-600">
                      ⚠ 超过模型上限 {videoModelMax}s
                    </span>
                  )}
                </span>
                {editDuration > videoModelMax && (
                  <button
                    onClick={handleSplitShot}
                    disabled={splittingShot}
                    className="flex items-center gap-1 rounded-lg bg-orange-100 px-2 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50 transition-colors"
                  >
                    {splittingShot ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                    自动拆分
                  </button>
                )}
              </div>
              {/* 台词：只读展示，由剧本解析写入，不支持手动编辑 */}
              {shot.dialogues.length > 0 && (
                <div className="rounded-xl border border-[--border-subtle] bg-[--surface] p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.dialogue")}</p>
                  {shot.dialogues.map((d) => {
                    const dtype = (d as { type?: string }).type ?? "dialogue";
                    const typeLabel: Record<string, string> = { dialogue: "对白", os: "OS", vo: "VO" };
                    return (
                      <p key={d.id} className="text-[12px]">
                        <span className="font-semibold text-primary">{d.characterName}</span>
                        {dtype !== "dialogue" && (
                          <span className="mx-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700">{typeLabel[dtype]}</span>
                        )}
                        <span className="mx-1.5 text-[--text-muted]">&mdash;</span>
                        <span className="text-[--text-secondary]">{d.text}</span>
                      </p>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {/* 「重写文本」已移除 — 请使用分镜页「批量优化文本」 */}
                <ShotRestoreFromScriptButton
                  projectId={projectId}
                  shotId={shot.id}
                  onRestored={onUpdate}
                  disabled={anyGenerating}
                />
              </div>
            </div>
          </section>

          {/* Step 2: Frames */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
              {t("shot.stepFrames")}
            </p>
            {chainSourceHint && (
              <div className="mb-2 flex items-center gap-2 flex-wrap rounded-lg bg-amber-50/60 border border-amber-100 px-2.5 py-1.5">
                <span className="text-[11px] font-medium text-amber-700 flex-1">{chainSourceHint}</span>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={frameActions.handleGenerateFirstFrameFresh}
                  disabled={frameActions.frameActionsBusy || anyGenerating}
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
              shotId={shot.id}
              anchorFirst={shot.anchorFirst}
              anchorLastAi={shot.anchorLastAi}
              cutPoint={shot.cutPoint}
              onPreview={setPreviewSrc}
              onUpdate={onUpdate}
              generatingFrames={frameActions.generatingFrames}
              generatingFrameTarget={frameActions.generatingFrameTarget}
              onGenerateOneFrame={frameActions.handleGenerateOneFrame}
              disabled={anyGenerating}
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
                disabled={anyGenerating}
                onGenerateFrames={frameActions.handleGenerateFirstFrameFresh}
                onPickReference={() => frameActions.openFrameReferencePicker("first")}
                onAdoptPrevEpisode={frameActions.handleAdoptPrevEpisodeFrame}
                onAdoptPrevChain={frameActions.handleAdoptPrevChainFrame}
                trailing={
                  <ShotExternalFrameHelper
                    projectId={projectId}
                    shotId={shot.id}
                    disabled={frameActions.frameActionsBusy || anyGenerating}
                  />
                }
              />
            </div>

            {/* 道具参考图勾选（分镜级手动绑定） */}
            {shot.availablePropAssets && shot.availablePropAssets.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
                  道具参考图
                </p>
                <div className="flex flex-wrap gap-2">
                  {shot.availablePropAssets.map((prop) => {
                    const isSelected = localPropRefs.includes(prop.id);
                    const toggleProp = async () => {
                      const next = isSelected
                        ? localPropRefs.filter((id) => id !== prop.id)
                        : [...localPropRefs, prop.id];
                      setLocalPropRefs(next); // 乐观更新
                      await patchShot({ propRefs: JSON.stringify(next) });
                      onUpdate(); // 同步服务端最新状态
                    };
                    return (
                      <button
                        key={prop.id}
                        type="button"
                        title={`${prop.characterName} · ${prop.tag || "道具"}`}
                        onClick={toggleProp}
                        className={`relative h-14 w-14 overflow-hidden rounded-lg border-2 transition-all ${
                          isSelected
                            ? "border-amber-400 ring-1 ring-amber-300"
                            : "border-[--border-subtle] opacity-60 hover:opacity-100"
                        }`}
                      >
                        {prop.imagePath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={uploadUrl(prop.imagePath)}
                            alt={prop.tag || "道具"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-[--surface-alt] text-[8px] text-[--text-muted]">
                            无图
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-x-0 bottom-0 bg-amber-400/80 text-center text-[8px] font-bold text-white leading-tight py-0.5">
                            ✓
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Step 3: Video Prompt */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.stepVideoPrompt")}</p>
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
              disabled={generatingPrompt || anyGenerating}
            >
              {generatingPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {generatingPrompt
                ? t("common.generating")
                : hasVideoPrompt ? t("shot.regeneratePrompt") : t("shot.generateVideoPrompt")
              }
            </Button>
          </section>

          {/* Step 3.5: 预演台 —— 便宜地把运镜先验一遍，再去跑贵的正式生成 */}
          <PrevizBench
            projectId={projectId}
            episodeId={episodeId}
            shotCharacters={shotCharacters}
            layoutUrl={shot.previzLayoutUrl}
            shotId={shot.id}
            videoRatio={videoRatio}
            versionId={selectedVersionId ?? undefined}
            anyGenerating={anyGenerating || generatingVideo}
            onPreview={setPreviewSrc}
            onUpdate={onUpdate}
          />

          {/* Step 4: Video */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.stepVideo")}</p>
            {hasVideo && (
              <div
                className="group relative mb-2 overflow-hidden rounded-xl border border-[--border-subtle] bg-black cursor-pointer"
                style={{ aspectRatio: "16/9" }}
                onClick={() => setPreviewSrc(uploadUrl(shot.videoUrl!))}
              >
                <video className="h-full w-full object-contain" src={uploadUrl(shot.videoUrl!)} />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
                    <VideoIcon className="h-4 w-4 text-[--text-primary] translate-x-0.5" />
                  </div>
                </div>
                {shot.videoResolution && (
                  <div
                    className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      shot.videoResolution === "720p"
                        ? "bg-emerald-600/90 text-white"
                        : "bg-amber-500/90 text-white"
                    }`}
                  >
                    {shot.videoResolution}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <RemoteVideoRecoveryHint
                remoteVideoUrl={shot.remoteVideoUrl}
                remoteVideoStatus={shot.remoteVideoStatus}
                remoteVideoExpiresAt={shot.remoteVideoExpiresAt}
                remoteVideoLastDownloadAt={shot.remoteVideoLastDownloadAt}
                hasLocalVideo={hasVideo}
              />
              <Button
                size="xs"
                variant={nextStep === "video" ? "default" : "outline"}
                onClick={handleGenerateVideo}
                disabled={generatingVideo || !canGenerateVideo || anyGenerating}
                title={!canGenerateVideo && !videoReadiness.ready ? videoReadiness.message : undefined}
              >
                {generatingVideo ? <Loader2 className="h-3 w-3 animate-spin" /> : <VideoIcon className="h-3 w-3" />}
                {generatingVideo
                  ? t("common.generating")
                  : hasVideo ? t("shot.regenerateVideo") : t("project.generateVideo")
                }
                {videoGenerationResolution && (
                  <span className="ml-1 rounded bg-white/20 px-1 text-[10px] font-bold">
                    {videoGenerationResolution}
                  </span>
                )}
              </Button>
              <ShotVideoEnhanceButton
                projectId={projectId}
                shotId={shot.id}
                videoUrl={shot.videoUrl}
                videoResolution={shot.videoResolution}
                onEnhanced={onUpdate}
                disabled={generatingVideo || anyGenerating}
              />
              {hasVideo && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setVideoHistoryOpen(true)}
                  disabled={generatingVideo || anyGenerating}
                >
                  <History className="h-3 w-3" />
                  版本历史
                </Button>
              )}
            </div>
          </section>

        </div>
      </div>

      <FrameReferencePicker
        open={frameActions.frameRefPickerOpen}
        onOpenChange={frameActions.setFrameRefPickerOpen}
        shots={frameRefShots}
        currentShotId={shot.id}
        frameTarget={frameActions.pendingFrameTarget === "last" ? "last" : "first"}
        onConfirm={frameActions.handleFrameReferenceConfirm}
        maxSelectable={frameActions.crossShotRefLimit}
      />

      <ShotVideoHistoryDialog
        open={videoHistoryOpen}
        onOpenChange={setVideoHistoryOpen}
        projectId={projectId}
        shotId={shot.id}
        onReverted={onUpdate}
      />

      {/* Preview lightbox */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
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
    </>
  );
}
