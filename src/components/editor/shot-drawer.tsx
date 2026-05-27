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
  Plus,
  Trash2,
  History,
} from "lucide-react";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { describeShotAutoLinkToast, type ShotAutoLinkResult } from "@/lib/storyboard/shot-auto-link-messages";
import { getShotVideoReadiness } from "@/lib/storyboard/shot-video-readiness";
import { formatChainSourceHint } from "@/lib/storyboard/frame-reference";
import { useShotFrameActions } from "@/hooks/use-shot-frame-actions";
import { FrameReferencePicker, type FrameRefPickerShot } from "./frame-reference-picker";
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

interface DrawerShot {
  id: string;
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
  cutPoint?: string | null;
  videoPrompt?: string | null;
  videoUrl: string | null;
  remoteVideoUrl?: string | null;
  remoteVideoStatus?: string | null;
  remoteVideoExpiresAt?: string | Date | null;
  remoteVideoLastDownloadAt?: string | Date | null;
  videoResolution?: string | null;
  dialogues: Dialogue[];
  isCrowdShot?: boolean;
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
  enhancePrompts?: boolean;
  videoGenerationResolution?: "480p" | "720p";
  showAdoptPrevEpisode?: boolean;
  prevCutPoint?: string | null;
  prevAnchorLastAi?: string | null;
  frameRefShots?: FrameRefPickerShot[];
  chainSourceSequence?: number | null;
  chainSourceType?: string | null;
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
  enhancePrompts = false,
  videoGenerationResolution,
  episodeId,
  showAdoptPrevEpisode = false,
  prevCutPoint = null,
  prevAnchorLastAi = null,
  frameRefShots = [],
  chainSourceSequence = null,
  chainSourceType = null,
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

  // Local generating state (independent of page-level anyGenerating)
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [rewritingText, setRewritingText] = useState(false);
  const [videoHistoryOpen, setVideoHistoryOpen] = useState(false);

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // 台词编辑状态
  type EditDialogue = { id?: string; characterName: string; text: string };
  const [editingDialogues, setEditingDialogues] = useState(false);
  const [editDialogues, setEditDialogues] = useState<EditDialogue[]>([]);
  const [savingDialogues, setSavingDialogues] = useState(false);

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
    setRewritingText(false);
    setEditingDialogues(false);
    setEditDialogues(shot.dialogues.map((d) => ({ id: d.id, characterName: d.characterName, text: d.text })));
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
    enhancePrompts,
    frameRefShots,
    prevCutPoint,
    prevAnchorLastAi,
    onUpdate,
  });

  if (!shot) return null;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < shots.length - 1;

  const hasFrame = !!(shot.anchorFirst || shot.anchorLastAi || shot.cutPoint);
  const videoReadiness = getShotVideoReadiness(
    { anchorFirst: shot.anchorFirst, anchorLastAi: shot.anchorLastAi },
    shot.isCrowdShot ?? false
  );
  const canGenerateVideo = videoReadiness.ready;
  const hasVideoPrompt = !!shot.videoPrompt;
  const hasVideo = !!shot.videoUrl;
  const localGenerating =
    frameActions.frameActionsBusy || generatingVideo || generatingPrompt || rewritingText;
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

  async function handleSaveDialogues() {
    if (!shot) return;
    setSavingDialogues(true);
    try {
      await apiFetch(`/api/projects/${projectId}/shots/${shot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dialogues: editDialogues }),
      });
      setEditingDialogues(false);
      onUpdate();
      toast.success("台词已保存");
    } catch (err) {
      toast.error("保存台词失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingDialogues(false);
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
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_prompt",
          payload: { shotId: shot!.id, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
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
          enhancePrompts,
        }),
      });
      const data = (await res.json()) as { error?: string; shotLink?: ShotAutoLinkResult };
      if (!res.ok) throw new Error(data.error || t("common.generationFailed"));
      const linkToast = describeShotAutoLinkToast(data.shotLink, shot?.sequence);
      if (linkToast) {
        if (linkToast.variant === "success") toast.success(linkToast.message);
        else toast.info(linkToast.message);
      }
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingVideo(false);
    }
  }

  async function handleRewriteText() {
    setRewritingText(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_shot_rewrite",
          payload: { shotId: shot!.id },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setRewritingText(false);
    }
  }

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
                onBlur={() => patchShot({ prompt: editPrompt })}
                rows={2}
                placeholder={t("shot.prompt")}
              />
              <Textarea
                value={editStartFrame}
                onChange={(e) => setEditStartFrame(e.target.value)}
                onBlur={() => patchShot({ startFrameDesc: editStartFrame })}
                rows={2}
                placeholder={t("shot.startFrame")}
                className="border-blue-200 bg-blue-50/30 text-sm"
              />
              <Textarea
                value={editEndFrame}
                onChange={(e) => setEditEndFrame(e.target.value)}
                onBlur={() => patchShot({ endFrameDesc: editEndFrame })}
                rows={2}
                placeholder={t("shot.endFrame")}
                className="border-amber-200 bg-amber-50/30 text-sm"
              />
              <Textarea
                value={editMotionScript}
                onChange={(e) => setEditMotionScript(e.target.value)}
                onBlur={() => patchShot({ motionScript: editMotionScript })}
                rows={2}
                placeholder={t("shot.motionScript")}
                className="border-emerald-200 bg-emerald-50/30 text-sm"
              />
              <input
                value={editCameraDirection}
                onChange={(e) => setEditCameraDirection(e.target.value)}
                onBlur={() => patchShot({ cameraDirection: editCameraDirection })}
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
              {/* 台词区域：只读 / 编辑切换 */}
              <div className="rounded-xl bg-[--surface] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.dialogue")}</p>
                  {!editingDialogues ? (
                    <button
                      onClick={() => {
                        setEditDialogues(shot.dialogues.map((d) => ({ id: d.id, characterName: d.characterName, text: d.text })));
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
                  shot.dialogues.length > 0 ? (
                    shot.dialogues.map((d) => (
                      <p key={d.id} className="text-sm">
                        <span className="font-semibold text-primary">{d.characterName}</span>
                        <span className="mx-1.5 text-[--text-muted]">&mdash;</span>
                        <span className="text-[--text-secondary]">{d.text}</span>
                      </p>
                    ))
                  ) : (
                    <p className="text-[11px] text-[--text-muted]">无台词</p>
                  )
                ) : (
                  <div className="space-y-2">
                    {editDialogues.map((d, i) => (
                      <div key={i} className="flex items-start gap-2">
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
                          className="flex-1 rounded border border-[--border-subtle] bg-white px-1.5 py-1 text-[12px] text-[--text-secondary] outline-none focus:border-primary/50 resize-none"
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
                <Button size="xs" variant="outline" onClick={handleRewriteText} disabled={rewritingText || anyGenerating}>
                  {rewritingText ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {rewritingText ? t("common.generating") : t("shot.rewriteText")}
                </Button>
                <ShotRestoreFromScriptButton
                  projectId={projectId}
                  shotId={shot.id}
                  onRestored={onUpdate}
                  disabled={rewritingText || anyGenerating}
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
              <p className="mb-2 text-[11px] font-medium text-primary/90">{chainSourceHint}</p>
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
                onGenerateFrames={frameActions.handleGenerateFrames}
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
          </section>

          {/* Step 3: Video Prompt */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.stepVideoPrompt")}</p>
            {hasVideoPrompt && (
              <Textarea
                value={editVideoPrompt}
                onChange={(e) => setEditVideoPrompt(e.target.value)}
                onBlur={() => patchShot({ videoPrompt: editVideoPrompt })}
                className="mb-2 min-h-[5rem] resize-none font-mono text-xs leading-relaxed"
              />
            )}
            <Button
              size="xs"
              variant={hasFrame && !hasVideoPrompt ? "default" : "outline"}
              onClick={handleGenerateVideoPrompt}
              disabled={generatingPrompt || !hasFrame || anyGenerating}
            >
              {generatingPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {generatingPrompt
                ? t("common.generating")
                : hasVideoPrompt ? t("shot.regeneratePrompt") : t("shot.generateVideoPrompt")
              }
            </Button>
          </section>

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
                variant={hasVideoPrompt && !hasVideo ? "default" : "outline"}
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
        title={t("shot.frameReferenceTitle")}
        onConfirm={frameActions.handleFrameReferenceConfirm}
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
