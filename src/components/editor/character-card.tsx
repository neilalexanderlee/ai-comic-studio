"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { Sparkles, Loader2, Copy, Check, Trash2, Upload, X, Plus, Mic, MicOff, Music } from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";

/** 音色快捷预设（与 seedance-multi-param.ts DEFAULT_VOICE_PROFILES 保持同步） */
const VOICE_PRESETS = [
  { label: "男青年", text: "男声，青年音色，音调中等，音色干净，声音厚度适中，发音清晰，气息平稳，语速适中" },
  { label: "女温柔", text: "女声，青年音色，音调中等偏高，音色质感明亮清脆，声音清亮柔和，气息充沛平稳，带温婉真诚感" },
  { label: "男权威", text: "男声，中年音色，音调低沉，音色浑厚有力，声音厚重，发音标准，气息极其沉稳，语速偏慢" },
  { label: "女活泼", text: "女声，青年音色，音调偏高，音色清脆活泼，声音轻盈，气息充沛，语速偏快，带笑意和感染力" },
  { label: "男反派", text: "男声，中年音色，音调低沉，音色质感干燥偏暗，声音带沙砾感，气息平稳，语速极慢，有威胁感" },
] as const;

export interface CharacterAsset {
  id: string;
  imagePath: string | null;
  tag: string;
  assetType: "morph" | "blueprint";
  isDefault: number;
  /** 参考音频路径（MP3/WAV/M4A），用于 Seedance 多参模式音色克隆 */
  audioPath?: string | null;
}

export interface EpisodeRef {
  id: string;
  sequence: number;
  title: string;
}

interface CharacterCardProps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  visualHint: string | null;
  /** 9维度文字音色描述（性别/年龄音色/音调/音色质感/声音厚度/发音方式/气息/语速/特殊质感） */
  voiceHint?: string | null;
  assets?: CharacterAsset[];
  onUpdate: () => void;
  batchGenerating?: boolean;
  onDelete?: () => void;
  /** IDs of episodes this character is associated with */
  episodeIds?: string[];
  /** All episodes in the project — needed to render the add-episode picker */
  allEpisodes?: EpisodeRef[];
}

export function CharacterCard({
  id,
  projectId,
  name,
  description,
  visualHint,
  voiceHint,
  assets = [],
  onUpdate,
  batchGenerating,
  onDelete,
  episodeIds = [],
  allEpisodes = [],
}: CharacterCardProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const providers = useModelStore((s) => s.providers);
  const defaultImageModel = useModelStore((s) => s.defaultImageModel);
  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(() => defaultImageModel);
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [editVisualHint, setEditVisualHint] = useState(visualHint ?? "");
  const [editVoiceHint, setEditVoiceHint] = useState(voiceHint ?? "");
  const [uploadingAudio, setUploadingAudio] = useState(false);
  // 角色级别：任意 asset 有 audioPath 即视为已设置
  const audioAsset = assets.find((a) => !!a.audioPath) ?? null;

  // Sync local state when props change (e.g. after re-extraction)
  useEffect(() => { setEditName(name); }, [name]);
  useEffect(() => { setEditDesc(description); }, [description]);
  useEffect(() => { setEditVisualHint(visualHint ?? ""); }, [visualHint]);
  const [generating, setGenerating] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const imageGuard = useModelGuard("image");

  // Episode association state (guest characters only)
  const [localEpisodeIds, setLocalEpisodeIds] = useState<string[]>(episodeIds);
  const [showEpPicker, setShowEpPicker] = useState(false);
  const [savingEpisodes, setSavingEpisodes] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLocalEpisodeIds(episodeIds); }, [JSON.stringify(episodeIds)]);

  async function updateEpisodeIds(ids: string[]) {
    setLocalEpisodeIds(ids);
    setSavingEpisodes(true);
    try {
      await apiFetch(`/api/projects/${projectId}/characters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeIds: ids }),
      });
      onUpdate();
    } finally {
      setSavingEpisodes(false);
    }
  }

  function removeEpisode(epId: string) {
    updateEpisodeIds(localEpisodeIds.filter((x) => x !== epId));
  }

  function addEpisode(epId: string) {
    if (localEpisodeIds.includes(epId)) return;
    updateEpisodeIds([...localEpisodeIds, epId]);
    setShowEpPicker(false);
  }

  const linkedEpisodes = allEpisodes.filter((e) => localEpisodeIds.includes(e.id));
  const unlinkedEpisodes = allEpisodes.filter((e) => !localEpisodeIds.includes(e.id));

  // Gacha State
  const [gachaOpen, setGachaOpen] = useState(false);
  const [gachaAssetId, setGachaAssetId] = useState<string | null>(null);
  const [gachaCount, setGachaCount] = useState(4);
  const [gachaPaths, setGachaPaths] = useState<string[]>([]);
  const [isGachaGenerating, setIsGachaGenerating] = useState(false);
  /** 形态名称编辑草稿（受控 input 需本地 state，否则无法键入） */
  const [assetTagDrafts, setAssetTagDrafts] = useState<Record<string, string>>({});

  const isGenerating = generating;

  useEffect(() => {
    const ids = new Set(assets.map((a) => a.id));
    setAssetTagDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!ids.has(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [assets]);

  function resolveImageRef(ref: ModelRef | null) {
    if (!ref) return null;
    const provider = providers.find((p) => p.id === ref.providerId);
    if (!provider) return null;
    return {
      providerId: provider.id,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey || "",
      secretKey: provider.secretKey,
      modelId: ref.modelId,
    };
  }

  async function handleSave() {
    await apiFetch(`/api/projects/${projectId}/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc, visualHint: editVisualHint, voiceHint: editVoiceHint }),
    });
    onUpdate();
  }

  async function handleUploadAsset(assetId: string, file: File) {
    if (!file) return;
    setUploadingField(assetId);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await apiFetch(`/api/projects/${projectId}/characters/${id}/upload-asset?assetId=${assetId}`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      toast.success(t("common.save"));
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error(t("common.saveFailed"));
    } finally {
      setUploadingField(null);
    }
  }

  /** 角色级别音频上传（不需要指定 assetId，后端自动绑到默认定妆图） */
  async function handleUploadAudio(file: File) {
    setUploadingAudio(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/characters/${id}/upload-audio`,
        { method: "POST", body: formData }
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "上传失败");
      }
      toast.success("音色参考已上传，Seedance 将克隆此音色");
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "音频上传失败");
    } finally {
      setUploadingAudio(false);
    }
  }

  /** 角色级别音频清除 */
  async function handleClearAudio() {
    try {
      await apiFetch(
        `/api/projects/${projectId}/characters/${id}/upload-audio`,
        { method: "DELETE" }
      );
      toast.success("音色参考已清除");
      onUpdate();
    } catch (err) {
      toast.error("清除失败");
    }
  }

  async function handleAddAsset(type: "morph" | "blueprint" = "morph") {
    try {
      const response = await apiFetch(`/api/projects/${projectId}/characters/${id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: type === "blueprint" ? "四视图" : "新形态", assetType: type }),
      });
      if (!response.ok) throw new Error("Add failed");
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error("Failed to add asset");
    }
  }

  async function handleUpdateAssetTag(assetId: string, tag: string): Promise<boolean> {
    try {
      await apiFetch(`/api/projects/${projectId}/characters/${id}/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      onUpdate();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  async function handleDeleteAsset(assetId: string) {
    if (!confirm("确定删除此形态吗？图片文件也会一并删除。")) return;
    try {
      await apiFetch(`/api/projects/${projectId}/characters/${id}/assets/${assetId}`, {
        method: "DELETE",
      });
      onUpdate();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleClearImage(assetId: string) {
    try {
      await apiFetch(`/api/projects/${projectId}/characters/${id}/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: null }),
      });
      onUpdate();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleGachaGenerate() {
    if (!gachaAssetId || !imageGuard()) return;
    const targetAsset = assets.find(a => a.id === gachaAssetId);
    if (!targetAsset) return;

    setIsGachaGenerating(true);
    setGachaPaths([]);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_character_image",
          payload: { 
            characterId: id, 
            assetId: targetAsset.id, // Pass assetId for auto-save support
            targetSlot: targetAsset.tag, 
            count: gachaCount, 
            autoSave: false 
          },
          modelConfig: { ...getModelConfig(), image: resolveImageRef(imageModelRef) },
        }),
      });
      const data = await response.json();
      if (data.imagePaths) {
        setGachaPaths(data.imagePaths);
      } else {
        toast.error(data.error || "Generation failed");
      }
    } catch (err) {
      console.error("Gacha generate error:", err);
      toast.error(t("common.generationFailed"));
    }
    setIsGachaGenerating(false);
  }

  async function saveGachaImage(path: string) {
    if (!gachaAssetId) return;
    try {
      const response = await apiFetch(`/api/projects/${projectId}/characters/${id}/assets/${gachaAssetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: path }),
      });
      if (!response.ok) throw new Error("Save failed");
      toast.success(t("common.save"));
      setGachaOpen(false);
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error(t("common.saveFailed"));
    }
  }

  function renderAssetSlot(asset: CharacterAsset) {
    const isUploadingThis = uploadingField === asset.id;

    return (
      <div key={asset.id} className="relative flex-shrink-0 w-[140px] snap-center group/slot flex flex-col gap-1">
        <input 
          className="text-[11px] font-semibold text-center text-[--text-secondary] bg-white/50 rounded-full py-0.5 border border-[--border-subtle] focus:bg-white outline-none transition-colors"
          title={t("character.morphTagInputTitle")}
          value={assetTagDrafts[asset.id] ?? asset.tag}
          onChange={(e) =>
            setAssetTagDrafts((prev) => ({ ...prev, [asset.id]: e.target.value }))
          }
          onBlur={async (e) => {
            let next = e.target.value.trim();
            if (!next) {
              setAssetTagDrafts((prev) => {
                const { [asset.id]: _, ...rest } = prev;
                return rest;
              });
              return;
            }
            if (next === asset.tag) {
              setAssetTagDrafts((prev) => {
                const { [asset.id]: _, ...rest } = prev;
                return rest;
              });
              return;
            }
            const ok = await handleUpdateAssetTag(asset.id, next);
            if (ok) {
              setAssetTagDrafts((prev) => {
                const { [asset.id]: _, ...rest } = prev;
                return rest;
              });
            }
          }}
        />
        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[--surface] border border-[--border-subtle] transition-shadow hover:shadow-md">
          {asset.imagePath ? (
            <img 
              src={uploadUrl(asset.imagePath)} 
              alt={name} 
              className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover/slot:scale-105" 
              onClick={() => setLightboxImage(asset.imagePath)} 
            />
          ) : isUploadingThis ? (
            <div className="w-full h-full animate-shimmer" />
          ) : (
            <div className="flex w-full h-full items-center justify-center text-4xl font-bold text-primary/20">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          
          {/* Sparkles button */}
          <button
            onClick={() => {
              setGachaAssetId(asset.id);
              setGachaPaths([]);
              setGachaOpen(true);
            }}
            className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-all hover:bg-black/70 group-hover/slot:opacity-100 shadow-sm"
          >
            <Sparkles className="h-3 w-3" />
          </button>

          {/* Delete Asset Button (removes entire form slot + file) */}
          <button
            onClick={() => handleDeleteAsset(asset.id)}
            title="删除形态"
            className="absolute left-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 transition-all hover:bg-red-600 group-hover/slot:opacity-100 shadow-sm"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>

          {/* Clear Image Button (removes image but keeps the form slot) */}
          {asset.imagePath && (
            <button
              onClick={() => handleClearImage(asset.id)}
              title="仅清除图片（保留形态卡槽）"
              className="absolute left-8 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-gray-700/70 text-white opacity-0 transition-all hover:bg-gray-900 group-hover/slot:opacity-100 shadow-sm"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}

          {/* Upload Overlay */}
          <label className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-200 cursor-pointer ${
            asset.imagePath
              ? 'bg-black/40 text-white opacity-0 group-hover/slot:opacity-100'
              : 'bg-transparent text-[--text-muted] opacity-0 group-hover/slot:opacity-100 group-hover/slot:bg-black/5 hover:!text-[--text-primary]'
          }`}>
            <Upload className="h-5 w-5 mb-1" />
            <span className="text-[10px] font-medium">{t("character.uploadImage")}</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadAsset(asset.id, file);
              e.target.value = ''; // reset
            }} />
          </label>
        </div>

      </div>
    );
  }

  return (
    <div className="group overflow-hidden rounded-2xl border border-[--border-subtle] bg-white transition-all duration-300 hover:border-[--border-hover] hover:shadow-lg hover:shadow-black/5 flex flex-col">
      {/* Images Area */}
      <div className="relative bg-gradient-to-b from-[--surface] to-white/50 pt-4 pb-2 border-b border-[--border-subtle]">
        {onDelete && (
          <button
            onClick={onDelete}
            className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 transition-all hover:bg-red-600 group-hover:opacity-100 shadow-sm"
            title={t("common.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        
        <div className="flex gap-3 overflow-x-auto px-4 pb-4 snap-x snap-mandatory scrollbar-hide items-start">
          {assets.map(asset => renderAssetSlot(asset))}
          
          {/* Add Asset Button */}
          <button 
            onClick={() => handleAddAsset()}
            className="flex-shrink-0 w-[140px] aspect-[3/4] rounded-xl border-2 border-dashed border-[--border-subtle] flex flex-col items-center justify-center gap-2 text-[--text-muted] hover:text-primary hover:border-primary transition-all group/add self-end mb-1"
          >
            <div className="w-10 h-10 rounded-full bg-[--surface] flex items-center justify-center group-hover/add:bg-primary/10 transition-colors">
              <Upload className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium">添加形态</span>
          </button>
        </div>
      </div>

      {/* Episode tags — shown for all characters */}
      {allEpisodes.length > 0 && (
        <div className="px-4 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {linkedEpisodes.map((ep) => (
              <span
                key={ep.id}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 pl-2 pr-1 py-0.5 text-[10px] font-medium text-gray-600"
              >
                EP.{String(ep.sequence).padStart(2, "0")}
                <button
                  onClick={() => removeEpisode(ep.id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-gray-200 transition-colors"
                  title={`移除第${ep.sequence}集`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}

            {/* Add episode button + inline picker */}
            <div className="relative">
              <button
                onClick={() => setShowEpPicker((v) => !v)}
                className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10px] text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
              >
                <Plus className="h-2.5 w-2.5" />
                添加集数
              </button>
              {showEpPicker && unlinkedEpisodes.length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-44 overflow-y-auto rounded-xl border border-[--border-subtle] bg-white shadow-lg">
                  {unlinkedEpisodes.map((ep) => (
                    <button
                      key={ep.id}
                      onClick={() => addEpisode(ep.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors"
                    >
                      <span className="shrink-0 font-medium text-[--text-muted]">
                        EP.{String(ep.sequence).padStart(2, "0")}
                      </span>
                      <span className="truncate text-[--text-secondary]">{ep.title}</span>
                    </button>
                  ))}
                </div>
              )}
              {showEpPicker && unlinkedEpisodes.length === 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-xs text-[--text-muted] shadow-lg">
                  已关联所有集数
                </div>
              )}
            </div>
            {savingEpisodes && <Loader2 className="h-3 w-3 animate-spin text-[--text-muted]" />}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="space-y-3 p-4">
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSave}
          className="h-9 font-display font-semibold text-base"
        />
        <Textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          onBlur={handleSave}
          placeholder={t("character.description")}
          className="h-32 resize-none text-sm"
        />
        <Input
          value={editVisualHint}
          onChange={(e) => setEditVisualHint(e.target.value)}
          onBlur={handleSave}
          placeholder={t("character.visualHint")}
          className="h-8 text-xs text-muted-foreground"
        />
        <div className="space-y-2">
            <InlineModelPicker capability="image" value={imageModelRef} onChange={setImageModelRef} />
        </div>
      </div>

      {/* 音色设置区域（参考 Toonflow 音频资产设计） */}
      <div className="border-t border-[--border-subtle] px-4 py-3 space-y-3">
        {/* 区域标题 + 当前使用优先级 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[--text-secondary]">
            <Mic className="h-3.5 w-3.5" />
            音色设置
          </div>
          <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${
            editVoiceHint.trim()
              ? "bg-blue-50 text-blue-600 border border-blue-200"
              : audioAsset
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-gray-50 text-gray-400 border border-gray-200"
          }`}>
            {editVoiceHint.trim() ? "文字描述优先" : audioAsset ? "音频克隆" : "自动生成"}
          </span>
        </div>

        {/* 文字音色描述（9维度） */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-[--text-muted] font-medium">
            文字音色描述
            <span className="ml-1 font-normal opacity-60">（有值时优先于音频克隆）</span>
          </label>
          {/* 快捷预设 chips */}
          <div className="flex flex-wrap gap-1">
            {VOICE_PRESETS.map((preset) => {
              const isSelected = editVoiceHint.trim() === preset.text;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    const next = isSelected ? "" : preset.text;
                    setEditVoiceHint(next);
                    // 立即保存
                    apiFetch(`/api/projects/${projectId}/characters/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ voiceHint: next }),
                    }).then(() => onUpdate()).catch(() => {});
                  }}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    isSelected
                      ? "border-blue-400 bg-blue-100 text-blue-700"
                      : "border-[--border-subtle] bg-white text-[--text-secondary] hover:border-blue-300 hover:text-blue-600"
                  }`}
                  title={preset.text}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <Textarea
            value={editVoiceHint}
            onChange={(e) => setEditVoiceHint(e.target.value)}
            onBlur={handleSave}
            placeholder={"例：女声，青年音色，音调中等偏高，音色明亮清脆，声音轻盈，气息充沛，语速适中"}
            className="h-16 resize-none text-xs text-muted-foreground"
          />
        </div>

        {/* 参考音频上传（音色克隆） */}
        <div className="space-y-1">
          <label className="text-[10px] text-[--text-muted] font-medium">
            参考音频
            <span className="ml-1 font-normal opacity-60">（MP3 / WAV / M4A，用于 Seedance 音色克隆）</span>
          </label>
          {uploadingAudio ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-[--border-subtle] bg-[--surface] py-2 text-xs text-[--text-muted]">
              <Loader2 className="h-3 w-3 animate-spin" />
              上传中…
            </div>
          ) : audioAsset ? (
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <Music className="h-3 w-3 shrink-0" />
                <span className="truncate">音色参考已设置</span>
              </div>
              <label
                className="flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[--border-subtle] bg-white px-2 text-xs text-[--text-muted] hover:border-primary/40 hover:text-primary transition-colors"
                title="替换音频参考"
              >
                <Upload className="h-3 w-3" />
                替换
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/flac,audio/ogg,audio/aiff"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadAudio(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                onClick={handleClearAudio}
                title="清除音频参考"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-white text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <MicOff className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[--border-subtle] bg-[--surface] py-2.5 text-xs text-[--text-muted] transition-colors hover:border-primary/40 hover:text-primary"
              title="上传音频参考（MP3/WAV/M4A），用于 Seedance 音色克隆"
            >
              <Mic className="h-3.5 w-3.5" />
              点击上传音色参考音频
              <input
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/flac,audio/ogg,audio/aiff"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadAudio(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>

      {lightboxImage && (
        <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
          <DialogContent className="!max-w-[90vw] !w-[90vw] border-0 bg-transparent p-0 shadow-none" showCloseButton={false}>
            <DialogTitle className="sr-only">{name}</DialogTitle>
            <div className="relative inline-block w-full">
              <img
                src={uploadUrl(lightboxImage)}
                alt={name}
                className="w-full max-h-[85vh] object-contain rounded-xl"
              />
              <button
                onClick={() => setLightboxImage(null)}
                className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <span className="text-sm leading-none">✕</span>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Gacha Modal */}
      {gachaOpen && (
        <Dialog open={gachaOpen} onOpenChange={setGachaOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogTitle>
              {t("character.generateImage")} - {assets.find(a => a.id === gachaAssetId)?.tag}
            </DialogTitle>
            <div className="space-y-4 pt-4">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">生成数量:</span>
                <div className="flex gap-2">
                  {[1, 2, 4].map((n) => (
                    <Button
                      key={n}
                      size="sm"
                      variant={gachaCount === n ? "default" : "outline"}
                      onClick={() => setGachaCount(n)}
                      disabled={isGachaGenerating}
                    >
                      {n} 张
                    </Button>
                  ))}
                </div>
                <Button 
                  onClick={handleGachaGenerate} 
                  disabled={isGachaGenerating}
                  className="ml-auto"
                >
                  {isGachaGenerating ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.generating")}</>
                  ) : (
                    <><Sparkles className="mr-2 h-4 w-4" /> 批量抽卡</>
                  )}
                </Button>
              </div>

              {gachaPaths.length > 0 && (
                <div className="grid grid-cols-2 gap-4 mt-6">
                  {gachaPaths.map((path, idx) => (
                    <div 
                      key={idx} 
                      className="group relative aspect-[3/4] rounded-xl overflow-hidden border border-[--border-subtle] cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                      onClick={() => saveGachaImage(path)}
                    >
                      <img src={uploadUrl(path)} alt="Generated" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                        <div className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-sm px-3 py-1.5 rounded-full font-medium shadow-sm transition-opacity">
                          使用此图
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
