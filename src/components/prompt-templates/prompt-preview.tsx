"use client";

import { useEffect, useRef, useState } from "react";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { apiFetch } from "@/lib/api-fetch";
import { useTranslations } from "next-intl";

export function PromptPreview() {
  const t = useTranslations("promptTemplates");
  const { selectedPromptKey, registry, getSlotContent, editedSlots, serverOverrides } =
    usePromptTemplateStore();
  const [previewText, setPreviewText] = useState("");
  const [highlights, setHighlights] = useState<
    Record<string, "overridden" | "default">
  >({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prompt = registry.find((r) => r.key === selectedPromptKey);

  useEffect(() => {
    if (!prompt || !selectedPromptKey) {
      setPreviewText("");
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        // Build current slot values
        const slots: Record<string, string> = {};
        for (const slot of prompt.slots) {
          slots[slot.key] = getSlotContent(selectedPromptKey, slot.key);
        }

        const resp = await apiFetch("/api/prompt-templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptKey: selectedPromptKey, slots }),
        });
        const data = await resp.json();
        setPreviewText(data.fullPrompt ?? "");
        setHighlights(data.highlights ?? {});
      } catch {
        // silently ignore preview errors
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Trigger on slot content changes via editedSlots/serverOverrides
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPromptKey, prompt, getSlotContent, editedSlots, serverOverrides]);

  if (!prompt) return null;

  // Check if any slot is overridden
  const hasOverrides = Object.values(highlights).some(
    (v) => v === "overridden"
  );

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
        {t("editor.previewFull")}
      </div>
      <div
        className={`overflow-auto rounded-xl border border-[--border-subtle] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${
          hasOverrides ? "bg-primary/5" : "text-[--text-muted] bg-[--surface]"
        }`}
      >
        {previewText || (
          <span className="text-[--text-muted] italic">
            {t("editor.preview")}...
          </span>
        )}
      </div>
    </div>
  );
}
