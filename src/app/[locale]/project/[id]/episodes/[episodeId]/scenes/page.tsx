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
import { MapPin, Plus, Trash2, ImageIcon, Loader2, Sparkles, Wand2, Check } from "lucide-react";

interface ExtractedScene {
  name: string;
  description: string;
  shotSequences: number[];
  selected: boolean; // UI only
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
  // Set 支持多个场景同时生成
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // 从分镜提取场景
  const [extracting, setExtracting] = useState(false);
  const [extractedScenes, setExtractedScenes] = useState<ExtractedScene[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function fetchScenes() {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/scenes?episodeId=${episodeId}`
      );
      const data = await res.json();
      setScenes(data);
    } catch {
      toast.error("加载场景失败");
    } finally {
      setLoading(false);
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
        body: JSON.stringify({
          action: "scene_extract",
          modelConfig: textModelConfig,
          episodeId,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || "提取失败");
      }
      const { scenes: raw } = await res.json() as {
        scenes: Array<{ name: string; description: string; shotSequences: number[] }>;
      };
      setExtractedScenes(
        raw.map((s) => ({
          ...s,
          selected: true,
          editedName: s.name,
          editedDescription: s.description,
        }))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "场景提取失败");
    } finally {
      setExtracting(false);
    }
  }

  async function handleConfirmExtracted() {
    if (!extractedScenes) return;
    const toCreate = extractedScenes.filter((s) => s.selected);
    if (toCreate.length === 0) {
      setExtractedScenes(null);
      return;
    }
    setConfirming(true);
    try {
      await Promise.all(
        toCreate.map((s) =>
          apiFetch(`/api/projects/${projectId}/scenes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: s.editedName,
              description: s.editedDescription,
              episodeId,
            }),
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
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          episodeId,
        }),
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
      await apiFetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: "DELETE",
      });
      setScenes((prev) => prev.filter((s) => s.id !== sceneId));
      toast.success("场景已删除");
    } catch {
      toast.error("删除失败");
    } finally {
      setDeletingId(null);
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
      // 乐观更新：直接更新本条场景的 imagePath，不全量 refetch
      const { imagePath } = await res.json() as { imagePath?: string };
      if (imagePath) {
        setScenes((prev) =>
          prev.map((s) => (s.id === scene.id ? { ...s, imagePath } : s))
        );
      } else {
        await fetchScenes();
      }
      toast.success(`「${scene.name}」参考图已生成`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(scene.id);
        return next;
      });
    }
  }

  async function handleUploadImage(sceneId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const uploadRes = await apiFetch(
        `/api/projects/${projectId}/scenes/${sceneId}/upload-image`,
        { method: "POST", body: formData }
      );
      if (!uploadRes.ok) throw new Error("上传失败");
      const { imagePath } = await uploadRes.json() as { imagePath: string };
      // 乐观更新
      setScenes((prev) =>
        prev.map((s) => (s.id === sceneId ? { ...s, imagePath } : s))
      );
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
          <Button
            size="sm"
            variant="outline"
            onClick={handleExtract}
            disabled={extracting}
          >
            {extracting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="mr-1 h-3.5 w-3.5" />
            )}
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
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 提取结果确认面板 */}
      {extractedScenes && (
        <div className="rounded-xl border border-primary/30 bg-primary/3 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              AI 识别到 {extractedScenes.length} 个场景，请确认后创建：
            </p>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setExtractedScenes(null)}
            >
              取消
            </Button>
          </div>

          <div className="space-y-2">
            {extractedScenes.map((scene, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 transition-colors ${
                  scene.selected
                    ? "border-primary/30 bg-white"
                    : "border-[--border-subtle] bg-[--surface] opacity-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() =>
                      setExtractedScenes((prev) =>
                        prev
                          ? prev.map((s, j) =>
                              j === i ? { ...s, selected: !s.selected } : s
                            )
                          : prev
                      )
                    }
                    className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                      scene.selected
                        ? "border-primary bg-primary text-white"
                        : "border-[--border-subtle]"
                    }`}
                  >
                    {scene.selected && <Check className="h-2.5 w-2.5" />}
                  </button>
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={scene.editedName}
                      onChange={(e) =>
                        setExtractedScenes((prev) =>
                          prev
                            ? prev.map((s, j) =>
                                j === i ? { ...s, editedName: e.target.value } : s
                              )
                            : prev
                        )
                      }
                      className="h-7 text-sm font-medium"
                      placeholder="场景名"
                    />
                    <textarea
                      value={scene.editedDescription}
                      onChange={(e) =>
                        setExtractedScenes((prev) =>
                          prev
                            ? prev.map((s, j) =>
                                j === i
                                  ? { ...s, editedDescription: e.target.value }
                                  : s
                              )
                            : prev
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
              onClick={() =>
                setExtractedScenes((prev) =>
                  prev ? prev.map((s) => ({ ...s, selected: true })) : prev
                )
              }
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
            提示：为分镜关联场景后，生成首帧时会自动将场景参考图作为
            @图N 注入 prompt，实现同场景视觉锚定
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {scenes.map((scene) => (
            <div
              key={scene.id}
              className="flex gap-4 rounded-xl border border-[--border-subtle] bg-white p-4"
            >
              {/* Image area */}
              <div className="relative flex-shrink-0">
                {scene.imagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={uploadUrl(scene.imagePath)}
                    alt={scene.name}
                    className="h-24 w-36 rounded-lg object-cover"
                  />
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
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {scene.description}
                    </p>
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
                    ref={(el) => {
                      if (el) fileInputRefs.current.set(scene.id, el);
                    }}
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
          ))}
        </div>
      )}
    </div>
  );
}
