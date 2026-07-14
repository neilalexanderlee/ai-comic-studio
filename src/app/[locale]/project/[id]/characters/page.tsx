"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, Loader2, ImageIcon, Mic, ChevronDown, ChevronUp, Star, Sword, Sparkles, Palette } from "lucide-react";
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
    assetType: "morph" | "blueprint" | "prop";
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
  const [restylingCharacters, setRestylingCharacters] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [voiceProgress, setVoiceProgress] = useState<{ done: number; total: number } | null>(null);
  const [restyleProgress, setRestyleProgress] = useState<{ done: number; total: number } | null>(null);
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

  async function handleBatchRestyleCharacters() {
    if (!confirm("将按项目当前画风重新改写所有角色的视觉描述和识别码，尽量保留角色身份但会替换旧画风/旧时代的服装场景元素。确定继续吗？")) return;
    setRestylingCharacters(true);
    setRestyleProgress(null);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_character_restyle",
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
            if (evt.type === "start") setRestyleProgress({ done: 0, total: evt.totalCount });
            if (evt.type === "progress") {
              setRestyleProgress({ done: evt.updatedCount, total: evt.totalCount });
              if (evt.characterId && evt.description) {
                setCharacters((prev) =>
                  prev.map((c) =>
                    c.id === evt.characterId
                      ? { ...c, description: evt.description, visualHint: evt.visualHint ?? c.visualHint }
                      : c
                  )
                );
              }
            }
            if (evt.type === "done") {
              toast.success(`已按当前画风重新改写 ${evt.updatedCount}/${evt.totalCount} 个角色`);
              setRestyleProgress(null);
              fetchData();
            }
            if (evt.type === "error") toast.error(evt.error ?? "生成失败");
          } catch {}
        }
      }
    } catch (err) {
      console.error("Batch character restyle error:", err);
      toast.error(tc("generationFailed"));
    }
    setRestylingCharacters(false);
    setRestyleProgress(null);
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
              onClick={handleBatchRestyleCharacters}
              disabled={restylingCharacters}
              size="sm"
              variant="outline"
              title="切换项目画风后，角色视觉描述/识别码不会自动更新；点此按当前画风重新改写所有角色"
            >
              {restylingCharacters ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Palette className="h-3.5 w-3.5" />
              )}
              {restylingCharacters
                ? restyleProgress
                  ? `${restyleProgress.done}/${restyleProgress.total}`
                  : tc("generating")
                : "按画风重新生成角色描述"}
            </Button>
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

      {/* 资产上传指南折叠卡 */}
      <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/60 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-blue-800">{tChar("assetGuideTitle")}</span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">推荐阅读</span>
          </div>
          {guideOpen
            ? <ChevronUp className="h-4 w-4 text-blue-400 flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 text-blue-400 flex-shrink-0" />
          }
        </button>

        {guideOpen && (
          <div className="px-4 pb-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs text-[--text-secondary] leading-relaxed border-t border-blue-100 pt-3">
            {/* 定妆图 */}
            <div className="rounded-xl bg-white/80 border border-blue-100 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-blue-700">
                <Sparkles className="h-3 w-3" />{tChar("assetGuideMorphTitle")}
              </div>
              <ul className="space-y-1.5 text-[11px]">
                <li>上传 <strong>1 张正面全身图</strong>（纯色背景，头顶到脚尖不截断）</li>
                <li><strong className="text-green-700">标志性武器（角色标配）</strong>→ 直接画进定妆图，AI 每次都能看到它</li>
                <li><strong className="text-orange-600">场景专属武器</strong>（只在特定集出现）→ 不画进定妆图，改用道具图</li>
                <li>上传后点「扩展角度」自动生成侧面/背面变体，改善视频中的外貌一致性</li>
              </ul>
            </div>

            {/* 道具图 */}
            <div className="rounded-xl bg-white/80 border border-amber-100 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                <Sword className="h-3 w-3" />{tChar("assetGuidePropTitle")}
              </div>
              <ul className="space-y-1.5 text-[11px]">
                <li><strong>剧情中途换武器</strong>（换了新剑）→ 新武器上传道具图</li>
                <li><strong>场景专属装备</strong>（某集才出现的盔甲、飞行器）</li>
                <li><strong>需要特写的道具细节</strong>（符文、铭刻、独特纹理）</li>
                <li>在分镜抽屉的「道具参考图」勾选后，生成首帧/视频时额外传给 AI</li>
              </ul>
            </div>

            {/* 主定妆图 */}
            <div className="rounded-xl bg-white/80 border border-yellow-100 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-yellow-700">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{tChar("assetGuideDefaultTitle")}
              </div>
              <ul className="space-y-1.5 text-[11px]">
                <li>带 ★ 的图是<strong>当前主定妆图</strong>——所有分镜生成都自动使用它</li>
                <li>同一角色可以有多张形态（日常/武装/礼服），点图片左下角五角星随时切换</li>
                <li><strong>换武器/换服装后只需切换主图</strong>，下次生成自动跟上，无需改分镜</li>
              </ul>
              <div className="mt-2 rounded-lg bg-yellow-50 border border-yellow-200 px-2 py-1.5 text-[10px] text-yellow-700">
                💡 形态标签建议和剧本一致（「日常」「武装」「礼服」等），便于快速找图
              </div>
            </div>
          </div>
        )}
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
