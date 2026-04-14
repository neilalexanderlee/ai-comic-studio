"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";

interface Preset {
  id: string;
  name: string;
  nameKey?: string;
  descriptionKey?: string;
  description?: string;
  promptKey: string;
  isBuiltIn: boolean;
}

interface PresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptKey: string;
}

export function PresetDialog({ open, onOpenChange, promptKey }: PresetDialogProps) {
  const t = useTranslations("promptTemplates.presets");
  const store = usePromptTemplateStore();
  const { registry, getSlotContent, setServerOverrides } = store;

  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  // Fetch presets when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch("/api/prompt-presets")
      .then((r) => r.json())
      .then((data: Preset[]) => {
        // Filter to only presets matching the current promptKey
        const filtered = data.filter((p) => p.promptKey === promptKey);
        setPresets(filtered);
      })
      .catch(() => {
        toast.error("Failed to load presets");
      })
      .finally(() => setLoading(false));
  }, [open, promptKey]);

  const refreshOverrides = async () => {
    const resp = await apiFetch("/api/prompt-templates");
    const data = await resp.json();
    setServerOverrides(data);
  };

  const handleApply = async (preset: Preset) => {
    setApplyingId(preset.id);
    try {
      const resp = await apiFetch(`/api/prompt-presets/${preset.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "global" }),
      });
      if (!resp.ok) throw new Error("Apply failed");
      await refreshOverrides();
      toast.success(t("applySuccess"));
      onOpenChange(false);
    } catch {
      toast.error("Failed to apply preset");
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async (preset: Preset) => {
    setDeletingId(preset.id);
    try {
      const resp = await apiFetch(`/api/prompt-presets/${preset.id}`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error("Delete failed");
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error("Failed to delete preset");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) return;

    // Build slots from current prompt's slot content
    const promptMeta = registry.find((r) => r.key === promptKey);
    if (!promptMeta) return;

    const slots: Record<string, string> = {};
    for (const slot of promptMeta.slots) {
      slots[slot.key] = getSlotContent(promptKey, slot.key);
    }

    setSaving(true);
    try {
      const resp = await apiFetch("/api/prompt-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, promptKey, slots }),
      });
      if (!resp.ok) throw new Error("Save failed");
      const newPreset = await resp.json();
      setPresets((prev) => [...prev, { ...newPreset, isBuiltIn: false }]);
      setSaveName("");
      toast.success(t("saveSuccess"));
    } catch {
      toast.error("Failed to save preset");
    } finally {
      setSaving(false);
    }
  };

  const builtInPresets = presets.filter((p) => p.isBuiltIn);
  const userPresets = presets.filter((p) => !p.isBuiltIn);

  const getPresetName = (preset: Preset) => {
    if (preset.nameKey) {
      // Try to get the translated name using the nameKey
      try {
        const key = preset.nameKey.replace(/^promptTemplates\./, "");
        return t(key as Parameters<typeof t>[0]);
      } catch {
        return preset.name;
      }
    }
    return preset.name;
  };

  const getPresetDescription = (preset: Preset) => {
    if (preset.descriptionKey) {
      try {
        const key = preset.descriptionKey.replace(/^promptTemplates\./, "");
        return t(key as Parameters<typeof t>[0]);
      } catch {
        return preset.description ?? "";
      }
    }
    return preset.description ?? "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="flex h-24 items-center justify-center text-sm text-[--text-muted]">
              Loading...
            </div>
          ) : (
            <>
              {/* Built-in presets */}
              {builtInPresets.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
                    {t("builtIn")}
                  </div>
                  {builtInPresets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      name={getPresetName(preset)}
                      description={getPresetDescription(preset)}
                      isBuiltIn
                      applying={applyingId === preset.id}
                      onApply={() => handleApply(preset)}
                      applyLabel={t("apply")}
                      deleteLabel={t("delete")}
                    />
                  ))}
                </div>
              )}

              {/* User presets */}
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
                  {t("userCreated")}
                </div>
                {userPresets.length === 0 ? (
                  <p className="text-sm text-[--text-muted] py-1">{t("noUserPresets")}</p>
                ) : (
                  userPresets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      name={getPresetName(preset)}
                      description={getPresetDescription(preset)}
                      isBuiltIn={false}
                      applying={applyingId === preset.id}
                      deleting={deletingId === preset.id}
                      onApply={() => handleApply(preset)}
                      onDelete={() => handleDelete(preset)}
                      applyLabel={t("apply")}
                      deleteLabel={t("delete")}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {/* Divider */}
          <div className="border-t border-[--border-subtle]" />

          {/* Save as preset */}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-[--text-secondary]">
              {t("saveAs")}
            </div>
            <div className="flex gap-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t("savePlaceholder")}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !saveName.trim()}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PresetCardProps {
  name: string;
  description: string;
  isBuiltIn: boolean;
  applying: boolean;
  deleting?: boolean;
  onApply: () => void;
  onDelete?: () => void;
  applyLabel: string;
  deleteLabel: string;
}

function PresetCard({
  name,
  description,
  isBuiltIn,
  applying,
  deleting,
  onApply,
  onDelete,
  applyLabel,
  deleteLabel,
}: PresetCardProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[--border-subtle] bg-[--surface] px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-[--text-primary]">
          {name}
        </span>
        {description && (
          <span className="truncate text-xs text-[--text-muted]">
            {description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="xs"
          variant="outline"
          onClick={onApply}
          disabled={applying}
        >
          {applyLabel}
        </Button>
        {!isBuiltIn && onDelete && (
          <Button
            size="xs"
            variant="ghost"
            onClick={onDelete}
            disabled={deleting}
            className="text-red-500 hover:bg-red-50 hover:text-red-600"
          >
            {deleteLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
