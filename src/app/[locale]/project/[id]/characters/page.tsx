"use client";

import { useEffect, useState, useMemo, useCallback, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Users, ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { CharacterCard } from "@/components/editor/character-card";
import Link from "next/link";
import { toast } from "sonner";

interface Character {
  id: string;
  projectId: string;
  name: string;
  description: string;
  visualHint: string | null;
  assets: {
    id: string;
    imagePath: string | null;
    tag: string;
    assetType: "morph" | "blueprint";
    isDefault: number;
  }[];
  scope: string;
  /** 旧数据或手动绑定可能仍有单列 episode_id */
  episodeId: string | null;
  /** 分集角色解析写入 episode_characters，列表由此得出出场分集 */
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

  const mainCharacters = useMemo(
    () => characters.filter((c) => c.scope === "main"),
    [characters]
  );

  /**
   * 配角分组：优先用 episode_characters（API 的 episodeIds），兼容旧数据的 characters.episode_id。
   * 分集解析路径只写关联表、不写 episode_id，此前会导致「有计数无列表」。
   */
  const { guestByEpisode, guestOrphans } = useMemo(() => {
    const validEpisodeIds = new Set(episodes.map((e) => e.id));
    const map = new Map<string, Character[]>();
    const orphans: Character[] = [];
    for (const c of characters) {
      if (c.scope !== "guest") continue;
      const fromLinks =
        c.episodeIds?.filter((id) => validEpisodeIds.has(id)) ?? [];
      const legacy =
        c.episodeId && validEpisodeIds.has(c.episodeId) ? [c.episodeId] : [];
      const epIds = [...new Set([...fromLinks, ...legacy])];
      if (epIds.length === 0) {
        orphans.push(c);
        continue;
      }
      for (const epId of epIds) {
        const list = map.get(epId) ?? [];
        list.push(c);
        map.set(epId, list);
      }
    }
    return { guestByEpisode: map, guestOrphans: orphans };
  }, [characters, episodes]);

  const episodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ep of episodes) {
      map.set(ep.id, ep.title);
    }
    return map;
  }, [episodes]);

  const guestCount = useMemo(
    () => characters.filter((c) => c.scope === "guest").length,
    [characters]
  );

  async function handlePromote(characterId: string) {
    await apiFetch(`/api/projects/${projectId}/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "main" }),
    });
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
      <div className="mb-6 flex items-center justify-between">
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
      </div>

      <div className="mb-6 rounded-2xl border border-[--border-subtle] bg-white/70 px-4 py-3 text-xs leading-relaxed text-[--text-secondary] shadow-sm">
        {tChar("morphNamingHint")}
      </div>

      {/* Main Characters Section */}
      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {tChar("mainSection")}
          </h3>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-[11px] font-semibold text-blue-700">
            {mainCharacters.length}
          </span>
        </div>
        {mainCharacters.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 p-6">
            <p className="text-sm text-[--text-muted]">{tChar("noMain")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 xl:grid-cols-4">
            {mainCharacters.map((char) => (
              <CharacterCard
                key={char.id}
                id={char.id}
                projectId={projectId}
                name={char.name}
                description={char.description}
                visualHint={char.visualHint}
                assets={char.assets}
                scope={char.scope}
                onUpdate={fetchData}
                onDelete={() => handleDelete(char.id, char.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Guest Characters Section — flat grid, episode tags on each card */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {tChar("guestSection")}
          </h3>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-100 px-1.5 text-[11px] font-semibold text-purple-700">
            {guestCount}
          </span>
        </div>
        <p className="mb-4 text-xs text-[--text-muted]">
          图片上传一次，集数标签可在每张卡片上自由增删
        </p>
        {guestCount === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 p-6">
            <p className="text-sm text-[--text-muted]">{tChar("noGuest")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 xl:grid-cols-4">
            {characters
              .filter((c) => c.scope === "guest")
              .map((char) => (
                <CharacterCard
                  key={char.id}
                  id={char.id}
                  projectId={projectId}
                  name={char.name}
                  description={char.description}
                  visualHint={char.visualHint}
                  assets={char.assets}
                  scope={char.scope}
                  episodeIds={char.episodeIds ?? []}
                  allEpisodes={episodes}
                  onUpdate={fetchData}
                  onPromote={() => handlePromote(char.id)}
                  onDelete={() => handleDelete(char.id, char.name)}
                />
              ))}
          </div>
        )}
      </section>

      {/* DEAD CODE kept for reference — remove after confirming new layout works
      {guestOrphans.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">
                  {tChar("guestOrphanSection")}
                  <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">
                    {guestOrphans.length}
                  </span>
                </h4>
                <p className="mb-3 text-xs leading-relaxed text-[--text-muted]">
                  {tChar("guestOrphanHint")}
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 xl:grid-cols-4">
                  {guestOrphans.map((char) => (
                    <CharacterCard
      */}
    </div>
  );
}
