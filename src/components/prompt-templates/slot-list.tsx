"use client";

import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

function tKey(nameKey: string): string {
  return nameKey.replace(/^promptTemplates\./, "");
}

export function SlotList() {
  const t = useTranslations("promptTemplates");
  const {
    registry,
    selectedPromptKey,
    selectedSlotKey,
    selectSlot,
    editedSlots,
    serverOverrides,
  } = usePromptTemplateStore();

  const prompt = registry.find((r) => r.key === selectedPromptKey);
  if (!prompt) return null;

  const editableSlots = prompt.slots.filter((s) => s.editable);
  const lockedSlots = prompt.slots.filter((s) => !s.editable);

  const isSlotModified = (slotKey: string) => {
    return (
      !!editedSlots[prompt.key]?.[slotKey] ||
      !!serverOverrides[prompt.key]?.[slotKey]
    );
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
        {t("editor.slots")} ({prompt.slots.length})
      </div>

      {editableSlots.map((slot) => {
        const isSelected = selectedSlotKey === slot.key;
        const modified = isSlotModified(slot.key);

        return (
          <button
            key={slot.key}
            onClick={() => selectSlot(slot.key)}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ${
              isSelected
                ? "border border-primary/15 bg-primary/5 text-[--text-primary]"
                : "border border-transparent hover:bg-[--surface] text-[--text-secondary]"
            }`}
          >
            <span className="flex-1 truncate">{t(tKey(slot.nameKey) as Parameters<typeof t>[0]) || slot.key}</span>
            {modified && (
              <Badge variant="default" className="shrink-0 text-[10px] px-1.5 py-0">
                {t("editor.modified")}
              </Badge>
            )}
          </button>
        );
      })}

      {lockedSlots.length > 0 && (
        <>
          <div className="my-1 border-t border-[--border-subtle]" />
          {lockedSlots.map((slot) => {
            const isSelected = selectedSlotKey === slot.key;
            return (
              <button
                key={slot.key}
                onClick={() => selectSlot(slot.key)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ${
                  isSelected
                    ? "border border-[--border-subtle] bg-[--surface] text-[--text-secondary]"
                    : "border border-transparent text-[--text-muted] hover:bg-[--surface] opacity-60 hover:opacity-80"
                }`}
              >
                <Lock className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{t(tKey(slot.nameKey) as Parameters<typeof t>[0]) || slot.key}</span>
                <span className="shrink-0 text-[10px]">{t("editor.locked")}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
