"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { toast } from "sonner";
import { MapPin, Plus, Trash2, ImageIcon, Loader2, Sparkles, Wand2, Check, RotateCcw, ChevronDown, X, ZoomIn } from "lucide-react";

/** 角度预设 */
const ANGLE_PRESETS = [
  { key: "side_walk", label: "横向侧视", hint: "路横铺·建筑作背景·适合行走镜头" },
  { key: "front_facing", label: "正面视角", hint: "摄影机正对场景主体" },
  { key: "overhead_45", label: "俯瞰45°", hint: "斜上方视角·可见地面与建筑顶" },
  { key: "low_angle", label: "仰拍视角", hint: "低角度仰拍·场景高耸宏伟" },
] as const;

interface ExtractedScene {
  name: string;
  description: string;
  shotSequences: number[];
  selected: boolean;
  editedName: string;
  editedDescription: string;
}

interface Scene {
  id: string;
  name: string;
  description: string;
  imagePath: string | null;
  episodeId: string | null;
  createdAt: number;
}

interface SceneVariant {
  id: string;
  sceneId: string;
  label: string;
  imagePath: string;
  createdAt: number;
}

export default function ScenesPage() {
  const params = useParams<{ id: string; episodeId: string }>();
  const { id: projectId, episodeId } = params;
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const imageGuard = useModelGuard("image");
  const textGuard = useModelGuard("text");

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [anglePopover, setAnglePopover] = useState<string | null>(null);
  const [customAngles, setCustomAngles] = useState<Record<string, string>>({});
  const [variantingIds, setVariantingIds] = useState<Set<string>>(new Set());
  const [imageTimestamps, setImageTimestamps] = useState<Record<string, number>>({});
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  // 变体数据：sceneId -> SceneVariant[]
  const [variantsMap, setVariantsMap] = useState<Record<string, SceneVariant[]>>({});
  const [deletingVariantId, setDeletingVariantId] = useState<string | null>(null);
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const [extracting, setExtracting] = useState(false);
  const [extractedScenes, setExtractedScenes] = useState<ExtractedScene[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function fetchScenes() {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/scenes?episodeId=${episodeId}`);
      const data = await res.json() as Scene[];
      setScenes(data);
      // 同时加载每个场景的变体
      await fetchAllVariants(data);
    } catch {
      toast.error("加载场景失败");
    } finally {
      setLoading(false);
    }
  }

  async function fetchAllVariants(sceneList: Scene[]) {
    try {
      const results = await Promise.all(
        sceneList.map((s) =>
          apiFetch(`/api/projects/${projectId}/scenes/${s.id}/variants`)
            .then((r) => r.json() as Promise<SceneVariant[]>)
            .then((variants) => ({ sceneId: s.id, variants }))
            .catch(() => ({ sceneId: s.id, variants: [] as SceneVariant[] }))
        )
      );
      const map: Record<string, SceneVariant[]> = {};
      for (const { sceneId, variants } of results) {
        map[sceneId] = variants;
      }
      setVariantsMap(map);
    } catch {
      // 静默失败
    }
  }

  useEffect(() => {
    fetchScenes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, episodeId]);

  async function handleExtract() {
    if (!textGuard()) return;
    const textModelConfig = getModelConfig();
    if (!textModelConfig?.text) {
      toast.error("请先配置文本模型");
      return;
    }
    setExtracting(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scene_extract", modelConfig: textModelConfig, episodeId }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "提取失败");
      }
      const { scenes: raw } = await res.json() as {
        scenes: Array<{ name: string; description: string; shotSequences: number[] }>;
      };
      setExtractedScenes(raw.map((s) => ({ ...s, selected: true, editedName: s.name, editedDescription: s.description })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "场景提取失败");
    } finally {
      setExtracting(false);
    }
  }

  async function handleConfirmExtracted() {
    if (!extractedScenes) return;
    const toCreate = extractedScenes.filter((s) => s.selected);
    if (toCreate.length === 0) { setExtractedScenes(null); return; }
    setConfirming(true);
    try {
      await Promise.all(
        toCreate.map((s) =>
          apiFetch(`/api/projects/${projectId}/scenes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: s.editedName, description: s.editedDescription, episodeId }),
          })
        )
      );
      toast.success(`已创建 ${toCreate.length} 个场景`);
      setExtractedScenes(null);
      await fetchScenes();
    } catch {
      toast.error("批量创建失败");
    } finally {
      setConfirming(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), episodeId }),
      });
      if (!res.ok) throw new Error("创建失败");
      setNewName("");
      setNewDesc("");
      setShowForm(false);
      await fetchScenes();
      toast.success("场景已创建");
    } catch {
      toast.error("创建场景失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(sceneId: string) {
    setDeletingId(sceneId);
    try {
      await apiFetch(`/api/projects/${projectId}/scenes/${sceneId}`, { method: "DELETE" });
      setScenes((prev) => prev.filter((s) => s.id !== sceneId));
      setVariantsMap((prev) => { const next = { ...prev }; delete next[sceneId]; return next; });
      toast.success("场景已删除");
    } catch {
      toast.error("删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteVariant(sceneId: string, variantId: string) {
    setDeletingVariantId(variantId);
    try {
      await apiFetch(`/api/projects/${projectId}/scenes/${sceneId}/variants/${variantId}`, {
        method: "DELETE",
      });
      setVariantsMap((prev) => ({
        ...prev,
        [sceneId]: (prev[sceneId] ?? []).filter((v) => v.id !== variantId),
      }));
      toast.success("变体已删除");
    } catch {
      toast.error("删除失败");
    } finally {
      setDeletingVariantId(null);
    }
  }

  async function handleGenerateImage(scene: Scene) {
    if (!imageGuard()) return;
    setGeneratingIds((prev) => new Set(prev).add(scene.id));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scene_image_generate",
          payload: { sceneId: scene.id },
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || "生成失败");
      }
      const { imagePath } = await res.json() as { imagePath?: string };
      if (imagePath) {
        setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, imagePath } : s)));
        setImageTimestamps((prev) => ({ ...prev, [scene.id]: Date.now() }));
      } else {
        await fetchScenes();
      }
      toast.success(`「${scene.name}」参考图已生成`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGeneratingIds((prev) => { const next = new Set(prev); next.delete(scene.id); return next; });
    }
  }

  async function handleAngleVariant(scene: Scene, anglePreset?: string, customAngle?: string) {
    if (!imageGuard()) return;
    setAnglePopover(null);
    setVariantingIds((prev) => new Set(prev).add(scene.id));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scene_angle_variant",
          payload: { sceneId: scene.id, anglePreset, customAngle },
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || "生成失败");
      }
      const { variantId, imagePath, label } = await res.json() as {
        variantId?: string;
        imagePath?: string;
        label?: string;
      };
      if (variantId && imagePath) {
        const newVariant: SceneVariant = {
          id: variantId,
          sceneId: scene.id,
          label: label ?? "变体",
          imagePath,
          createdAt: Date.now(),
        };
        setVariantsMap((prev) => ({
          ...prev,
          [scene.id]: [...(prev[scene.id] ?? []), newVariant],
        }));
      }
      toast.success(`「${scene.name}」角度变体已生成`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setVariantingIds((prev) => { const next = new Set(prev); next.delete(scene.id); return next; });
    }
  }

  async function handleUploadImage(sceneId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const uploadRes = await apiFetch(`/api/projects/${projectId}/scenes/${sceneId}/upload-image`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("上传失败");
      const { imagePath } = await uploadRes.json() as { imagePath: string };
      setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, imagePath } : s)));
      toast.success("场景参考图已更新");
    } catch {
      toast.error("上传失败");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">场景管理</h1>
          <span className="text-sm text-muted-foreground">
            — 为分镜关联场景参考图，保证同场景视觉一致性
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleExtract} disabled={extracting}>
            {extracting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
            {extracting ? "提取中…" : "从分镜提取"}
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新建场景
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/3 p-4 space-y-3">
          <Input
            placeholder="场景名称（如：石板路村口、御书房、客栈大堂）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Input
            placeholder="场景描述（可选）—— 用于 AI 生成参考图的文字依据"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              确认创建
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      {/* 提取结果确认面板 */}
      {extractedScenes && (
        <div className="rounded-xl border border-primary/30 bg-primary/3 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">AI 识别到 {extractedScenes.length} 个场景，请确认后创建：</p>
            <Button size="xs" variant="ghost" onClick={() => setExtractedScenes(null)}>取消</Button>
          </div>
          <div className="space-y-2">
            {extractedScenes.map((scene, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 transition-colors ${
                  scene.selected ? "border-primary/30 bg-white" : "border-[--border-subtle] bg-[--surface] opacity-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() =>
                      setExtractedScenes((prev) =>
                        prev ? prev.map((s, j) => (j === i ? { ...s, selected: !s.selected } : s)) : prev
                      )
                    }
                    className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                      scene.selected ? "border-primary bg-primary text-white" : "border-[--border-subtle]"
                    }`}
                  >
                    {scene.selected && <Check className="h-2.5 w-2.5" />}
                  </button>
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={scene.editedName}
                      onChange={(e) =>
                        setExtractedScenes((prev) =>
                          prev ? prev.map((s, j) => (j === i ? { ...s, editedName: e.target.value } : s)) : prev
                        )
                      }
                      className="h-7 text-sm font-medium"
                      placeholder="场景名"
                    />
                    <textarea
                      value={scene.editedDescription}
                      onChange={(e) =>
                        setExtractedScenes((prev) =>
                          prev ? prev.map((s, j) => (j === i ? { ...s, editedDescription: e.target.value } : s)) : prev
                        )
                      }
                      rows={2}
                      className="w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="场景描述"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      涉及分镜：{scene.shotSequences.join("、")}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleConfirmExtracted}
              disabled={confirming || extractedScenes.every((s) => !s.selected)}
            >
              {confirming && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              创建选中的 {extractedScenes.filter((s) => s.selected).length} 个场景
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExtractedScenes((prev) => prev ? prev.map((s) => ({ ...s, selected: true })) : prev)}
            >
              全选
            </Button>
          </div>
        </div>
      )}

      {/* Scene list */}
      {scenes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <MapPin className="h-10 w-10 opacity-20" />
          <p className="text-sm">还没有场景，点击「新建场景」开始</p>
          <p className="text-xs opacity-60">
            提示：为分镜关联场景后，生成首帧时会自动将场景参考图作为 @图N 注入 prompt，实现同场景视觉锚定
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {scenes.map((scene) => {
            const variants = variantsMap[scene.id] ?? [];
            return (
              <div key={scene.id} className="rounded-xl border border-[--border-subtle] bg-white">
                {/* 主场景行 */}
                <div className="flex gap-4 p-4">
                  {/* 主图 */}
                  <div className="relative flex-shrink-0">
                    {scene.imagePath ? (
                      <button
                        className="group relative block h-24 w-36 overflow-hidden rounded-lg"
                        onClick={() =>
                          setLightboxImage({
                            url: `${uploadUrl(scene.imagePath!)}${imageTimestamps[scene.id] ? `?t=${imageTimestamps[scene.id]}` : ""}`,
                            name: scene.name,
                          })
                        }
                        title="点击查看大图"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${uploadUrl(scene.imagePath)}${imageTimestamps[scene.id] ? `?t=${imageTimestamps[scene.id]}` : ""}`}
                          alt={scene.name}
                          className="h-24 w-36 object-cover transition-transform group-hover:scale-105"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                          <ZoomIn className="h-5 w-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-white">
                          主图
                        </span>
                      </button>
                    ) : (
                      <div className="flex h-24 w-36 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[--border-subtle] bg-[--surface] text-[--text-muted]">
                        <ImageIcon className="h-5 w-5 opacity-30" />
                        <span className="text-[10px]">暂无参考图</span>
                      </div>
                    )}
                  </div>

                  {/* Info + actions */}
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <p className="text-sm font-medium">{scene.name}</p>
                      {scene.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{scene.description}</p>
                      )}
                      {scene.episodeId === null && (
                        <span className="mt-1 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                          项目级场景
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {/* AI generate */}
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => handleGenerateImage(scene)}
                        disabled={generatingIds.has(scene.id)}
                        title="用场景描述 + 项目画风生成参考图"
                      >
                        {generatingIds.has(scene.id) ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1 h-3 w-3" />
                        )}
                        AI 生成参考图
                      </Button>

                      {/* 角度变体（仅已有参考图时显示） */}
                      {scene.imagePath && (
                        <div className="relative">
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setAnglePopover((prev) => (prev === scene.id ? null : scene.id))}
                            disabled={variantingIds.has(scene.id)}
                            title="以现有参考图为基础，生成不同拍摄角度的版本"
                          >
                            {variantingIds.has(scene.id) ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="mr-1 h-3 w-3" />
                            )}
                            生成角度变体
                            <ChevronDown className="ml-0.5 h-3 w-3 opacity-60" />
                          </Button>

                          {anglePopover === scene.id && (
                            <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-[--border-subtle] bg-white p-2 shadow-lg">
                              <p className="mb-1.5 px-1 text-[10px] font-medium text-muted-foreground">
                                选择角度 — 以现有场景图风格为基础重新渲染（原图保留）
                              </p>
                              {ANGLE_PRESETS.map((preset) => (
                                <button
                                  key={preset.key}
                                  onClick={() => handleAngleVariant(scene, preset.key)}
                                  className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-[--surface] transition-colors"
                                >
                                  <span className="text-xs font-medium">{preset.label}</span>
                                  <span className="text-[10px] text-muted-foreground">{preset.hint}</span>
                                </button>
                              ))}
                              <div className="mt-1.5 border-t border-[--border-subtle] pt-1.5">
                                <p className="mb-1 px-1 text-[10px] text-muted-foreground">自定义角度描述</p>
                                <div className="flex gap-1">
                                  <Input
                                    value={customAngles[scene.id] ?? ""}
                                    onChange={(e) =>
                                      setCustomAngles((prev) => ({ ...prev, [scene.id]: e.target.value }))
                                    }
                                    placeholder="如：斜侧45°，路面向右延伸…"
                                    className="h-7 text-xs"
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && customAngles[scene.id]?.trim()) {
                                        handleAngleVariant(scene, undefined, customAngles[scene.id]);
                                      }
                                    }}
                                  />
                                  <Button
                                    size="xs"
                                    onClick={() => handleAngleVariant(scene, undefined, customAngles[scene.id])}
                                    disabled={!customAngles[scene.id]?.trim()}
                                  >
                                    生成
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Upload */}
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => fileInputRefs.current.get(scene.id)?.click()}
                      >
                        <ImageIcon className="mr-1 h-3 w-3" />
                        上传图片
                      </Button>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={(el) => { if (el) fileInputRefs.current.set(scene.id, el); }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadImage(scene.id, file);
                        }}
                      />

                      {/* Delete */}
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleDelete(scene.id)}
                        disabled={deletingId === scene.id}
                        className="text-destructive hover:text-destructive"
                      >
                        {deletingId === scene.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 变体 gallery（仅有变体时显示） */}
                {variants.length > 0 && (
                  <div className="border-t border-[--border-subtle] px-4 pb-3 pt-2">
                    <p className="mb-2 text-[10px] font-medium text-muted-foreground">
                      角度变体（{variants.length} 张）— 分镜中可选择特定变体作为场景参考
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {variants.map((v) => (
                        <div key={v.id} className="group relative">
                          <button
                            className="relative block h-16 w-24 overflow-hidden rounded-lg"
                            onClick={() =>
                              setLightboxImage({ url: uploadUrl(v.imagePath), name: `${scene.name} · ${v.label}` })
                            }
                            title={`查看大图：${v.label}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={uploadUrl(v.imagePath)}
                              alt={v.label}
                              className="h-16 w-24 object-cover transition-transform group-hover:scale-105"
                            />
                            <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent">
                              <span className="w-full truncate px-1 pb-0.5 text-[9px] text-white">
                                {v.label}
                              </span>
                            </div>
                          </button>
                          {/* 删除按钮 */}
                          <button
                            onClick={() => handleDeleteVariant(scene.id, v.id)}
                            disabled={deletingVariantId === v.id}
                            className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-white shadow group-hover:flex"
                            title="删除此变体"
                          >
                            {deletingVariantId === v.id ? (
                              <Loader2 className="h-2 w-2 animate-spin" />
                            ) : (
                              <X className="h-2 w-2" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 大图预览 lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setLightboxImage(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxImage.url}
              alt={lightboxImage.name}
              className="max-h-[85vh] max-w-[85vw] object-contain"
            />
            <div className="bg-black/60 px-4 py-2 text-center text-sm text-white">
              {lightboxImage.name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
