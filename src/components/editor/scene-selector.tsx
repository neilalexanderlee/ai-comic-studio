"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { MapPin, X, Check, Loader2, ChevronRight } from "lucide-react";

interface Scene {
  id: string;
  name: string;
  imagePath: string | null;
}

interface SceneVariant {
  id: string;
  sceneId: string;
  label: string;
  imagePath: string;
}

interface SceneSelectorProps {
  projectId: string;
  episodeId?: string | null;
  shotId: string;
  currentSceneId?: string | null;
  currentSceneVariantId?: string | null;
  onUpdate: () => void;
  disabled?: boolean;
}

export function SceneSelector({
  projectId,
  episodeId,
  shotId,
  currentSceneId,
  currentSceneVariantId,
  onUpdate,
  disabled = false,
}: SceneSelectorProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // 展开变体面板的场景 ID
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const [variantsMap, setVariantsMap] = useState<Record<string, SceneVariant[]>>({});
  const [loadingVariants, setLoadingVariants] = useState<string | null>(null);

  useEffect(() => {
    const url = episodeId
      ? `/api/projects/${projectId}/scenes?episodeId=${episodeId}`
      : `/api/projects/${projectId}/scenes`;
    apiFetch(url)
      .then((r) => r.json())
      .then((data: Scene[]) => setScenes(data))
      .catch(() => {});
  }, [projectId, episodeId]);

  const current = scenes.find((s) => s.id === currentSceneId);
  // 当前选中变体（可能不在 variantsMap 里，直接从 API 拿到的 id 先用占位）
  const currentVariants = currentSceneId ? (variantsMap[currentSceneId] ?? []) : [];
  const currentVariant = currentVariants.find((v) => v.id === currentSceneVariantId);

  async function loadVariants(sceneId: string) {
    if (variantsMap[sceneId]) return; // 已缓存
    setLoadingVariants(sceneId);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/scenes/${sceneId}/variants`);
      const data = await res.json() as SceneVariant[];
      setVariantsMap((prev) => ({ ...prev, [sceneId]: data }));
    } catch {
      // silent
    } finally {
      setLoadingVariants(null);
    }
  }

  async function select(sceneId: string | null, variantId?: string | null) {
    setSaving(true);
    setOpen(false);
    setExpandedSceneId(null);
    try {
      await apiFetch(`/api/projects/${projectId}/shots/${shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, sceneVariantId: variantId ?? null }),
      });
      onUpdate();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  async function handleSceneClick(scene: Scene) {
    // 如果点击已选中的场景 → 切换展开变体面板
    if (scene.id === expandedSceneId) {
      setExpandedSceneId(null);
      return;
    }
    setExpandedSceneId(scene.id);
    await loadVariants(scene.id);
  }

  if (scenes.length === 0) return null;

  // 按钮展示：优先显示变体缩略图，否则场景主图
  const thumbPath = currentVariant?.imagePath ?? current?.imagePath ?? null;

  return (
    <div className="relative">
      {/* 触发按钮 */}
      <button
        onClick={() => !disabled && !saving && setOpen((v) => !v)}
        disabled={disabled || saving}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
          current
            ? "bg-primary/8 text-primary hover:bg-primary/15"
            : "text-muted-foreground hover:bg-[--surface] hover:text-[--text-primary]"
        }`}
        title={
          current
            ? currentVariant
              ? `已关联场景：${current.name} · ${currentVariant.label}`
              : `已关联场景：${current.name}（主图）`
            : "点击关联场景（生成首帧时自动注入场景参考图）"
        }
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <MapPin className="h-3 w-3 flex-shrink-0" />
        )}
        {current ? (
          <>
            {thumbPath && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadUrl(thumbPath)}
                alt={current.name}
                className="h-4 w-6 rounded object-cover flex-shrink-0"
              />
            )}
            <span className="max-w-[100px] truncate font-medium">
              {current.name}
              {currentVariant && (
                <span className="ml-1 opacity-60">· {currentVariant.label}</span>
              )}
            </span>
          </>
        ) : (
          <span>关联场景</span>
        )}
      </button>

      {/* 下拉面板 */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-1.5 w-64 overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-xl">
            {/* 取消关联 */}
            <button
              onClick={() => select(null)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <X className="h-4 w-4 flex-shrink-0" />
              <span>不关联场景</span>
            </button>

            <div className="border-t border-[--border-subtle]" />

            {/* 场景列表 */}
            <div className="max-h-80 overflow-y-auto py-1">
              {scenes.map((scene) => {
                const isSelected = scene.id === currentSceneId;
                const isExpanded = scene.id === expandedSceneId;
                const variants = variantsMap[scene.id] ?? [];
                return (
                  <div key={scene.id}>
                    {/* 场景行 */}
                    <div className="flex items-center">
                      <button
                        onClick={() => select(scene.id, null)}
                        className={`flex flex-1 items-center gap-3 px-3 py-2.5 text-sm transition-colors text-left ${
                          isSelected && !currentSceneVariantId
                            ? "bg-primary/8 text-primary"
                            : "hover:bg-[--surface] text-[--text-primary]"
                        }`}
                      >
                        <div className="h-10 w-14 flex-shrink-0 overflow-hidden rounded-md bg-[--surface]">
                          {scene.imagePath ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={uploadUrl(scene.imagePath)}
                              alt={scene.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <MapPin className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                        <span className="flex-1 truncate text-xs font-medium leading-tight">
                          {scene.name}
                        </span>
                        {isSelected && !currentSceneVariantId && (
                          <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                        )}
                      </button>
                      {/* 展开变体按钮（有变体数据或点击后加载） */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSceneClick(scene); }}
                        className={`mr-1.5 flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                          isExpanded ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-[--surface]"
                        }`}
                        title="查看角度变体"
                      >
                        {loadingVariants === scene.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ChevronRight className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        )}
                      </button>
                    </div>

                    {/* 变体子面板 */}
                    {isExpanded && (
                      <div className="border-t border-[--border-subtle] bg-[--surface] px-3 py-2">
                        <p className="mb-1.5 text-[10px] text-muted-foreground">
                          选择角度变体（用于此分镜的场景参考图）
                        </p>
                        {variants.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground opacity-60">
                            暂无变体 — 在场景管理页生成
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {variants.map((v) => {
                              const isVariantSelected = v.id === currentSceneVariantId && scene.id === currentSceneId;
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => select(scene.id, v.id)}
                                  title={v.label}
                                  className={`relative h-12 w-16 overflow-hidden rounded-md border-2 transition-all ${
                                    isVariantSelected
                                      ? "border-primary ring-1 ring-primary"
                                      : "border-transparent hover:border-primary/40"
                                  }`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={uploadUrl(v.imagePath)}
                                    alt={v.label}
                                    className="h-full w-full object-cover"
                                  />
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-0.5 pb-0.5">
                                    <span className="block truncate text-[8px] text-white">{v.label}</span>
                                  </div>
                                  {isVariantSelected && (
                                    <div className="absolute right-0.5 top-0.5 rounded-full bg-primary p-0.5">
                                      <Check className="h-2 w-2 text-white" />
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
