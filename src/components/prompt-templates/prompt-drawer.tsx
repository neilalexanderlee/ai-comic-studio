"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { Save, RotateCcw, Wand2, Lock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useModelStore } from "@/stores/model-store";
import { getModelMaxDuration } from "@/lib/ai/model-limits";

// ── Types ────────────────────────────────────────────────

interface SlotMeta {
  key: string;
  nameKey: string;
  descriptionKey: string;
  defaultContent: string;
  editable: boolean;
}

interface PromptMeta {
  key: string;
  nameKey: string;
  descriptionKey: string;
  category: string;
  slots: SlotMeta[];
}

interface ServerOverride {
  promptKey: string;
  slotKey: string | null;
  content: string;
}

function tKey(nameKey: string): string {
  return nameKey.replace(/^promptTemplates\./, "");
}

// A slot with its parent prompt key attached
interface SlotWithPrompt extends SlotMeta {
  promptKey: string;
}

// ── Props ────────────────────────────────────────────────

interface PromptDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One or more prompt keys to edit */
  promptKeys: string | string[];
  /** Project-scoped editing */
  projectId?: string;
}

export function PromptDrawer({ open, onOpenChange, promptKeys: rawKeys, projectId }: PromptDrawerProps) {
  const t = useTranslations("promptTemplates");
  const promptKeys = Array.isArray(rawKeys) ? rawKeys : [rawKeys];

  const [prompts, setPrompts] = useState<PromptMeta[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<{ promptKey: string; slotKey: string } | null>(null);
  // promptKey -> slotKey -> content
  const [slotContents, setSlotContents] = useState<Record<string, Record<string, string>>>({});
  const [serverOverrides, setServerOverrides] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const defaultVideoModel = useModelStore((s) => s.defaultVideoModel);
  const videoMaxDuration = getModelMaxDuration(defaultVideoModel?.modelId);
  const videoMinDuration = Math.min(8, videoMaxDuration);

  function resolvePlaceholders(content: string): string {
    const durationRange = videoMinDuration === videoMaxDuration
      ? String(videoMaxDuration)
      : `${videoMinDuration}-${videoMaxDuration}`;
    return content
      .replace(/\{\{MIN_DURATION\}\}-\{\{MAX_DURATION\}\}/g, durationRange)
      .replace(/\{\{MIN_DURATION\}\}/g, String(videoMinDuration))
      .replace(/\{\{MAX_DURATION\}\}/g, String(videoMaxDuration))
      .replace(/\{\{DIALOGUE_MAX\}\}/g, String(Math.min(videoMaxDuration, 12)))
      .replace(/\{\{ACTION_MAX\}\}/g, String(Math.min(videoMaxDuration, 12)))
      .replace(/\{\{ESTABLISHING_MAX\}\}/g, String(Math.min(videoMaxDuration, 10)));
  }

  const isProject = !!projectId;
  const templatesBasePath = isProject
    ? `/api/projects/${projectId}/prompt-templates`
    : "/api/prompt-templates";

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [regResp, overResp] = await Promise.all([
        apiFetch("/api/prompt-templates/registry"),
        apiFetch(templatesBasePath),
      ]);
      const regData: PromptMeta[] = await regResp.json();
      const overData: ServerOverride[] = await overResp.json();

      const found = promptKeys.map((k) => regData.find((r) => r.key === k)).filter(Boolean) as PromptMeta[];
      if (found.length === 0) return;
      setPrompts(found);

      // Build server overrides & slot contents for all prompts
      const overMap: Record<string, Record<string, string>> = {};
      const contents: Record<string, Record<string, string>> = {};
      for (const prompt of found) {
        overMap[prompt.key] = {};
        contents[prompt.key] = {};
        for (const o of overData) {
          if (o.promptKey === prompt.key && o.slotKey) {
            overMap[prompt.key][o.slotKey] = o.content;
          }
        }
        for (const slot of prompt.slots) {
          contents[prompt.key][slot.key] = overMap[prompt.key][slot.key] ?? slot.defaultContent;
        }
      }
      setServerOverrides(overMap);
      setSlotContents(contents);

      // Auto-select first editable slot of first prompt
      const firstEditable = found[0]?.slots.find((s) => s.editable);
      if (firstEditable) {
        setSelectedSlot({ promptKey: found[0].key, slotKey: firstEditable.key });
      }
    } catch {
      toast.error("Failed to load prompt data");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptKeys.join(","), templatesBasePath]);

  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  if (prompts.length === 0 && !loading) return null;

  // Build flat slot list grouped by prompt
  const allSlots: SlotWithPrompt[] = [];
  const allLockedSlots: SlotWithPrompt[] = [];
  for (const prompt of prompts) {
    for (const slot of prompt.slots) {
      const item = { ...slot, promptKey: prompt.key };
      if (slot.editable) allSlots.push(item);
      else allLockedSlots.push(item);
    }
  }

  const currentSlotMeta = selectedSlot
    ? prompts.find((p) => p.key === selectedSlot.promptKey)?.slots.find((s) => s.key === selectedSlot.slotKey)
    : null;

  const isModified = (promptKey: string, slotKey: string) => {
    const prompt = prompts.find((p) => p.key === promptKey);
    const slot = prompt?.slots.find((s) => s.key === slotKey);
    if (!slot) return false;
    return (slotContents[promptKey]?.[slotKey] ?? "") !== slot.defaultContent;
  };

  const hasUnsavedChanges = () => {
    for (const prompt of prompts) {
      for (const slot of prompt.slots.filter((s) => s.editable)) {
        const serverValue = serverOverrides[prompt.key]?.[slot.key] ?? slot.defaultContent;
        if ((slotContents[prompt.key]?.[slot.key] ?? "") !== serverValue) return true;
      }
    }
    return false;
  };

  // Title: single prompt shows its name; multiple shows generic
  const headerTitle = prompts.length === 1
    ? t(tKey(prompts[0].nameKey) as Parameters<typeof t>[0])
    : t("title");
  const headerSubtitle = prompts.length === 1 ? prompts[0].key : prompts.map((p) => p.key).join(", ");

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isProject) {
        await apiFetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ useProjectPrompts: 1 }),
        });
      }

      // Save each prompt's changed slots
      for (const prompt of prompts) {
        const slots: Record<string, string> = {};
        for (const slot of prompt.slots.filter((s) => s.editable)) {
          const current = slotContents[prompt.key]?.[slot.key] ?? "";
          if (current !== slot.defaultContent || serverOverrides[prompt.key]?.[slot.key]) {
            slots[slot.key] = current;
          }
        }
        if (Object.keys(slots).length > 0) {
          await apiFetch(`${templatesBasePath}/${prompt.key}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "slots", slots }),
          });
        }
      }

      // Refresh overrides
      const resp = await apiFetch(templatesBasePath);
      const overData: ServerOverride[] = await resp.json();
      const overMap: Record<string, Record<string, string>> = {};
      for (const prompt of prompts) {
        overMap[prompt.key] = {};
        for (const o of overData) {
          if (o.promptKey === prompt.key && o.slotKey) {
            overMap[prompt.key][o.slotKey] = o.content;
          }
        }
      }
      setServerOverrides(overMap);
      toast.success(t("editor.savedSuccess"));
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      for (const prompt of prompts) {
        await apiFetch(`${templatesBasePath}/${prompt.key}`, { method: "DELETE" });
      }
      const contents: Record<string, Record<string, string>> = {};
      for (const prompt of prompts) {
        contents[prompt.key] = {};
        for (const slot of prompt.slots) {
          contents[prompt.key][slot.key] = slot.defaultContent;
        }
      }
      setSlotContents(contents);
      const emptyOverrides: Record<string, Record<string, string>> = {};
      for (const prompt of prompts) emptyOverrides[prompt.key] = {};
      setServerOverrides(emptyOverrides);
      toast.success(t("editor.resetSuccess"));
    } catch {
      toast.error("Reset failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!fixed !top-0 !right-0 !left-auto !translate-x-0 !translate-y-0 !max-w-4xl !w-[min(900px,100vw)] !h-screen !rounded-none !rounded-l-2xl !p-0 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          {t("editor.edit")}
        </DialogTitle>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[--border-subtle] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Wand2 className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[--text-primary]">{headerTitle}</div>
              <div className="text-[10px] font-mono text-[--text-muted]">{headerSubtitle}</div>
            </div>
            {isProject && (
              <Badge variant="default" className="text-[10px]">
                {t("project.useProjectPrompts")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="ghost" onClick={handleReset}>
              <RotateCcw className="h-3 w-3" />
              {t("editor.resetDefault")}
            </Button>
            <Button
              size="xs"
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges()}
            >
              <Save className="h-3 w-3" />
              {t("editor.save")}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-[--text-muted] text-sm">
            Loading...
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Slot list (left) */}
            <div className="w-[170px] shrink-0 overflow-y-auto border-r border-[--border-subtle] p-2">
              {prompts.map((prompt, pi) => (
                <div key={prompt.key}>
                  {/* Show prompt group header when multiple prompts */}
                  {prompts.length > 1 && (
                    <div className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted] ${pi > 0 ? "pt-3 mt-1 border-t border-[--border-subtle]" : "pt-1"}`}>
                      {t(tKey(prompt.nameKey) as Parameters<typeof t>[0])}
                    </div>
                  )}
                  {prompt.slots.filter((s) => s.editable).map((slot) => {
                    const isSelected = selectedSlot?.promptKey === prompt.key && selectedSlot?.slotKey === slot.key;
                    const modified = isModified(prompt.key, slot.key);
                    return (
                      <button
                        key={`${prompt.key}:${slot.key}`}
                        onClick={() => setSelectedSlot({ promptKey: prompt.key, slotKey: slot.key })}
                        className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all ${
                          isSelected
                            ? "border border-primary/15 bg-primary/5 text-[--text-primary] font-medium"
                            : "border border-transparent hover:bg-[--surface] text-[--text-secondary]"
                        }`}
                      >
                        <span className="flex-1 truncate">
                          {t(tKey(slot.nameKey) as Parameters<typeof t>[0]) || slot.key}
                        </span>
                        {modified && (
                          <Badge variant="default" className="shrink-0 text-[9px] px-1 py-0">
                            {t("editor.modified")}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {allLockedSlots.length > 0 && (
                <>
                  <div className="my-1.5 border-t border-[--border-subtle]" />
                  {allLockedSlots.map((slot) => {
                    const isSelected = selectedSlot?.promptKey === slot.promptKey && selectedSlot?.slotKey === slot.key;
                    return (
                      <button
                        key={`${slot.promptKey}:${slot.key}`}
                        onClick={() => setSelectedSlot({ promptKey: slot.promptKey, slotKey: slot.key })}
                        className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all ${
                          isSelected
                            ? "border border-[--border-subtle] bg-[--surface] text-[--text-secondary]"
                            : "border border-transparent text-[--text-muted] hover:bg-[--surface] opacity-60 hover:opacity-80"
                        }`}
                      >
                        <Lock className="h-2.5 w-2.5 shrink-0" />
                        <span className="flex-1 truncate">
                          {t(tKey(slot.nameKey) as Parameters<typeof t>[0]) || slot.key}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* Editor (right) */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {selectedSlot && currentSlotMeta ? (
                <div className="flex flex-1 flex-col p-3 overflow-hidden">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-[--text-primary]">
                      {t(tKey(currentSlotMeta.nameKey) as Parameters<typeof t>[0])}
                    </span>
                    {!currentSlotMeta.editable && (
                      <Badge className="shrink-0 text-[9px] px-1.5 py-0 bg-[--surface] text-[--text-muted]">
                        {t("editor.locked")}
                      </Badge>
                    )}
                    {currentSlotMeta.editable && isModified(selectedSlot.promptKey, selectedSlot.slotKey) && (
                      <Badge variant="warning" className="text-[9px] px-1 py-0">
                        {t("editor.modified")}
                      </Badge>
                    )}
                  </div>
                  <textarea
                    value={resolvePlaceholders(slotContents[selectedSlot.promptKey]?.[selectedSlot.slotKey] ?? "")}
                    readOnly={!currentSlotMeta.editable}
                    onChange={(e) => {
                      if (!currentSlotMeta.editable) return;
                      setSlotContents((prev) => ({
                        ...prev,
                        [selectedSlot.promptKey]: {
                          ...prev[selectedSlot.promptKey],
                          [selectedSlot.slotKey]: e.target.value,
                        },
                      }));
                    }}
                    className={`flex-1 resize-none rounded-xl border border-[--border-subtle] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[--text-primary] outline-none transition-all ${
                      currentSlotMeta.editable
                        ? "bg-white hover:border-[--border-hover] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
                        : "bg-[--surface] cursor-default"
                    }`}
                    placeholder={t("editor.edit")}
                  />
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-[--text-muted]">
                  {t("editor.slotMode")}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
