"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useProjectStore } from "@/stores/project-store";
import { useModelStore } from "@/stores/model-store";
import { CharacterCard } from "@/components/editor/character-card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Users, Sparkles, ImageIcon, Loader2, X, UserPlus, ChevronDown, ChevronUp, Star, Sword } from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { toast } from "sonner";

interface ProjectCharacter {
  id: string;
  name: string;
  description: string;
  visualHint?: string | null;
}

export default function EpisodeCharactersPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const params = useParams<{ id: string; episodeId: string }>();
  const { id: projectId, episodeId } = params;

  const [guideOpen, setGuideOpen] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [allProjectChars, setAllProjectChars] = useState<ProjectCharacter[]>([]);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);

  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");

  // 拉全项目角色（不按集过滤）
  useEffect(() => {
    if (!projectId) return;
    apiFetch(`/api/projects/${projectId}/characters`)
      .then((r) => r.json())
      .then((data: ProjectCharacter[]) => setAllProjectChars(data))
      .catch(() => {});
  }, [projectId]);

  if (!project) return null;

  // 本集已绑定的角色 id 集合
  const linkedIds = new Set(project.characters.map((c) => c.id));
  // 全项目里还没绑本集的角色
  const unlinkedChars = allProjectChars.filter((c) => !linkedIds.has(c.id));

  async function handleExtractCharacters() {
    if (!project) return;
    if (!textGuard()) return;
    setExtracting(true);
    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "character_extract",
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      if (!response.ok) throw new Error("Character extract failed");
      await response.json();
    } catch (err) {
      console.error("Character extract error:", err);
      toast.error(t("common.generationFailed"));
    }
    setExtracting(false);
    fetchProject(project.id, episodeId);
  }

  async function handleUnlinkCharacter(characterId: string) {
    if (!project) return;
    setUnlinkingId(characterId);
    try {
      const res = await apiFetch(
        `/api/projects/${project.id}/episodes/${episodeId}/characters/${characterId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Unlink failed");
      await fetchProject(project.id, episodeId);
      toast.success("已从本集移除");
    } catch {
      toast.error("移除失败，请重试");
    } finally {
      setUnlinkingId(null);
    }
  }

  async function handleLinkCharacter(characterId: string) {
    if (!project) return;
    setLinkingId(characterId);
    try {
      const res = await apiFetch(
        `/api/projects/${project.id}/episodes/${episodeId}/characters/${characterId}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Link failed");
      await fetchProject(project.id, episodeId);
      // 同步更新全量列表（保持差集准确）
      const updated = await apiFetch(`/api/projects/${projectId}/characters`);
      setAllProjectChars(await updated.json());
      toast.success("已添加到本集");
    } catch {
      toast.error("添加失败，请重试");
    } finally {
      setLinkingId(null);
    }
  }

  async function handleBatchGenerateImages() {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingImages(true);
    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_character_image",
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch character image error:", err);
      toast.error(t("common.generationFailed"));
    }
    setGeneratingImages(false);
    fetchProject(project.id, episodeId);
  }

  return (
    <div className="animate-page-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.characters")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {project.characters.length} characters
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 添加角色到本集 */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddPopoverOpen((v) => !v)}
            >
              <UserPlus className="h-3.5 w-3.5" />
              添加角色
            </Button>
            {addPopoverOpen && (
              <>
                {/* 点击遮罩关闭 */}
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setAddPopoverOpen(false)}
                />
                <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-[--border-subtle] bg-white shadow-lg">
                  <div className="p-2">
                    {unlinkedChars.length === 0 ? (
                      <p className="py-4 text-center text-sm text-[--text-muted]">
                        所有角色已在本集中
                      </p>
                    ) : (
                      <div className="max-h-72 overflow-y-auto space-y-1">
                        <p className="px-2 pb-1 text-xs text-[--text-muted]">
                          点击将角色添加到本集
                        </p>
                        {unlinkedChars.map((char) => (
                          <button
                            key={char.id}
                            onClick={() => {
                              handleLinkCharacter(char.id);
                              setAddPopoverOpen(false);
                            }}
                            disabled={linkingId === char.id}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {char.name.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{char.name}</p>
                              {char.visualHint && (
                                <p className="truncate text-xs text-[--text-muted]">{char.visualHint}</p>
                              )}
                            </div>
                            {linkingId === char.id && (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <PromptEditButton promptKeys="character_extract" projectId={project.id} />
          <InlineModelPicker capability="text" />
          <Button
            onClick={handleExtractCharacters}
            disabled={extracting}
            variant="outline"
            size="sm"
          >
            {extracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {extracting ? t("common.generating") : t("project.extractCharacters")}
          </Button>
          {project.characters.length > 0 && (
            <>
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
                {generatingImages
                  ? t("common.generating")
                  : t("character.batchGenerateImages")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 资产上传指南折叠卡 */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-blue-800">{t("character.assetGuideTitle")}</span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">推荐阅读</span>
          </div>
          {guideOpen
            ? <ChevronUp className="h-4 w-4 text-blue-400 flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 text-blue-400 flex-shrink-0" />
          }
        </button>
        {guideOpen && (
          <div className="px-4 pb-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs text-[--text-secondary] leading-relaxed border-t border-blue-100 pt-3">
            <div className="rounded-xl bg-white/80 border border-blue-100 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-blue-700">
                <Sparkles className="h-3 w-3" />{t("character.assetGuideMorphTitle")}
              </div>
              <ul className="space-y-1.5 text-[11px]">
                <li>上传 <strong>1 张正面全身图</strong>（纯色背景，头顶到脚尖不截断）</li>
                <li><strong className="text-green-700">标志性武器（角色标配）</strong>→ 画进定妆图，AI 每次都能看到它</li>
                <li><strong className="text-orange-600">场景专属武器</strong>（只在特定集出现）→ 不画进定妆图，改用道具图</li>
                <li>上传后点「扩展角度」自动生成侧面/背面变体，改善视频外貌一致性</li>
              </ul>
            </div>
            <div className="rounded-xl bg-white/80 border border-amber-100 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                <Sword className="h-3 w-3" />{t("character.assetGuidePropTitle")}
              </div>
              <ul className="space-y-1.5 text-[11px]">
                <li><strong>剧情中途换武器</strong>（换了新剑）→ 新武器上传道具图</li>
                <li><strong>场景专属装备</strong>（某集才出现的盔甲、飞行器）</li>
                <li><strong>需要特写的道具细节</strong>（符文、铭刻、独特纹理）</li>
                <li>在分镜抽屉「道具参考图」勾选后，生成首帧/视频时额外传给 AI</li>
              </ul>
            </div>
            <div className="rounded-xl bg-white/80 border border-yellow-100 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-yellow-700">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{t("character.assetGuideDefaultTitle")}
              </div>
              <ul className="space-y-1.5 text-[11px]">
                <li>带 ★ 的图是<strong>当前主定妆图</strong>——所有分镜生成都自动使用它</li>
                <li>同一角色可有多张形态，点图片左下角五角星随时切换</li>
                <li><strong>换武器/换服装后只需切换主图</strong>，下次生成自动跟上</li>
              </ul>
              <div className="mt-2 rounded-lg bg-yellow-50 border border-yellow-200 px-2 py-1.5 text-[10px] text-yellow-700">
                💡 形态标签建议和剧本一致（「日常」「武装」「礼服」等）
              </div>
            </div>
          </div>
        )}
      </div>

      {project.characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Users className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.characters")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("character.noCharacters")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {project.characters.map((char) => (
            <div key={char.id} className="relative group">
              <CharacterCard
                id={char.id}
                projectId={project.id}
                name={char.name}
                description={char.description}
                visualHint={char.visualHint ?? null}
                voiceHint={char.voiceHint ?? null}
                assets={char.assets}
                onUpdate={() => fetchProject(project.id, episodeId)}
                batchGenerating={generatingImages}
              />
              {/* 解绑按钮：hover 时显示在卡片右上角 */}
              <button
                onClick={() => handleUnlinkCharacter(char.id)}
                disabled={unlinkingId === char.id}
                title="从本集移除"
                className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {unlinkingId === char.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
