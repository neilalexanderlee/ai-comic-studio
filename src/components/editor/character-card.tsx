"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { Sparkles, Loader2, Copy, Check, ArrowUpCircle, Trash2, Upload } from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";

export interface CharacterAsset {
  id: string;
  imagePath: string | null;
  tag: string;
  assetType: "morph" | "blueprint";
  isDefault: number;
}

interface CharacterCardProps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  visualHint: string | null;
  assets?: CharacterAsset[];
  onUpdate: () => void;
  batchGenerating?: boolean;
  scope?: string;
  onPromote?: () => void;
  onDelete?: () => void;
  episodeName?: string;
}

export function CharacterCard({
  id,
  projectId,
  name,
  description,
  visualHint,
  assets = [],
  onUpdate,
  batchGenerating,
  scope,
  onPromote,
  onDelete,
  episodeName,
}: CharacterCardProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const providers = useModelStore((s) => s.providers);
  const defaultImageModel = useModelStore((s) => s.defaultImageModel);
  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(() => defaultImageModel);
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [editVisualHint, setEditVisualHint] = useState(visualHint ?? "");

  // Sync local state when props change (e.g. after re-extraction)
  useEffect(() => { setEditName(name); }, [name]);
  useEffect(() => { setEditDesc(description); }, [description]);
  useEffect(() => { setEditVisualHint(visualHint ?? ""); }, [visualHint]);
  const [generating, setGenerating] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const imageGuard = useModelGuard("image");

  // Gacha State
  const [gachaOpen, setGachaOpen] = useState(false);
  const [gachaAssetId, setGachaAssetId] = useState<string | null>(null);
  const [gachaCount, setGachaCount] = useState(4);
  const [gachaPaths, setGachaPaths] = useState<string[]>([]);
  const [isGachaGenerating, setIsGachaGenerating] = useState(false);

  const isGenerating = generating;

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
      body: JSON.stringify({ name: editName, description: editDesc, visualHint: editVisualHint }),
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
      toast.success(t("common.saved"));
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error(t("common.saveFailed"));
    } finally {
      setUploadingField(null);
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

  async function handleUpdateAssetTag(assetId: string, tag: string) {
    try {
      await apiFetch(`/api/projects/${projectId}/characters/${id}/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      onUpdate();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteAsset(assetId: string) {
    if (!confirm("确定删除此形态吗？")) return;
    try {
      await apiFetch(`/api/projects/${projectId}/characters/${id}/assets/${assetId}`, {
        method: "DELETE",
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
      toast.success(t("common.saved"));
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
          value={asset.tag}
          onChange={(e) => {
              // Local state update would be better for UX, but for now we update assets through props/onUpdate
              // Or we could have a localAssets state.
          }}
          onBlur={(e) => handleUpdateAssetTag(asset.id, e.target.value)}
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

          {/* Delete Asset Button */}
          <button
            onClick={() => handleDeleteAsset(asset.id)}
            className="absolute left-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 transition-all hover:bg-red-600 group-hover/slot:opacity-100 shadow-sm"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>

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

      {/* Scope badge */}
      {scope && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              scope === "main"
                ? "bg-blue-100 text-blue-700"
                : "bg-purple-100 text-purple-700"
            }`}
          >
            {scope === "main" ? t("episode.mainCharacter") : t("episode.guestCharacter")}
          </span>
          {episodeName && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {episodeName}
            </span>
          )}
          {scope === "guest" && onPromote && (
            <button
              onClick={onPromote}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <ArrowUpCircle className="h-3 w-3" />
              {t("episode.promoteToMain")}
            </button>
          )}
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
