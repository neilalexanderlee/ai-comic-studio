import { db } from "@/lib/db";
import { episodes, projects } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import {
  buildShotEnrichSystem,
  buildShotEnrichPrompt,
  isShotNeedingEnrichment,
  type ShotEnrichInput,
  type ShotEnrichOutput,
} from "@/lib/ai/prompts/shot-enrich";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";
import { extractShotsFromScript } from "@/lib/storyboard/extract-shot-script";
import type { ExtractedShot } from "@/lib/storyboard/extract-shot-script";
import {
  getShotCharacters,
  persistStoryboardVersion,
} from "@/lib/storyboard/persist-storyboard-version";
import { finalizeExtractedShotsForDb } from "@/lib/storyboard/complete-extracted-shots";

const ENRICH_BATCH_SIZE = 10; // shots per LLM call

/**
 * Enrich fast-path extracted shots that are missing videoScript or have
 * template-quality content. Batches shots to minimize LLM calls.
 */
async function enrichExtractedShots(
  shots: ExtractedShot[],
  episodeTitle: string,
  characterHints: Array<{ name: string; visualHint: string }>,
  ai: ReturnType<typeof resolveAIProvider>
): Promise<ExtractedShot[]> {
  // Identify shots needing enrichment
  const needsEnrichment = shots
    .map((shot, idx) => ({ shot, idx }))
    .filter(({ shot }) => isShotNeedingEnrichment(shot));

  if (needsEnrichment.length === 0) return shots;

  console.log(
    `[ShotEnrich] ${needsEnrichment.length}/${shots.length} shots need videoScript enrichment`
  );

  const enrichSystem = buildShotEnrichSystem();
  const result = [...shots];

  // Process in batches
  for (let batchStart = 0; batchStart < needsEnrichment.length; batchStart += ENRICH_BATCH_SIZE) {
    const batch = needsEnrichment.slice(batchStart, batchStart + ENRICH_BATCH_SIZE);

    const inputs: ShotEnrichInput[] = batch.map(({ shot }) => ({
      sequence: shot.sequence,
      sceneTitle: shot.sceneTitle,
      prompt: shot.prompt,
      motionScript: shot.motionScript,
      dialogues: shot.dialogues.map((d) => ({ character: d.character, text: d.text })),
    }));

    try {
      const enrichPrompt = buildShotEnrichPrompt(
        inputs,
        { title: episodeTitle },
        characterHints
      );

      const raw = await ai.generateText(enrichPrompt, {
        systemPrompt: enrichSystem,
        temperature: 0.4,
      });

      const enriched = JSON.parse(extractJSON(raw)) as ShotEnrichOutput[];

      // Apply enrichment results back to the shots
      for (const enrichedShot of enriched) {
        const entry = batch.find(({ shot }) => shot.sequence === enrichedShot.sequence);
        if (!entry) continue;

        const { shot, idx } = entry;

        result[idx] = {
          ...shot,
          videoScript: enrichedShot.videoScript?.trim() || shot.videoScript,
          cameraDirection: enrichedShot.cameraDirection || shot.cameraDirection || "static",
          startFrameDesc: enrichedShot.startFrameDesc?.trim() || shot.startFrameDesc,
          endFrameDesc: enrichedShot.endFrameDesc?.trim() || shot.endFrameDesc,
          completeness: {
            ...shot.completeness,
            hasVideoScript: !!(enrichedShot.videoScript?.trim()),
            hasCameraDirection: !!(enrichedShot.cameraDirection),
            hasStartFrame: !!(enrichedShot.startFrameDesc?.trim() || shot.startFrameDesc),
            hasEndFrame: !!(enrichedShot.endFrameDesc?.trim() || shot.endFrameDesc),
          },
        };
      }

      console.log(
        `[ShotEnrich] Batch ${batchStart / ENRICH_BATCH_SIZE + 1}: enriched ${enriched.length} shots`
      );
    } catch (err) {
      console.error(`[ShotEnrich] Batch enrichment failed:`, err);
      // Continue with unenriched shots rather than failing the whole pipeline
    }
  }

  return result;
}

export async function handleShotSplit(task: Task) {
  const payload = task.payload as {
    projectId: string;
    screenplay: string;
    modelConfig?: ModelConfigPayload;
    episodeId?: string;
    userId?: string;
    /** Set to true to skip AI enrichment of fast-path shots (faster but lower quality) */
    skipEnrichment?: boolean;
  };

  let screenplay = payload.screenplay;
  let targetDurationSeconds: number | null = null;
  let episodeTitle = "";

  if (!screenplay) {
    if (payload.episodeId) {
      const [episode] = await db
        .select({
          script: episodes.script,
          title: episodes.title,
          targetDurationSeconds: episodes.targetDurationSeconds,
        })
        .from(episodes)
        .where(eq(episodes.id, payload.episodeId));
      screenplay = episode?.script ?? "";
      targetDurationSeconds = episode?.targetDurationSeconds ?? null;
      episodeTitle = episode?.title ?? "";
    } else {
      const [project] = await db
        .select({ script: projects.script })
        .from(projects)
        .where(eq(projects.id, payload.projectId));
      screenplay = project?.script ?? "";
    }
  } else if (payload.episodeId) {
    // screenplay was passed directly (e.g. from generate route), but still fetch duration + title
    const [episode] = await db
      .select({ title: episodes.title, targetDurationSeconds: episodes.targetDurationSeconds })
      .from(episodes)
      .where(eq(episodes.id, payload.episodeId));
    targetDurationSeconds = episode?.targetDurationSeconds ?? null;
    episodeTitle = episode?.title ?? "";
  }

  const projectCharacters = await getShotCharacters(
    payload.projectId,
    payload.episodeId ?? null
  );

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const characterHints = projectCharacters
    .filter((c) => c.visualHint)
    .map((c) => ({ name: c.name, visualHint: c.visualHint! }));

  const systemPrompt = await resolvePrompt("shot_split", {
    userId: payload.userId ?? "",
    projectId: payload.projectId,
  });
  const ai = resolveAIProvider(payload.modelConfig);

  // ── FAST PATH: structured script with 【分镜详情】 ──────────────────────────
  const extracted = extractShotsFromScript(screenplay);
  if (extracted.detection.matched && extracted.shots.length > 0) {
    let shotsToSave = finalizeExtractedShotsForDb(extracted.shots);
    const warnings =
      extracted.warnings.length > 0 ? extracted.warnings : undefined;
    shotsToSave.forEach((shot) => {
      shot.warnings = warnings;
    });

    // AI enrichment: synthesize videoScript for shots that are missing it
    if (!payload.skipEnrichment) {
      const enriched = await enrichExtractedShots(
        // finalizeExtractedShotsForDb returns a compatible shape
        shotsToSave as unknown as ExtractedShot[],
        episodeTitle,
        characterHints,
        ai
      );
      shotsToSave = enriched as typeof shotsToSave;
    }

    await persistStoryboardVersion({
      projectId: payload.projectId,
      episodeId: payload.episodeId ?? null,
      shotCharacters: projectCharacters,
      shots: shotsToSave,
    });

    return { shots: extracted.shots, enriched: !payload.skipEnrichment };
  }

  // ── LLM PATH: unstructured script ───────────────────────────────────────────
  const characterVisualHints = characterHints.length > 0 ? characterHints : undefined;

  const result = await ai.generateText(
    buildShotSplitPrompt(
      screenplay,
      characterDescriptions,
      characterVisualHints,
      targetDurationSeconds
    ),
    { systemPrompt, temperature: 0.5 }
  );

  const parsedShots = JSON.parse(extractJSON(result)) as Array<{
    sequence: number;
    sceneDescription: string;
    startFrame: string;
    endFrame: string;
    motionScript: string;
    videoScript?: string;
    cameraDirection?: string;
    duration: number;
    dialogues: Array<{ character: string; text: string }>;
  }>;

  await persistStoryboardVersion({
    projectId: payload.projectId,
    episodeId: payload.episodeId ?? null,
    shotCharacters: projectCharacters,
    shots: parsedShots.map((shot) => ({
      sequence: shot.sequence,
      prompt: shot.sceneDescription,
      startFrameDesc: shot.startFrame,
      endFrameDesc: shot.endFrame,
      motionScript: shot.motionScript,
      videoScript: shot.videoScript ?? null,
      cameraDirection: shot.cameraDirection ?? "static",
      duration: shot.duration,
      dialogues: shot.dialogues,
    })),
  });

  return { shots: parsedShots };
}
