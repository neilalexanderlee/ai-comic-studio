"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, Loader2, ImageIcon, Mic } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { CharacterCard } from "@/components/editor/character-card";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";

interface Character {
  id: string;
  projectId: string;
  name: string;
  description: string;
  visualHint: string | null;
  voiceHint: string | null;
  assets: {
    id: string;
    imagePath: string | null;
    tag: string;
    assetType: "morph" | "blueprint";
    isDefault: number;
    audioPath?: string | null;
    angle?: string | null;
    sourceAssetId?: string | null;
  }[];
  scope: string;
  episodeId: string | null;
  episodeIds?: string[];
}

interface Episode {
  id: string;
  title: string;
  sequence: number;
}

export default function CharactersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const t = useTranslations();
  const tc = useTranslations("common");
  const tChar = useTranslations("character");

  const [characters, setCharacters] = useState<Character[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [generatingVoices, setGeneratingVoices] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState<{ done: number; total: number } | null>(null);
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const imageGuard = useModelGuard("image");

  const fetchData = useCallback(async () => {
    const [chars, eps] = await Promise.all([
      apiFetch(`/api/projects/${projectId}/characters`).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/episodes`).then((r) => r.json()),
    ]);
    setCharacters(chars);
    setEpisodes(eps);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleBatchGenerateImages() {
    if (!imageGuard()) return;
    setGeneratingImages(true);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_character_image",
          modelConfig: getModelConfig(),
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r?.status === "error")) {
        toast.warning(tc("batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch character image error:", err);
      toast.error(tc("generationFailed"));
    }
    setGeneratingImages(false);
    fetchData();
  }

  async function handleBatchGenerateVoices() {
    setGeneratingVoices(true);
    setVoiceProgress(null);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_voice_generate",
          modelConfig: getModelConfig(),
        }),
      });
      if (!response.body) throw new Error("No stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "start") setVoiceProgress({ done: 0, total: evt.totalCount });
            if (evt.type === "progress") {
              setVoiceProgress({ done: evt.updatedCount, total: evt.totalCount });
              // 实时更新角色卡片的 voiceHint，无需等批量完成
              if (evt.characterId && evt.voiceHint) {
                setCharacters((prev) =>
                  prev.map((c) => c.id === evt.characterId ? { ...c, voiceHint: evt.voiceHint } : c)
                );
              }
            }
            if (evt.type === "done") {
              toast.success(`已生成 ${evt.updatedCount}/${evt.totalCount} 个角色音色描述`);
              setVoiceProgress(null);
              fetchData(); // done 时全量刷新确保数据一致
            }
            if (evt.type === "error") toast.error(evt.error ?? "生成失败");
          } catch {}
        }
      }
    } catch (err) {
      console.error("Batch voice generate error:", err);
      toast.error(tc("generationFailed"));
    }
    setGeneratingVoices(false);
    setVoiceProgress(null);
    fetchData();
  }

  async function handleDelete(characterId: string, name: string) {
    if (!confirm(tChar("deleteConfirm", { name }))) return;
    await apiFetch(`/api/projects/${projectId}/characters/${characterId}`, {
      method: "DELETE",
    });
    toast.success(tc("delete"));
    fetchData();
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/project/${projectId}/episodes`}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/8 transition-colors hover:bg-primary/15"
          >
            <ArrowLeft className="h-5 w-5 text-primary" />
          </Link>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {tChar("management")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {characters.length} {t("episode.count")}
            </p>
          </div>
        </div>
        {characters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleBatchGenerateVoices}
              disabled={generatingVoices}
              size="sm"
              variant="outline"
            >
              {generatingVoices ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              {generatingVoices
                ? voiceProgress
                  ? `${voiceProgress.done}/${voiceProgress.total}`
                  : tc("generating")
                : "批量生成音色"}
            </Button>
            <InlineModelPicker capability="image" />
            <Button
              onClick={handleBatchGenerateImages}
              disabled={generatingImages}
              size="sm"
            >
              {generatingImages ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
              {generatingImages ? tc("generating") : tChar("batchGenerateImages")}
            </Button>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-[--border-subtle] bg-white/70 px-4 py-3 text-xs leading-relaxed text-[--text-secondary] shadow-sm">
        {tChar("morphNamingHint")}
      </div>

      {characters.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 p-6">
          <p className="text-sm text-[--text-muted]">{tChar("noMain")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 xl:grid-cols-4">
          {characters.map((char) => (
            <CharacterCard
              key={char.id}
              id={char.id}
              projectId={projectId}
              name={char.name}
              description={char.description}
              visualHint={char.visualHint}
              voiceHint={char.voiceHint}
              assets={char.assets}
              episodeIds={char.episodeIds ?? []}
              allEpisodes={episodes}
              onUpdate={fetchData}
              onDelete={() => handleDelete(char.id, char.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
