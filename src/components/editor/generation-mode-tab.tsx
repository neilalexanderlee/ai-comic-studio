"use client";

import { useTranslations } from "next-intl";
import { useProjectStore } from "@/stores/project-store";
import { apiFetch } from "@/lib/api-fetch";
import { Film, ImageIcon } from "lucide-react";
import { toast } from "sonner";

type GenerationMode = "keyframe" | "reference";

export function GenerationModeTab() {
  const t = useTranslations("project");
  const { project, setProject } = useProjectStore();

  if (!project) return null;

  const mode = (project.generationMode || "keyframe") as GenerationMode;

  async function switchMode(newMode: GenerationMode) {
    if (!project || newMode === mode) return;

    const previous = project;
    setProject({ ...project, generationMode: newMode });

    try {
      const episodeId = useProjectStore.getState().currentEpisodeId;
      const url = episodeId
        ? `/api/projects/${project.id}/episodes/${episodeId}`
        : `/api/projects/${project.id}`;
      await apiFetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationMode: newMode }),
      });
    } catch (err) {
      setProject(previous);
      toast.error(err instanceof Error ? err.message : "Failed to switch mode");
    }
  }

  return (
    <div className="inline-flex gap-1.5 rounded-xl border border-[--border-subtle] bg-[--surface] p-1.5">
      <button
        onClick={() => switchMode("keyframe")}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
          mode === "keyframe"
            ? "bg-white text-primary shadow ring-1 ring-primary/20"
            : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
        }`}
      >
        <Film className={`h-4 w-4 ${mode === "keyframe" ? "text-primary" : ""}`} />
        {t("generationModeKeyframe")}
      </button>
      <button
        onClick={() => switchMode("reference")}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
          mode === "reference"
            ? "bg-white text-violet-600 shadow ring-1 ring-violet-200"
            : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
        }`}
      >
        <ImageIcon className={`h-4 w-4 ${mode === "reference" ? "text-violet-600" : ""}`} />
        {t("generationModeReference")}
      </button>
    </div>
  );
}
