"use client";

import { useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useModelStore } from "@/stores/model-store";
import { CharacterCard } from "@/components/editor/character-card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Users, Sparkles, ImageIcon, Loader2 } from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { toast } from "sonner";

export default function EpisodeCharactersPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [extracting, setExtracting] = useState(false);
  const [generatingImages, setGeneratingImages] = useState(false);
  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");

  if (!project) return null;

  const hasCharactersWithoutImages = project.characters.some(
    (c) => (c.assets?.length ?? 0) === 0 || !c.assets?.some(a => a.imagePath)
  );

  async function handleExtractCharacters() {
    if (!project) return;
    if (!textGuard()) return;
    setExtracting(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "character_extract",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });

      if (!response.ok) {
        throw new Error("Character extract failed");
      }

      await response.json();
    } catch (err) {
      console.error("Character extract error:", err);
      toast.error(t("common.generationFailed"));
    }

    setExtracting(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  async function handleBatchGenerateImages() {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingImages(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_character_image",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });

      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch character image error:", err);
      toast.error(t("common.generationFailed"));
    }

    setGeneratingImages(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  return (
    <div className="animate-page-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.characters")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {project.characters.length} characters
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PromptEditButton promptKeys="character_extract" projectId={project.id} />
          <InlineModelPicker capability="text" />
          <Button
            onClick={handleExtractCharacters}
            disabled={extracting}
            variant="outline"
            size="sm"
          >
            {extracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {extracting ? t("common.generating") : t("project.extractCharacters")}
          </Button>
          {project.characters.length > 0 && hasCharactersWithoutImages && (
            <>
              <InlineModelPicker capability="image" />
              <Button
                onClick={handleBatchGenerateImages}
                disabled={generatingImages}
                size="sm"
              >
                {generatingImages ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                {generatingImages
                  ? t("common.generating")
                  : t("character.batchGenerateImages")}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[--border-subtle] bg-white/70 px-4 py-3 text-xs leading-relaxed text-[--text-secondary] shadow-sm">
        {t("character.morphNamingHint")}
      </div>

      {project.characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Users className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.characters")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("character.noCharacters")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {project.characters.map((char) => (
            <CharacterCard
              key={char.id}
              id={char.id}
              projectId={project.id}
              name={char.name}
              description={char.description}
              visualHint={char.visualHint ?? null}
              assets={char.assets}
              onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
              batchGenerating={generatingImages}
            />
          ))}
        </div>
      )}
    </div>
  );
}
