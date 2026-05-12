"use client";

import { useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { apiFetch } from "@/lib/api-fetch";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/character-extract";
import { Palette, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export function VisualStylePicker() {
  const { project, updateVisualStyle } = useProjectStore();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!project) return null;

  const currentStyle = project.visualStyle || "anime_2d";
  const currentPreset = VISUAL_STYLE_PRESETS[currentStyle] ?? VISUAL_STYLE_PRESETS.anime_2d;

  async function handleSelect(value: string) {
    if (!project || value === currentStyle) { setOpen(false); return; }
    setSaving(true);
    updateVisualStyle(value);
    setOpen(false);
    try {
      await apiFetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visualStyle: value }),
      });
      toast.success("画风已更新");
    } catch {
      toast.error("保存失败");
      updateVisualStyle(currentStyle); // rollback
    }
    setSaving(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-xs font-medium text-[--text-muted] border border-[--border-subtle] bg-white hover:bg-[--surface] hover:text-[--text-primary] transition-colors"
        title="画风设定"
      >
        <Palette className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">{currentPreset.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* dropdown */}
          <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-[--border-subtle] bg-white shadow-lg py-1 overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-muted]">
              项目画风
            </div>
            {Object.entries(VISUAL_STYLE_PRESETS).map(([value, preset]) => (
              <button
                key={value}
                onClick={() => handleSelect(value)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-[--text-primary] hover:bg-[--surface] transition-colors"
              >
                <div>
                  <div className="font-medium text-[13px]">{preset.label}</div>
                  {preset.tag && (
                    <div className="text-[10px] text-[--text-muted] truncate max-w-[160px]">
                      {preset.tag.slice(0, 20)}…
                    </div>
                  )}
                </div>
                {value === currentStyle && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
