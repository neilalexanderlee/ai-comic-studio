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
} from "lucide-react";

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
  firstFrame: string | null;
  lastFrame: string | null;
  sceneRefFrame?: string | null;
  videoPrompt?: string | null;
  videoUrl: string | null;
  dialogues: Dialogue[];
}

interface ShotDrawerProps {
  shots: DrawerShot[];
  openShotId: string | null;
  onClose: () => void;
  onShotChange: (id: string) => void;
  onUpdate: () => void;
  projectId: string;
  generationMode: "keyframe" | "reference";
  videoRatio: string;
  selectedVersionId: string | null;
  anyGenerating: boolean;
}

export function ShotDrawer({
  shots,
  openShotId,
  onClose,
  onShotChange,
  onUpdate,
  projectId,
  generationMode,
  videoRatio,
  selectedVersionId,
  anyGenerating,
}: ShotDrawerProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

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
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingSceneFrame, setGeneratingSceneFrame] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [rewritingText, setRewritingText] = useState(false);

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
    setGeneratingFrames(false);
    setGeneratingSceneFrame(false);
    setGeneratingVideo(false);
    setGeneratingPrompt(false);
    setRewritingText(false);
  }, [shot?.id]);

  // Escape key to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!shot) return null;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < shots.length - 1;

  const hasFrame = !!(shot.sceneRefFrame || shot.firstFrame || shot.lastFrame);
  const hasFramePair = !!(shot.firstFrame && shot.lastFrame);
  const hasVideoPrompt = !!shot.videoPrompt;
  const hasVideo = !!shot.videoUrl;
  const localGenerating = generatingFrames || generatingSceneFrame || generatingVideo || generatingPrompt || rewritingText;

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

  async function handleGenerateFrames() {
    if (!imageGuard()) return;
    setGeneratingFrames(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_frame_generate",
          payload: { shotId: shot!.id, ratio: videoRatio, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingFrames(false);
    }
  }

  async function handleGenerateSceneFrame() {
    if (!imageGuard()) return;
    setGeneratingSceneFrame(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_scene_frame",
          payload: { shotId: shot!.id, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingSceneFrame(false);
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
    setGeneratingVideo(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: generationMode === "reference" ? "single_reference_video" : "single_video_generate",
          payload: { shotId: shot!.id, ratio: videoRatio, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
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

  const frameAssets = generationMode === "reference"
    ? [{ src: shot.sceneRefFrame, label: t("shot.sceneRefFrame") }]
    : [
        { src: shot.firstFrame, label: t("shot.firstFrame") },
        { src: shot.lastFrame, label: t("shot.lastFrame") },
      ];

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
              {generationMode !== "reference" && (
                <>
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
                </>
              )}
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
                <span className="flex items-center gap-1 text-xs text-[--text-muted]">
                  <Clock className="h-3 w-3" />
                  <input
                    type="number"
                    min={5}
                    max={15}
                    value={editDuration}
                    onChange={(e) => {
                      const v = Math.min(15, Math.max(5, Number(e.target.value)));
                      setEditDuration(v);
                      patchShot({ duration: v });
                    }}
                    className="w-9 rounded border border-[--border-subtle] bg-white px-1 py-0.5 text-center text-[11px] font-medium outline-none focus:border-primary/50"
                  />
                  <span className="text-[11px]">s</span>
                </span>
              </div>
              {shot.dialogues.length > 0 && (
                <div className="space-y-1 rounded-xl bg-[--surface] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.dialogue")}</p>
                  {shot.dialogues.map((d) => (
                    <p key={d.id} className="text-sm">
                      <span className="font-semibold text-primary">{d.characterName}</span>
                      <span className="mx-1.5 text-[--text-muted]">&mdash;</span>
                      <span className="text-[--text-secondary]">{d.text}</span>
                    </p>
                  ))}
                </div>
              )}
              <Button size="xs" variant="outline" onClick={handleRewriteText} disabled={rewritingText || anyGenerating}>
                {rewritingText ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {rewritingText ? t("common.generating") : t("shot.rewriteText")}
              </Button>
            </div>
          </section>

          {/* Step 2: Frames */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
              {generationMode === "reference" ? t("shot.stepSceneFrame") : t("shot.stepFrames")}
            </p>
            {hasFrame && (
              <div className="mb-2 flex gap-2">
                {frameAssets.map((asset, i) => (
                  <div
                    key={i}
                    className={`overflow-hidden rounded-lg border border-[--border-subtle] bg-[--surface] cursor-pointer hover:opacity-80 transition-opacity ${generationMode === "reference" ? "w-full" : "flex-1"}`}
                    onClick={() => asset.src && setPreviewSrc(uploadUrl(asset.src))}
                  >
                    {asset.src
                      ? <img src={uploadUrl(asset.src)} className="w-full object-contain" alt={asset.label} />
                      : <div className="flex h-16 items-center justify-center"><ImageIcon className="h-4 w-4 text-[--text-muted]" /></div>
                    }
                  </div>
                ))}
              </div>
            )}
            <Button
              size="xs"
              variant={!hasFrame ? "default" : "outline"}
              onClick={generationMode === "reference" ? handleGenerateSceneFrame : handleGenerateFrames}
              disabled={generatingFrames || generatingSceneFrame || anyGenerating}
            >
              {(generatingFrames || generatingSceneFrame) ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
              {(generatingFrames || generatingSceneFrame)
                ? t("common.generating")
                : hasFrame ? t("shot.regenerateFrames") : t("project.generateFrames")
              }
            </Button>
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
              </div>
            )}
            <Button
              size="xs"
              variant={hasVideoPrompt && !hasVideo ? "default" : "outline"}
              onClick={handleGenerateVideo}
              disabled={generatingVideo || (generationMode === "keyframe" && !hasFramePair) || anyGenerating}
            >
              {generatingVideo ? <Loader2 className="h-3 w-3 animate-spin" /> : <VideoIcon className="h-3 w-3" />}
              {generatingVideo
                ? t("common.generating")
                : hasVideo ? t("shot.regenerateVideo") : t("project.generateVideo")
              }
            </Button>
          </section>

        </div>
      </div>

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
