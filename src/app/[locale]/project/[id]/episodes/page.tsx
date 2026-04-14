"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Layers, Plus, Loader2, Users, X, Upload, FileUp, Merge, Download } from "lucide-react";
import { uploadUrl } from "@/lib/utils/upload-url";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EpisodeCard } from "@/components/editor/episode-card";
import { EpisodeDialog } from "@/components/editor/episode-dialog";
import { useEpisodeStore, type Episode } from "@/stores/episode-store";
import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";

export default function EpisodesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const t = useTranslations("episode");
  const tc = useTranslations("common");
  const {
    episodes,
    loading,
    fetchEpisodes,
    createEpisode,
    deleteEpisode,
    updateEpisode,
  } = useEpisodeStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchEpisodes(projectId);
  }, [projectId, fetchEpisodes]);

  // Close video modal on Escape
  useEffect(() => {
    if (!playingEpisode) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPlayingEpisode(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [playingEpisode]);

  async function handleCreate(data: { title: string; description?: string; keywords?: string }) {
    await createEpisode(projectId, data);
    toast.success(t("created"));
  }

  async function handleEdit(data: { title: string; description?: string; keywords?: string }) {
    if (!editingEpisode) return;
    await updateEpisode(projectId, editingEpisode.id, data);
    setEditingEpisode(null);
  }

  async function handleDelete(episode: Episode) {
    if (episodes.length <= 1) {
      toast.error(t("cannotDeleteLast"));
      return;
    }
    if (!confirm(t("deleteConfirm"))) return;
    await deleteEpisode(projectId, episode.id);
  }

  const handlePlayVideo = useCallback((episode: Episode) => {
    setPlayingEpisode(episode);
  }, []);

  function toggleSelect(episode: Episode) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(episode.id)) next.delete(episode.id);
      else next.add(episode.id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function handleMerge() {
    if (selectedIds.size < 2) {
      toast.error(t("mergeMinTwo"));
      return;
    }
    setMerging(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/merge-episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Merge failed");
      }
      const data = await res.json();
      setMergedVideoUrl(data.videoUrl);
      toast.success(t("mergeSuccess"));
      exitSelectionMode();
    } catch (err) {
      console.error("Merge error:", err);
      toast.error(err instanceof Error ? err.message : t("mergeError"));
    } finally {
      setMerging(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">{tc("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[--surface] p-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/8">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("title")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {episodes.length} {t("count")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/${locale}/project/${projectId}/import`}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[--border-subtle] bg-white px-3.5 py-2 text-sm font-medium text-[--text-secondary] shadow-sm transition-all hover:border-primary/20 hover:text-primary"
          >
            <FileUp className="h-4 w-4" />
            {t("importRecord")}
          </Link>
          <Link
            href={`/${locale}/project/${projectId}/characters`}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[--border-subtle] bg-white px-3.5 py-2 text-sm font-medium text-[--text-secondary] shadow-sm transition-all hover:border-primary/20 hover:text-primary"
          >
            <Users className="h-4 w-4" />
            {t("characters")}
          </Link>
          <Button
            variant="outline"
            onClick={() => {
              if (selectionMode) {
                exitSelectionMode();
              } else {
                setSelectionMode(true);
              }
            }}
            className="rounded-[10px]"
            disabled={episodes.filter((e) => e.finalVideoUrl).length < 2}
          >
            <Merge className="mr-1.5 h-4 w-4" />
            {selectionMode ? t("mergeCancel") : t("mergeVideos")}
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="rounded-[10px]">
            <Plus className="mr-1.5 h-4 w-4" />
            {t("create")}
          </Button>
        </div>
      </div>

      {/* Episode grid */}
      {episodes.length === 0 ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-white/50 p-8 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Layers className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("title")}
          </h3>
          <p className="mt-2 max-w-sm text-sm text-[--text-secondary]">
            {t("noEpisodes")}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <Button onClick={() => setCreateOpen(true)} className="rounded-xl">
              <Plus className="mr-1.5 h-4 w-4" />
              {t("create")}
            </Button>
            <Link href={`/${locale}/project/${projectId}/import`}>
              <Button variant="outline" className="rounded-xl">
                <Upload className="mr-1.5 h-4 w-4" />
                {t("uploadScript")}
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 xl:grid-cols-4">
          {episodes.map((episode) => (
            <EpisodeCard
              key={episode.id}
              episode={episode}
              projectId={projectId}
              onEdit={(ep) => setEditingEpisode(ep)}
              onDelete={handleDelete}
              onPlayVideo={handlePlayVideo}
              selectionMode={selectionMode}
              selected={selectedIds.has(episode.id)}
              selectable={!!episode.finalVideoUrl}
              onToggleSelect={toggleSelect}
            />
          ))}
          {/* Add new card */}
          {!selectionMode && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex min-h-[200px] flex-col items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-[--border-subtle] bg-white transition-all hover:border-primary hover:bg-primary/[0.02]"
            >
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[10px] bg-[--surface] text-[--text-muted] transition-all group-hover:bg-primary/8 group-hover:text-primary">
                <Plus className="h-[18px] w-[18px]" />
              </div>
              <span className="text-xs font-medium text-[--text-muted]">{t("create")}</span>
            </button>
          )}
        </div>
      )}

      {/* Floating selection action bar */}
      {selectionMode && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-[--border-subtle] bg-white px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-[--text-secondary]">
            {t("mergeSelected", { count: selectedIds.size })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={exitSelectionMode}
          >
            {t("mergeCancel")}
          </Button>
          <Button
            size="sm"
            disabled={selectedIds.size < 2 || merging}
            onClick={handleMerge}
          >
            {merging ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t("merging")}
              </>
            ) : (
              t("mergeConfirm")
            )}
          </Button>
        </div>
      )}

      {/* Create dialog */}
      <EpisodeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        mode="create"
      />

      {/* Edit dialog */}
      <EpisodeDialog
        open={!!editingEpisode}
        onOpenChange={(open) => { if (!open) setEditingEpisode(null); }}
        onSubmit={handleEdit}
        defaultValues={editingEpisode ? {
          title: editingEpisode.title,
          description: editingEpisode.description || "",
          keywords: editingEpisode.keywords || "",
        } : undefined}
        mode="edit"
      />

      {/* Video player modal */}
      {playingEpisode && playingEpisode.finalVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPlayingEpisode(null)}
        >
          <div
            className="relative w-[90%] max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPlayingEpisode(null)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <X className="h-4 w-4" />
            </button>
            <video
              src={uploadUrl(playingEpisode.finalVideoUrl)}
              controls
              autoPlay
              className="w-full"
            />
            <div className="flex items-center justify-between bg-[#111] px-5 py-3">
              <span className="text-sm font-semibold text-white">{playingEpisode.title}</span>
              <span className="font-mono text-xs text-[#666]">
                EP.{String(playingEpisode.sequence).padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Merged video preview + download modal */}
      {mergedVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setMergedVideoUrl(null)}
        >
          <div
            className="relative w-[90%] max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setMergedVideoUrl(null)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <X className="h-4 w-4" />
            </button>
            <video
              src={uploadUrl(mergedVideoUrl)}
              controls
              autoPlay
              className="w-full"
            />
            <div className="flex items-center justify-between bg-[#111] px-5 py-3">
              <span className="text-sm font-semibold text-white">{t("mergeVideos")}</span>
              <a
                href={uploadUrl(mergedVideoUrl)}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <Download className="h-3.5 w-3.5" />
                {t("downloadVideo")}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
