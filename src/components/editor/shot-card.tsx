"use client";

import { useState, useEffect, useRef } from "react";
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
  Upload,
  Trash2,
} from "lucide-react";
import { AiOptimizeButton } from "./ai-optimize-button";

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
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  sceneRefFrame?: string | null;
  videoPrompt?: string | null;
  status: string;
  dialogues: Dialogue[];
  onUpdate: () => void;
  generationMode?: "keyframe" | "reference";
  videoRatio?: string;
  isCompact?: boolean;
  onOpenDrawer?: (id: string) => void;
  batchGeneratingFrames?: boolean;
  batchGeneratingVideoPrompts?: boolean;
  batchGeneratingVideos?: boolean;
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

  useEffect(() => {
    if (isNext) setOpen(true);
  }, [isNext]);

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
  firstFrame,
  lastFrame,
  videoUrl,
  sceneRefFrame,
  videoPrompt,
  status,
  dialogues,
  onUpdate,
  generationMode = "keyframe",
  videoRatio = "16:9",
  isCompact = false,
  onOpenDrawer,
  batchGeneratingFrames = false,
  batchGeneratingVideoPrompts = false,
  batchGeneratingVideos = false,
}: ShotCardProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);

  // Edit state
  const [editPrompt, setEditPrompt] = useState(prompt);
  const [editStartFrame, setEditStartFrame] = useState(startFrameDesc ?? "");
  const [editEndFrame, setEditEndFrame] = useState(endFrameDesc ?? "");
  const [editMotionScript, setEditMotionScript] = useState(motionScript ?? "");
  const [editVideoPrompt, setEditVideoPrompt] = useState(videoPrompt ?? "");
  const [editCameraDirection, setEditCameraDirection] = useState(cameraDirection ?? "static");
  const [editDuration, setEditDuration] = useState(duration);

  useEffect(() => { setEditPrompt(prompt); }, [prompt]);
  useEffect(() => { setEditStartFrame(startFrameDesc ?? ""); }, [startFrameDesc]);
  useEffect(() => { setEditEndFrame(endFrameDesc ?? ""); }, [endFrameDesc]);
  useEffect(() => { setEditMotionScript(motionScript ?? ""); }, [motionScript]);
  useEffect(() => { setEditVideoPrompt(videoPrompt ?? ""); }, [videoPrompt]);
  useEffect(() => { setEditCameraDirection(cameraDirection ?? "static"); }, [cameraDirection]);
  useEffect(() => { setEditDuration(duration); }, [duration]);

  // Generation state
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingSceneFrame, setGeneratingSceneFrame] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [rewritingText, setRewritingText] = useState(false);

  // UI state
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadFieldRef = useRef<string | null>(null);

  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  // Derived state
  const hasText = !!(prompt || startFrameDesc || motionScript);
  const hasFrame = !!(sceneRefFrame || firstFrame || lastFrame);
  const hasFramePair = !!(firstFrame && lastFrame);
  const hasVideoPrompt = !!videoPrompt;
  const hasVideo = !!videoUrl;
  const isGenerating = status === "generating";

  // Step states
  const textState: StepState = rewritingText ? "generating" : hasText ? "done" : "idle";
  const frameState: StepState =
    generatingFrames || generatingSceneFrame || batchGeneratingFrames ? "generating"
    : status === "failed" && !hasFrame ? "error"
    : hasFrame ? "done" : "idle";
  const promptState: StepState = generatingPrompt || batchGeneratingVideoPrompts ? "generating" : hasVideoPrompt ? "done" : "idle";
  const videoState: StepState =
    generatingVideo || batchGeneratingVideos || (isGenerating && !hasVideo) ? "generating"
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

  async function handleGenerateFrames() {
    if (!imageGuard()) return;
    setGeneratingFrames(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_frame_generate",
          payload: { shotId: id, ratio: videoRatio },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingFrames(false);
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
          payload: { shotId: id },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingSceneFrame(false);
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
    setGeneratingVideo(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: generationMode === "reference" ? "single_reference_video" : "single_video_generate",
          payload: { shotId: id, ratio: videoRatio },
          modelConfig: getModelConfig(),
        }),
      });
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

  async function handleClearFrame(field: "firstFrame" | "lastFrame" | "sceneRefFrame") {
    await patchShot({ [field]: null });
    onUpdate();
  }

  function handleUploadFrame(field: "firstFrame" | "lastFrame" | "sceneRefFrame") {
    uploadFieldRef.current = field;
    uploadInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const field = uploadFieldRef.current;
    if (!file || !field) return;
    e.target.value = "";
    setUploadingField(field);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("field", field);
      const res = await apiFetch(`/api/projects/${projectId}/shots/${id}/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setUploadingField(null);
  }

  function handleCopyPrompt() {
    const text = videoPrompt || `${videoScript || motionScript || prompt}\nCamera: ${cameraDirection}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const frameAssets = generationMode === "reference"
    ? [{ src: sceneRefFrame, label: t("shot.sceneRefFrame"), type: "image" as const }]
    : [
        { src: firstFrame, label: t("shot.firstFrame"), type: "image" as const },
        { src: lastFrame, label: t("shot.lastFrame"), type: "image" as const },
      ];

  // Progress dots: how many steps done out of 4
  const stepsDone = [hasText, hasFrame, hasVideoPrompt, hasVideo].filter(Boolean).length;

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
          {(generationMode === "reference"
            ? [sceneRefFrame, videoUrl]
            : [firstFrame, lastFrame, videoUrl]
          ).map((src, i) => {
            const isVid = i === (generationMode === "reference" ? 1 : 2);
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
          {(generationMode === "reference"
            ? [sceneRefFrame, videoUrl]
            : [firstFrame, lastFrame, videoUrl]
          ).map((src, i) => {
            const isVideo = i === (generationMode === "reference" ? 1 : 2);
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
            <span className="flex items-center gap-1 text-xs text-[--text-muted]">
              <Clock className="h-3 w-3" />
              <input
                type="number"
                min={5}
                max={15}
                value={editDuration}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Math.min(15, Math.max(5, Number(e.target.value)));
                  setEditDuration(v);
                  patchShot({ duration: v });
                }}
                className="w-9 rounded border border-[--border-subtle] bg-white px-1 py-0.5 text-center text-[11px] font-medium text-[--text-primary] outline-none focus:border-primary/50"
              />
              <span className="text-[11px]">s</span>
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
            {generationMode !== "reference" && (
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
            )}
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
            <Button
              size="xs"
              variant="outline"
              onClick={handleRewriteText}
              disabled={rewritingText}
            >
              {rewritingText ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {rewritingText ? t("common.generating") : t("shot.rewriteText")}
            </Button>
          </div>
        </StepRow>

        {/* Step 2: 帧 */}
        <StepRow
          label={generationMode === "reference" ? t("shot.stepSceneFrame") : t("shot.stepFrames")}
          state={frameState}
          isNext={nextStep === "frame"}
        >
          {/* Frame thumbnails */}
          <div className="mb-2.5 flex gap-2">
            {frameAssets.map((asset, i) => {
              const fieldName = generationMode === "reference"
                ? "sceneRefFrame" as const
                : (i === 0 ? "firstFrame" : "lastFrame") as "firstFrame" | "lastFrame";
              const isUploading = uploadingField === fieldName;
              return (
                <div key={i} className="flex flex-col gap-1" style={{ width: generationMode === "reference" ? "100%" : "50%" }}>
                  <div
                    className={`relative overflow-hidden rounded-lg border border-[--border-subtle] bg-[--surface] ${asset.src && !isUploading ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                    onClick={() => asset.src && !isUploading && setPreviewSrc(uploadUrl(asset.src))}
                  >
                    {isUploading ? (
                      <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
                    ) : asset.src ? (
                      <img src={uploadUrl(asset.src)} className="w-full object-contain" />
                    ) : (
                      <div className="flex h-16 items-center justify-center"><ImageIcon className="h-4 w-4 text-[--text-muted]" /></div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleUploadFrame(fieldName)}
                      disabled={isUploading}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[--border-subtle] bg-white py-0.5 text-[10px] text-[--text-muted] transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      <Upload className="h-2.5 w-2.5" />
                      上传
                    </button>
                    {asset.src && (
                      <button
                        onClick={() => handleClearFrame(fieldName)}
                        className="flex items-center justify-center rounded-md border border-[--border-subtle] bg-white px-1.5 py-0.5 text-[10px] text-[--text-muted] transition-colors hover:border-red-300 hover:text-red-500"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <Button
            size="xs"
            variant={nextStep === "frame" ? "default" : "outline"}
            onClick={generationMode === "reference" ? handleGenerateSceneFrame : handleGenerateFrames}
            disabled={generatingFrames || generatingSceneFrame || generatingVideo || batchGeneratingFrames}
          >
            {(generatingFrames || generatingSceneFrame || batchGeneratingFrames)
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <ImageIcon className="h-3 w-3" />
            }
            {(generatingFrames || generatingSceneFrame || batchGeneratingFrames)
              ? t("common.generating")
              : hasFrame ? t("shot.regenerateFrames") : t("project.generateFrames")
            }
          </Button>
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
            >
              <video className="h-full w-full object-contain" src={uploadUrl(videoUrl!)} />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
                  <VideoIcon className="h-4 w-4 text-[--text-primary] translate-x-0.5" />
                </div>
              </div>
            </div>
          )}
          <Button
            size="xs"
            variant={nextStep === "video" ? "default" : "outline"}
            onClick={handleGenerateVideo}
            disabled={generatingVideo || batchGeneratingVideos || isGenerating || (generationMode === "keyframe" && !hasFramePair)}
          >
            {(generatingVideo || batchGeneratingVideos || (isGenerating && !hasVideo))
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <VideoIcon className="h-3 w-3" />
            }
            {(generatingVideo || batchGeneratingVideos || (isGenerating && !hasVideo))
              ? t("common.generating")
              : hasVideo ? t("shot.regenerateVideo") : t("project.generateVideo")
            }
          </Button>
        </StepRow>

      </div>

      {/* Hidden file input for frame uploads */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

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
    </div>
  );
}
