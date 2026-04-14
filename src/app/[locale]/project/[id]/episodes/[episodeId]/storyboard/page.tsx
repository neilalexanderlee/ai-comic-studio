"use client";

import { useProjectStore } from "@/stores/project-store";
import { useEpisodeStore } from "@/stores/episode-store";
import { useModelStore } from "@/stores/model-store";
import { ShotCard } from "@/components/editor/shot-card";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useState, useEffect, useRef } from "react";
import type { StoryboardVersion } from "@/stores/project-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import {
  Film,
  Sparkles,
  ImageIcon,
  VideoIcon,
  Loader2,
  Download,
  RefreshCw,
  Play,
  Plus,
  LayoutGrid,
  List,
  ChevronDown,
} from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { VideoRatioPicker } from "@/components/editor/video-ratio-picker";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { GenerationModeTab } from "@/components/editor/generation-mode-tab";
import { ShotDrawer } from "@/components/editor/shot-drawer";
import { CharactersInlinePanel } from "@/components/editor/characters-inline-panel";
import { ShotKanban } from "@/components/editor/shot-kanban";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import Link from "next/link";

export default function EpisodeStoryboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [generating, setGenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [generatingSceneFrames, setGeneratingSceneFrames] = useState(false);
  const [generatingVideoPrompts, setGeneratingVideoPrompts] = useState(false);
  const [sceneFramesOverwrite, setSceneFramesOverwrite] = useState(false);
  const [generatingFramesOverwrite, setGeneratingFramesOverwrite] = useState(false);
  const [generatingVideosOverwrite, setGeneratingVideosOverwrite] = useState(false);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<StoryboardVersion[]>([]);
  const [openDrawerShotId, setOpenDrawerShotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const [continueFromPrev, setContinueFromPrev] = useState(false);

  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const episodeStoreEpisodes = useEpisodeStore((s) => s.episodes);
  const fetchEpisodes = useEpisodeStore((s) => s.fetchEpisodes);

  useEffect(() => {
    if (project?.id && episodeStoreEpisodes.length === 0) {
      fetchEpisodes(project.id);
    }
  }, [project?.id, episodeStoreEpisodes.length, fetchEpisodes]);

  const currentEpisodeSequence = episodeStoreEpisodes.find((e) => e.id === currentEpisodeId)?.sequence ?? 1;
  const canContinueFromPrev = currentEpisodeSequence > 1;

  function switchView(mode: "list" | "kanban") {
    setViewMode(mode);
    if (project) localStorage.setItem(`storyboardView:${project.id}`, mode);
  }

  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  useEffect(() => {
    if (!project?.id) return;
    const stored = localStorage.getItem(`storyboardView:${project.id}`);
    if (stored === "list" || stored === "kanban") setViewMode(stored);
  }, [project?.id]);

  useEffect(() => {
    if (!project?.versions) return;
    setVersions(project.versions);
    setSelectedVersionId((current) => {
      if (current === null && project.versions!.length > 0) {
        return project.versions![0].id;
      }
      return current;
    });
  }, [project?.versions]);

  if (!project) return null;

  const totalShots = project.shots.length;
  const shotsWithFrames = project.shots.filter(
    (s) => s.firstFrame && s.lastFrame
  ).length;
  const generationMode = (project.generationMode || "keyframe") as "keyframe" | "reference";
  const shotsWithVideo = project.shots.filter((s) =>
    generationMode === "reference" ? s.referenceVideoUrl : s.videoUrl
  ).length;
  const shotsWithVideoPrompts = project.shots.filter((s) => s.videoPrompt).length;
  const shotsWithSceneFrames = project.shots.filter((s) => s.sceneRefFrame).length;
  const shotsWithFrameAny = project.shots.filter(
    (s) => s.sceneRefFrame || s.firstFrame || s.lastFrame
  ).length;
  const charactersWithRefs = project.characters.filter((c) => c.referenceImage);
  const hasReferenceImages = charactersWithRefs.length > 0;

  const anyGenerating = generating || generatingFrames || generatingVideos || generatingSceneFrames || generatingVideoPrompts;

  const drawerShots = project.shots.map((shot) => ({
    id: shot.id,
    sequence: shot.sequence,
    prompt: shot.prompt,
    startFrameDesc: shot.startFrameDesc,
    endFrameDesc: shot.endFrameDesc,
    videoScript: shot.videoScript,
    motionScript: shot.motionScript,
    cameraDirection: shot.cameraDirection,
    duration: shot.duration,
    firstFrame: shot.firstFrame,
    lastFrame: shot.lastFrame,
    sceneRefFrame: shot.sceneRefFrame,
    videoPrompt: shot.videoPrompt,
    videoUrl: generationMode === "reference" ? shot.referenceVideoUrl : shot.videoUrl,
    dialogues: shot.dialogues || [],
  }));

  async function handleGenerateShots() {
    if (!project) return;
    if (!textGuard()) return;
    setGenerating(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shot_split",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch (err) {
      console.error("Shot split error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGenerating(false);
    setSelectedVersionId(null);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleBatchGenerateFrames(overwrite = false) {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingFramesOverwrite(overwrite);
    setGeneratingFrames(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_frame_generate",
          payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId, continueFromPrev },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch frame generate error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingFramesOverwrite(false);
    setGeneratingFrames(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleBatchGenerateVideos(overwrite = false) {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_video_generate",
          payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch video generate error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleBatchGenerateSceneFrames(overwrite = false) {
    if (!project) return;
    if (!imageGuard()) return;
    setSceneFramesOverwrite(overwrite);
    setGeneratingSceneFrames(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_scene_frame",
          payload: { overwrite, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch scene frame error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setSceneFramesOverwrite(false);
    setGeneratingSceneFrames(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleBatchGenerateVideoPrompts() {
    if (!project) return;
    setGeneratingVideoPrompts(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_video_prompt",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch video prompt error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideoPrompts(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleBatchGenerateReferenceVideos(overwrite = false) {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_reference_video",
          payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch reference video error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleAutoRun() {
    if (!project) return;
    if (!confirm(t("project.autoRunConfirm"))) return;

    const shots = project.shots;
    const needsText = shots.some((s) => !s.prompt && !s.motionScript);
    const needsFrame = shots.some((s) =>
      generationMode === "reference" ? !s.sceneRefFrame : !s.firstFrame || !s.lastFrame
    );
    const needsPrompt = shots.some((s) => !s.videoPrompt);
    const needsVideo = shots.some((s) =>
      generationMode === "reference" ? !s.referenceVideoUrl : !s.videoUrl
    );

    if (needsText) await handleGenerateShots();
    if (needsFrame) {
      if (generationMode === "reference") await handleBatchGenerateSceneFrames(false);
      else await handleBatchGenerateFrames(false);
    }
    if (needsPrompt) await handleBatchGenerateVideoPrompts();
    if (needsVideo) {
      if (generationMode === "reference") await handleBatchGenerateReferenceVideos(false);
      else await handleBatchGenerateVideos(false);
    }
  }

  return (
    <div className="animate-page-in space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Film className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.storyboard")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {totalShots} shots
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PromptEditButton
            promptKeys={
              generationMode === "reference"
                ? ["shot_split", "scene_frame_generate"]
                : "shot_split"
            }
            projectId={project.id}
          />
          {totalShots > 0 && (
            <div className="inline-flex gap-1 rounded-xl border border-[--border-subtle] bg-[--surface] p-1">
              <button
                onClick={() => switchView("list")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "list"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <List className={`h-3.5 w-3.5 ${viewMode === "list" ? "text-primary" : ""}`} />
                {t("project.viewList")}
              </button>
              <button
                onClick={() => switchView("kanban")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "kanban"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <LayoutGrid className={`h-3.5 w-3.5 ${viewMode === "kanban" ? "text-primary" : ""}`} />
                {t("project.viewKanban")}
              </button>
            </div>
          )}
          {totalShots > 0 && (
            <Link
              href={`/${locale}/project/${project!.id}/episodes/${useProjectStore.getState().currentEpisodeId}/preview${selectedVersionId ? `?versionId=${selectedVersionId}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
            >
              <Film className="h-3.5 w-3.5" />
              {t("project.preview")}
            </Link>
          )}
          {totalShots > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `/api/projects/${project!.id}/download?episodeId=${useProjectStore.getState().currentEpisodeId}`;
                a.download = "";
                a.click();
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {t("project.downloadAll")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Control Panel ── */}
      <div className="rounded-2xl border border-[--border-subtle] bg-white p-4 space-y-3">
        {/* Generation mode + version tabs row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <GenerationModeTab />

          {/* Version tabs */}
          {versions.length > 0 && (
            <div className="flex items-center gap-1">
              {/* Show 2 newest versions */}
              {versions.slice(0, 2).map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setSelectedVersionId(v.id);
                    fetchProject(project!.id, undefined, v.id);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    selectedVersionId === v.id
                      ? "bg-primary/10 text-primary"
                      : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                  }`}
                >
                  {v.label}
                </button>
              ))}
              {/* Older versions dropdown */}
              {versions.length > 2 && (
                <div className="relative" ref={versionDropdownRef}>
                  <button
                    onClick={() => setVersionDropdownOpen((o) => !o)}
                    className={`flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                      versions.slice(2).some((v) => v.id === selectedVersionId)
                        ? "bg-primary/10 text-primary"
                        : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                    }`}
                  >
                    {versions.slice(2).some((v) => v.id === selectedVersionId)
                      ? versions.find((v) => v.id === selectedVersionId)?.label
                      : `+${versions.length - 2}`}
                    <ChevronDown className={`h-3 w-3 transition-transform ${versionDropdownOpen ? "rotate-180" : ""}`} />
                  </button>
                  {versionDropdownOpen && (
                    <div
                      className="absolute right-0 top-full z-20 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-lg"
                      onMouseLeave={() => setVersionDropdownOpen(false)}
                    >
                      {versions.slice(2).map((v) => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setSelectedVersionId(v.id);
                            fetchProject(project!.id, undefined, v.id);
                            setVersionDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-[--surface] ${
                            selectedVersionId === v.id ? "text-primary" : "text-[--text-secondary]"
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleGenerateShots}
                disabled={anyGenerating}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-secondary] disabled:opacity-40"
                title={t("project.generateShots")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Characters inline panel (Feature B) */}
        <CharactersInlinePanel
          characters={project.characters}
          projectId={project.id}
          generationMode={generationMode}
          onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
        />

        {/* Batch operations */}
        {viewMode === "list" && (
        <div className="space-y-2">
          {/* Row 1: Generate text / shots */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">1</span>
            <InlineModelPicker capability="text" />
            <Button
              onClick={handleGenerateShots}
              disabled={anyGenerating}
              variant={totalShots > 0 ? "outline" : "default"}
              size="sm"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? t("common.generating") : t("project.generateShots")}
            </Button>
          </div>

          {/* Row 2: Frames */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">2</span>
            <InlineModelPicker capability="image" />
            {generationMode === "keyframe" ? (
              <>
                <Button
                  onClick={() => handleBatchGenerateFrames(false)}
                  disabled={anyGenerating || totalShots === 0}
                  variant={shotsWithFrames === totalShots && totalShots > 0 ? "outline" : "default"}
                  size="sm"
                >
                  {generatingFrames && !generatingFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  {generatingFrames && !generatingFramesOverwrite
                    ? t("common.generating")
                    : t("project.batchGenerateFrames")}
                </Button>
                <Button
                  onClick={() => handleBatchGenerateFrames(true)}
                  disabled={anyGenerating || totalShots === 0}
                  variant="ghost"
                  size="icon"
                  title={t("project.batchGenerateFramesOverwrite")}
                >
                  {generatingFrames && generatingFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
                {canContinueFromPrev && (
                  <label className="flex items-center gap-1.5 text-xs text-[--text-secondary] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={continueFromPrev}
                      onChange={(e) => setContinueFromPrev(e.target.checked)}
                      className="accent-primary h-3.5 w-3.5"
                      disabled={anyGenerating}
                    />
                    {t("project.continueFromPrev")}
                  </label>
                )}
              </>
            ) : (
              <>
                <Button
                  onClick={() => handleBatchGenerateSceneFrames(false)}
                  disabled={anyGenerating || totalShots === 0 || !hasReferenceImages}
                  variant={shotsWithSceneFrames === totalShots && totalShots > 0 ? "outline" : "default"}
                  size="sm"
                >
                  {generatingSceneFrames && !sceneFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  {generatingSceneFrames && !sceneFramesOverwrite
                    ? t("common.generating")
                    : t("project.batchGenerateSceneFrames")}
                </Button>
                <Button
                  onClick={() => handleBatchGenerateSceneFrames(true)}
                  disabled={anyGenerating || totalShots === 0 || !hasReferenceImages}
                  variant="ghost"
                  size="icon"
                  title={t("project.batchGenerateSceneFramesOverwrite")}
                >
                  {generatingSceneFrames && sceneFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </>
            )}
          </div>

          {/* Row 3: Video prompts */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">3</span>
            <InlineModelPicker capability="text" />
            <Button
              onClick={handleBatchGenerateVideoPrompts}
              disabled={anyGenerating || shotsWithFrameAny === 0}
              variant={shotsWithVideoPrompts === totalShots && totalShots > 0 ? "outline" : "default"}
              size="sm"
            >
              {generatingVideoPrompts ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generatingVideoPrompts ? t("common.generating") : t("project.batchGenerateVideoPrompts")}
            </Button>
          </div>

          {/* Row 4: Videos */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">4</span>
            <InlineModelPicker capability="video" />
            <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
            <Button
              onClick={() =>
                generationMode === "reference"
                  ? handleBatchGenerateReferenceVideos(false)
                  : handleBatchGenerateVideos(false)
              }
              disabled={anyGenerating || totalShots === 0 || (generationMode === "reference" ? !hasReferenceImages : shotsWithFrames === 0)}
              variant={shotsWithVideo === totalShots && totalShots > 0 ? "outline" : "default"}
              size="sm"
            >
              {generatingVideos && !generatingVideosOverwrite ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <VideoIcon className="h-3.5 w-3.5" />
              )}
              {generatingVideos && !generatingVideosOverwrite
                ? t("common.generating")
                : generationMode === "reference"
                  ? t("project.batchGenerateReferenceVideos")
                  : t("project.batchGenerateVideos")}
            </Button>
            <Button
              onClick={() =>
                generationMode === "reference"
                  ? handleBatchGenerateReferenceVideos(true)
                  : handleBatchGenerateVideos(true)
              }
              disabled={anyGenerating || totalShots === 0 || (generationMode === "reference" ? !hasReferenceImages : shotsWithFrames === 0)}
              variant="ghost"
              size="icon"
              title={t("project.batchGenerateVideosOverwrite")}
            >
              {generatingVideos && generatingVideosOverwrite ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {/* Divider + Auto-run */}
          {totalShots > 0 && (
            <>
              <div className="h-px bg-[--border-subtle]" />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleAutoRun}
                  disabled={anyGenerating}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  {anyGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {t("project.autoRun")}
                </Button>
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* Shot cards */}
      {totalShots === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Film className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.storyboard")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      ) : viewMode === "kanban" ? (
        <ShotKanban
          shots={project.shots.map((shot) => ({
            id: shot.id,
            sequence: shot.sequence,
            prompt: shot.prompt,
            firstFrame: shot.firstFrame,
            lastFrame: shot.lastFrame,
            sceneRefFrame: shot.sceneRefFrame,
            videoPrompt: shot.videoPrompt,
            videoUrl: generationMode === "reference" ? shot.referenceVideoUrl : shot.videoUrl,
          }))}
          generationMode={generationMode}
          anyGenerating={anyGenerating}
          onOpenDrawer={(id) => setOpenDrawerShotId(id)}
          onBatchFrames={() => handleBatchGenerateFrames(false)}
          onBatchSceneFrames={() => handleBatchGenerateSceneFrames(false)}
          onBatchVideoPrompts={handleBatchGenerateVideoPrompts}
          onBatchVideos={() => handleBatchGenerateVideos(false)}
          onBatchReferenceVideos={() => handleBatchGenerateReferenceVideos(false)}
          generatingFrames={generatingFrames}
          generatingSceneFrames={generatingSceneFrames}
          generatingVideoPrompts={generatingVideoPrompts}
          generatingVideos={generatingVideos}
        />
      ) : (
        <div className="space-y-3">
          {project.shots.map((shot) => (
            <ShotCard
              key={shot.id}
              id={shot.id}
              projectId={project.id}
              sequence={shot.sequence}
              prompt={shot.prompt}
              startFrameDesc={shot.startFrameDesc}
              endFrameDesc={shot.endFrameDesc}
              videoScript={shot.videoScript}
              motionScript={shot.motionScript}
              cameraDirection={shot.cameraDirection}
              duration={shot.duration}
              firstFrame={shot.firstFrame}
              lastFrame={shot.lastFrame}
              sceneRefFrame={shot.sceneRefFrame}
              videoPrompt={shot.videoPrompt}
              videoUrl={generationMode === "reference" ? shot.referenceVideoUrl : shot.videoUrl}
              status={
                generationMode === "reference"
                  ? shot.status === "generating"
                    ? "generating"
                    : shot.referenceVideoUrl
                      ? "completed"
                      : "pending"
                  : shot.status
              }
              dialogues={shot.dialogues || []}
              onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
              generationMode={generationMode}
              videoRatio={videoRatio}
              isCompact={openDrawerShotId !== null}
              onOpenDrawer={(id) => setOpenDrawerShotId(id)}
              batchGeneratingFrames={generationMode === "reference" ? generatingSceneFrames : generatingFrames}
              batchGeneratingVideoPrompts={generatingVideoPrompts}
              batchGeneratingVideos={generatingVideos}
            />
          ))}
        </div>
      )}

      {openDrawerShotId && (
        <ShotDrawer
          shots={drawerShots}
          openShotId={openDrawerShotId}
          onClose={() => setOpenDrawerShotId(null)}
          onShotChange={(id) => setOpenDrawerShotId(id)}
          onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
          projectId={project.id}
          generationMode={generationMode}
          videoRatio={videoRatio}
          selectedVersionId={selectedVersionId}
          anyGenerating={anyGenerating}
        />
      )}
    </div>
  );
}
