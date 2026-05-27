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
  LayoutGrid,
  List,
  ChevronDown,
  Plus,
  X,
  Clock,
} from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { VideoRatioPicker } from "@/components/editor/video-ratio-picker";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { ShotDrawer } from "@/components/editor/shot-drawer";
import { CharactersInlinePanel } from "@/components/editor/characters-inline-panel";
import { ShotKanban } from "@/components/editor/shot-kanban";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { NewVersionDialog } from "@/components/editor/new-version-dialog";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";

function buildShotCharacterText(shot: {
  prompt?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  videoScript?: string | null;
  motionScript?: string | null;
}): string {
  return [shot.prompt, shot.startFrameDesc, shot.endFrameDesc, shot.videoScript, shot.motionScript]
    .filter(Boolean)
    .join(" ");
}

type ShotExtractPreview = {
  sequence: number;
  sceneTitle: string;
  duration: number | null;
  dialogueCount: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string | null;
  completeness: {
    hasPrompt: boolean;
    hasStartFrame: boolean;
    hasEndFrame: boolean;
    hasMotionScript: boolean;
    hasCameraDirection: boolean;
    hasDuration: boolean;
  };
  dialogues: Array<{ character: string; text: string; sequence: number }>;
};

export default function EpisodeStoryboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [generating, setGenerating] = useState(false);
  const [generatingVideoPrompts, setGeneratingVideoPrompts] = useState(false);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [videoGenerationResolution, setVideoGenerationResolution] = useState<"480p" | "720p">("480p");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<StoryboardVersion[]>([]);
  const [openDrawerShotId, setOpenDrawerShotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const [newVersionDialogOpen, setNewVersionDialogOpen] = useState(false);
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [deletingVersion, setDeletingVersion] = useState(false);
  const [enhancePrompts, setEnhancePrompts] = useState(true); // AI prompt 增强，默认开
  const [linkShotsViaCutPoint, setLinkShotsViaCutPoint] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [extractPreview, setExtractPreview] = useState<{
    mode: string;
    score: number;
    reasons: string[];
    warnings: string[];
    shotCount: number;
    shots: ShotExtractPreview[];
  } | null>(null);

  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  // Also read episodeId directly from the URL — the store value may be null on first render
  const urlParams = useParams();
  const urlEpisodeId = urlParams?.episodeId as string | undefined;
  const episodeStoreEpisodes = useEpisodeStore((s) => s.episodes);
  const fetchEpisodes = useEpisodeStore((s) => s.fetchEpisodes);

  const currentEpisode = episodeStoreEpisodes.find((e) => e.id === currentEpisodeId) ?? null;
  const targetDurationSeconds: number | null = currentEpisode?.targetDurationSeconds ?? null;

  useEffect(() => {
    if (project?.id && episodeStoreEpisodes.length === 0) {
      fetchEpisodes(project.id);
    }
  }, [project?.id, episodeStoreEpisodes.length, fetchEpisodes]);

  const currentEpisodeSequence =
    episodeStoreEpisodes.find((e) => e.id === (urlEpisodeId || currentEpisodeId))?.sequence ?? 1;
  const canAdoptPrevEpisode = currentEpisodeSequence > 1;

  function switchView(mode: "list" | "kanban") {
    setViewMode(mode);
    if (project) localStorage.setItem(`storyboardView:${project.id}`, mode);
  }

  async function handleDeleteVersion(versionId: string) {
    // Prefer URL episodeId (always available) over Zustand store value (may be null on first render)
    const episodeId = urlEpisodeId || currentEpisodeId;
    if (!project || !episodeId) return;
    setDeletingVersion(true);
    try {
      await apiFetch(
        `/api/projects/${project.id}/episodes/${episodeId}/versions/${versionId}`,
        { method: "DELETE" }
      );
      // Switch to another version before refreshing
      const remaining = versions.filter((v) => v.id !== versionId);
      const nextId = remaining[0]?.id ?? null;
      setSelectedVersionId(nextId);
      setVersions(remaining);
      setDeleteVersionId(null);
      await fetchProject(project.id, episodeId, nextId ?? undefined);
      toast.success("版本已删除");
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      setDeletingVersion(false);
    }
  }

  const textGuard = useModelGuard("text");

  useEffect(() => {
    if (!project?.id) return;
    const stored = localStorage.getItem(`storyboardView:${project.id}`);
    if (stored === "list" || stored === "kanban") setViewMode(stored);
    // Sync enhancePrompts from DB (project.enhancePrompts: 1 = on, 0 = off; default on)
    if (project.enhancePrompts !== undefined) {
      setEnhancePrompts(project.enhancePrompts !== 0);
    }
    if (project.linkShotsViaCutPoint !== undefined) {
      setLinkShotsViaCutPoint(project.linkShotsViaCutPoint !== 0);
    }
  }, [project?.id, project?.enhancePrompts, project?.linkShotsViaCutPoint]);

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
  const shotsWithVideo = project.shots.filter((s) => s.videoUrl).length;
  const shotsWithVideoPrompts = project.shots.filter((s) => s.videoPrompt).length;
  const shotsWithFrameAny = project.shots.filter(
    (s) => s.anchorFirst || s.anchorLastAi || s.cutPoint
  ).length;

  const anyGenerating = generating || generatingVideoPrompts;

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
    anchorFirst: shot.anchorFirst,
    anchorLastAi: shot.anchorLastAi,
    cutPoint: shot.cutPoint,
    videoPrompt: shot.videoPrompt,
    videoUrl: shot.videoUrl,
    dialogues: shot.dialogues || [],
    isCrowdShot: filterShotCharacters(buildShotCharacterText(shot), project.characters).length === 0,
  }));

  async function handleGenerateShots() {
    // 当前版本有已生成的帧或视频时，自动新建版本保护现有资产，不再弹确认框。
    // 只有当前版本完全没有生成资产时，才在原版本上覆盖（空版本重解析，安全）。
    const hasGeneratedAssets = project?.shots?.some(
      (s) => s.anchorFirst || s.anchorLastAi || s.videoUrl || s.cutPoint
    );
    return handleGenerateShotsWithMode(hasGeneratedAssets ? undefined : (selectedVersionId ?? undefined));
  }

  async function handleGenerateShotsWithMode(targetVersionId?: string) {
    if (!project) return;
    if (!textGuard()) return;
    setGenerating(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shot_split",
          payload: {
            ...(targetVersionId ? { targetVersionId } : {}),
          },
          modelConfig: getModelConfig(),
          episodeId: urlEpisodeId || useProjectStore.getState().currentEpisodeId,
          enhancePrompts,
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
    // 若传了 targetVersionId 则刷回该版本，否则刷新最新版本（新建的那个）
    await fetchProject(
      project.id,
      (urlEpisodeId || useProjectStore.getState().currentEpisodeId)!,
      targetVersionId
    );
  }

  async function handlePreviewExtraction() {
    if (!project) return;
    setPreviewLoading(true);
    setPreviewOpen(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shot_extract_preview",
          episodeId: urlEpisodeId || useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = (await response.json()) as typeof extractPreview;
      setExtractPreview(data);
    } catch (err) {
      console.error("Shot extract preview error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
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
          episodeId: urlEpisodeId || useProjectStore.getState().currentEpisodeId,
          enhancePrompts,
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
    fetchProject(project.id, (urlEpisodeId || useProjectStore.getState().currentEpisodeId)!);
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
          <PromptEditButton promptKeys="shot_split" projectId={project.id} />
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
              href={`/${locale}/project/${project!.id}/episodes/${urlEpisodeId || useProjectStore.getState().currentEpisodeId}/preview${selectedVersionId ? `?versionId=${selectedVersionId}` : ""}`}
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
                a.href = `/api/projects/${project!.id}/download?episodeId=${urlEpisodeId || useProjectStore.getState().currentEpisodeId}`;
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
          {/* Version tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {/* Show 2 newest versions — each tab has a delete ✕ on hover */}
            {versions.slice(0, 2).map((v) => (
              <div key={v.id} className="group relative flex items-center">
                <button
                  onClick={() => {
                    setSelectedVersionId(v.id);
                    fetchProject(project!.id, undefined, v.id);
                  }}
                  className={`rounded-lg pl-3 pr-6 py-1.5 text-[13px] font-medium transition-colors ${
                    selectedVersionId === v.id
                      ? "bg-primary/10 text-primary"
                      : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                  }`}
                >
                  {v.label}
                </button>
                {versions.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteVersionId(v.id); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex h-4 w-4 items-center justify-center rounded text-[--text-muted] hover:bg-red-100 hover:text-red-500 transition-colors"
                    title={`删除版本 ${v.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
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
                    className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-lg"
                    onMouseLeave={() => setVersionDropdownOpen(false)}
                  >
                    {versions.slice(2).map((v) => (
                      <div key={v.id} className="group relative flex items-center">
                        <button
                          onClick={() => {
                            setSelectedVersionId(v.id);
                            fetchProject(project!.id, undefined, v.id);
                            setVersionDropdownOpen(false);
                          }}
                          className={`w-full pl-3 pr-8 py-2 text-left text-[13px] font-medium transition-colors hover:bg-[--surface] ${
                            selectedVersionId === v.id ? "text-primary" : "text-[--text-secondary]"
                          }`}
                        >
                          {v.label}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteVersionId(v.id); setVersionDropdownOpen(false); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex h-4 w-4 items-center justify-center rounded text-[--text-muted] hover:bg-red-100 hover:text-red-500 transition-colors"
                          title={`删除版本 ${v.label}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* + 新建版本 */}
            <button
              onClick={() => setNewVersionDialogOpen(true)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-secondary]"
              title="新建版本"
            >
              <Plus className="h-3.5 w-3.5" />
              新建版本
            </button>
            {versions.length > 0 && (
              <>
                <button
                  onClick={handleGenerateShots}
                  disabled={anyGenerating}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-secondary] disabled:opacity-40"
                  title={t("project.generateShots")}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Duration coverage bar — only shown when targetDurationSeconds is known */}
        {(() => {
          if (!targetDurationSeconds || targetDurationSeconds <= 0) return null;
          const totalShotDuration = project.shots.reduce((sum, s) => sum + (s.duration ?? 0), 0);
          const pct = Math.min(100, Math.round((totalShotDuration / targetDurationSeconds) * 100));
          const isLow = pct < 80;
          const fmtSec = (s: number) => {
            const m = Math.floor(s / 60);
            const sec = s % 60;
            return m > 0 ? `${m}分${sec > 0 ? `${sec}秒` : ""}` : `${sec}秒`;
          };
          return (
            <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] ${isLow ? "bg-amber-50 border border-amber-200" : "bg-emerald-50 border border-emerald-200"}`}>
              <Clock className={`h-3.5 w-3.5 flex-shrink-0 ${isLow ? "text-amber-500" : "text-emerald-500"}`} />
              <div className="flex-1 min-w-0">
                <div className={`mb-1 flex items-center justify-between ${isLow ? "text-amber-700" : "text-emerald-700"}`}>
                  <span className="font-medium">时长覆盖率 {pct}%</span>
                  <span className="text-[11px] opacity-80">{fmtSec(totalShotDuration)} / 目标 {fmtSec(targetDurationSeconds)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${isLow ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {isLow && (
                <span className="flex-shrink-0 text-amber-600 text-[11px]">
                  还缺约 {Math.ceil((targetDurationSeconds - totalShotDuration) / 10)} 个镜头
                </span>
              )}
            </div>
          );
        })()}

        {/* Characters inline panel (Feature B) */}
        <CharactersInlinePanel
          characters={project.characters}
          projectId={project.id}
          onUpdate={() => fetchProject(project.id, (urlEpisodeId || useProjectStore.getState().currentEpisodeId)!)}
        />

        {/* Batch operations */}
        {viewMode === "list" && (
        <div className="space-y-2">

          {/* Global generation settings strip */}
          <div className="flex items-center gap-3 rounded-xl border border-[--border-subtle] bg-[--surface]/60 px-3 py-2 flex-wrap">
            <span className="text-[11px] font-semibold text-[--text-muted] uppercase tracking-wide shrink-0">生成设置</span>
            <div className="h-3.5 w-px bg-[--border-subtle] shrink-0" />
            {/* AI Prompt 增强开关 — 影响所有生成步骤 */}
            <label
              className="flex items-center gap-1.5 text-xs text-[--text-secondary] cursor-pointer select-none"
              title="开启后，每次生成前用文本模型对图像/视频 prompt 进行模型专属优化，提升生成质量"
            >
              <input
                type="checkbox"
                checked={enhancePrompts}
                onChange={(e) => {
                  const next = e.target.checked;
                  setEnhancePrompts(next);
                  apiFetch(`/api/projects/${project.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enhancePrompts: next ? 1 : 0 }),
                  }).catch(() => {});
                }}
                className="accent-primary h-3.5 w-3.5"
                disabled={anyGenerating}
              />
              <span className={enhancePrompts ? "text-[--text-primary] font-medium" : ""}>AI 增强</span>
            </label>
            <label
              className="flex items-center gap-1.5 text-xs text-[--text-secondary] cursor-pointer select-none"
              title="视频生成成功后，将本镜视频尾帧（cut_point）直拷为同集下一镜首帧；群演→主角切换时自动跳过"
            >
              <input
                type="checkbox"
                checked={linkShotsViaCutPoint}
                onChange={(e) => {
                  const next = e.target.checked;
                  setLinkShotsViaCutPoint(next);
                  apiFetch(`/api/projects/${project.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ linkShotsViaCutPoint: next ? 1 : 0 }),
                  }).catch(() => {});
                }}
                className="accent-primary h-3.5 w-3.5"
                disabled={anyGenerating}
              />
              <span className={linkShotsViaCutPoint ? "text-[--text-primary] font-medium" : ""}>
                镜头衔接（视频尾帧）
              </span>
            </label>
            <div className="h-3.5 w-px bg-[--border-subtle] shrink-0" />
            <InlineModelPicker capability="video" />
            <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
            <div className="flex items-center rounded-lg border border-[--border-subtle] bg-white overflow-hidden text-xs">
              {(["480p", "720p"] as const).map((res) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => setVideoGenerationResolution(res)}
                  className={`px-2.5 py-1.5 font-medium transition-colors ${
                    videoGenerationResolution === res
                      ? "bg-primary text-white"
                      : "text-[--text-secondary] hover:bg-[--surface]"
                  }`}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

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
            <Button
              onClick={handlePreviewExtraction}
              disabled={anyGenerating}
              variant="ghost"
              size="sm"
            >
              <Play className="h-3.5 w-3.5" />
              {t("project.previewExtract")}
            </Button>
          </div>

          {/* Row 2: Video prompts */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">2</span>
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
            anchorFirst: shot.anchorFirst,
            anchorLastAi: shot.anchorLastAi,
            videoPrompt: shot.videoPrompt,
            videoUrl: shot.videoUrl,
          }))}
          anyGenerating={anyGenerating}
          onOpenDrawer={(id) => setOpenDrawerShotId(id)}
          onBatchVideoPrompts={handleBatchGenerateVideoPrompts}
          generatingVideoPrompts={generatingVideoPrompts}
        />
      ) : (
        <div className="space-y-3">
          {project.shots.map((shot, index) => {
            const isCrowdShot =
              filterShotCharacters(buildShotCharacterText(shot), project.characters).length === 0;
            const chainSourceSequence = shot.chainSourceShotId
              ? project.shots.find((s) => s.id === shot.chainSourceShotId)?.sequence
              : null;
            return (
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
              anchorFirst={shot.anchorFirst}
              anchorLastAi={shot.anchorLastAi}
              cutPoint={shot.cutPoint}
              videoPrompt={shot.videoPrompt}
              videoUrl={shot.videoUrl}
              remoteVideoUrl={shot.remoteVideoUrl}
              remoteVideoStatus={shot.remoteVideoStatus}
              remoteVideoExpiresAt={shot.remoteVideoExpiresAt}
              remoteVideoLastDownloadAt={shot.remoteVideoLastDownloadAt}
              status={shot.status}
              episodeId={(urlEpisodeId || currentEpisodeId)!}
              showAdoptPrevEpisode={index === 0 && canAdoptPrevEpisode}
              warnings={shot.warnings}
              videoResolution={shot.videoResolution}
              videoGenerationResolution={videoGenerationResolution}
              dialogues={shot.dialogues || []}
              onUpdate={() => fetchProject(project.id, (urlEpisodeId || useProjectStore.getState().currentEpisodeId)!)}
              videoRatio={videoRatio}
              isCompact={openDrawerShotId !== null}
              onOpenDrawer={(id) => setOpenDrawerShotId(id)}
              batchGeneratingVideoPrompts={generatingVideoPrompts}
              prevCutPoint={index > 0 ? project.shots[index - 1]?.cutPoint : null}
              prevAnchorLastAi={index > 0 ? project.shots[index - 1]?.anchorLastAi : null}
              isCrowdShot={isCrowdShot}
              chainSourceShotId={shot.chainSourceShotId}
              chainSourceType={shot.chainSourceType}
              chainSourceSequence={chainSourceSequence ?? null}
              frameRefShots={project.shots.map((s) => ({
                id: s.id,
                sequence: s.sequence,
                anchorFirst: s.anchorFirst,
                anchorLastAi: s.anchorLastAi,
                cutPoint: s.cutPoint,
              }))}
              enhancePrompts={enhancePrompts}
            />
            );
          })}
        </div>
      )}

      {openDrawerShotId && (
        <ShotDrawer
          shots={drawerShots}
          openShotId={openDrawerShotId}
          onClose={() => setOpenDrawerShotId(null)}
          onShotChange={(id) => setOpenDrawerShotId(id)}
          onUpdate={() => fetchProject(project.id, (urlEpisodeId || useProjectStore.getState().currentEpisodeId)!)}
          projectId={project.id}
          videoRatio={videoRatio}
          selectedVersionId={selectedVersionId}
          anyGenerating={anyGenerating}
          enhancePrompts={enhancePrompts}
        />
      )}

      <NewVersionDialog
        open={newVersionDialogOpen}
        onOpenChange={setNewVersionDialogOpen}
        projectId={project.id}
        episodeId={(urlEpisodeId || currentEpisodeId)!}
        versions={versions}
        currentVersionId={selectedVersionId}
        onCreated={(newVersionId) => {
          setSelectedVersionId(newVersionId);
          fetchProject(project.id, (urlEpisodeId || useProjectStore.getState().currentEpisodeId)!, newVersionId);
        }}
      />

      {/* Delete version confirmation dialog */}
      <Dialog open={deleteVersionId !== null} onOpenChange={(open) => { if (!open) setDeleteVersionId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <X className="h-4 w-4" />
              删除版本
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-[--text-secondary]">
              确认删除版本 <span className="font-semibold text-[--text-primary]">
                {versions.find((v) => v.id === deleteVersionId)?.label}
              </span>？
            </p>
            <p className="text-xs text-amber-700 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              此操作不可撤销。该版本的所有分镜和已生成的帧/视频记录将被永久删除。
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDeleteVersionId(null)} disabled={deletingVersion}>
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteVersionId && handleDeleteVersion(deleteVersionId)}
                disabled={deletingVersion}
              >
                {deletingVersion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                {deletingVersion ? "删除中..." : "确认删除"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("project.previewExtract")}</DialogTitle>
          </DialogHeader>

          {previewLoading ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : extractPreview ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[--border-subtle] bg-[--surface] p-3 text-sm text-[--text-secondary]">
                <div>{t("project.previewExtractSummary", { count: extractPreview.shotCount, score: extractPreview.score } as never)}</div>
                {extractPreview.reasons.length > 0 && (
                  <div className="mt-1 text-xs text-[--text-muted]">{extractPreview.reasons.join(" · ")}</div>
                )}
                {extractPreview.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-amber-700">{extractPreview.warnings.join(" | ")}</div>
                )}
              </div>

              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {extractPreview.shots.map((shot) => (
                  <div key={shot.sequence} className="rounded-xl border border-[--border-subtle] bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-[--text-primary]">
                        #{shot.sequence} {shot.sceneTitle || t("project.previewUntitled")}
                      </div>
                      <div className="text-xs text-[--text-muted]">
                        {shot.duration ? `${shot.duration}s` : t("project.previewNoDuration")} · {shot.dialogueCount} dialogue
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-[--text-secondary] line-clamp-3">{shot.prompt}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                      <span className={`rounded-full px-2 py-1 ${shot.completeness.hasPrompt ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{shot.completeness.hasPrompt ? t("project.previewFieldReady", { field: "prompt" } as never) : t("project.previewFieldMissing", { field: "prompt" } as never)}</span>
                      <span className={`rounded-full px-2 py-1 ${shot.completeness.hasStartFrame ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{shot.completeness.hasStartFrame ? t("project.previewFieldReady", { field: "start" } as never) : t("project.previewFieldMissing", { field: "start" } as never)}</span>
                      <span className={`rounded-full px-2 py-1 ${shot.completeness.hasEndFrame ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{shot.completeness.hasEndFrame ? t("project.previewFieldReady", { field: "end" } as never) : t("project.previewFieldMissing", { field: "end" } as never)}</span>
                      <span className={`rounded-full px-2 py-1 ${shot.completeness.hasMotionScript ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{shot.completeness.hasMotionScript ? t("project.previewFieldReady", { field: "motion" } as never) : t("project.previewFieldMissing", { field: "motion" } as never)}</span>
                      <span className={`rounded-full px-2 py-1 ${shot.completeness.hasCameraDirection ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{shot.completeness.hasCameraDirection ? t("project.previewFieldReady", { field: "camera" } as never) : t("project.previewFieldMissing", { field: "camera" } as never)}</span>
                    </div>
                    {shot.dialogues.length > 0 && (
                      <div className="mt-3 rounded-lg bg-[--surface] p-2 text-[11px] text-[--text-secondary]">
                        {shot.dialogues.slice(0, 2).map((dialogue) => (
                          <div key={`${shot.sequence}-${dialogue.sequence}`}>
                            <span className="font-medium text-[--text-primary]">{dialogue.character}:</span> {dialogue.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
