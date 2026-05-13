import { db } from "@/lib/db";
import { episodes, projects } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";
import { extractShotsFromScript } from "@/lib/storyboard/extract-shot-script";
import {
  getShotCharacters,
  persistStoryboardVersion,
} from "@/lib/storyboard/persist-storyboard-version";
import { finalizeExtractedShotsForDb } from "@/lib/storyboard/complete-extracted-shots";

export async function handleShotSplit(task: Task) {
  const payload = task.payload as {
    projectId: string;
    screenplay: string;
    modelConfig?: ModelConfigPayload;
    episodeId?: string;
    userId?: string;
  };

  let screenplay = payload.screenplay;
  let targetDurationSeconds: number | null = null;

  if (!screenplay) {
    if (payload.episodeId) {
      const [episode] = await db
        .select({ script: episodes.script, targetDurationSeconds: episodes.targetDurationSeconds })
        .from(episodes)
        .where(eq(episodes.id, payload.episodeId));
      screenplay = episode?.script ?? "";
      targetDurationSeconds = episode?.targetDurationSeconds ?? null;
    } else {
      const [project] = await db
        .select({ script: projects.script })
        .from(projects)
        .where(eq(projects.id, payload.projectId));
      screenplay = project?.script ?? "";
    }
  } else if (payload.episodeId) {
    // screenplay was passed directly (e.g. from generate route), but still fetch duration
    const [episode] = await db
      .select({ targetDurationSeconds: episodes.targetDurationSeconds })
      .from(episodes)
      .where(eq(episodes.id, payload.episodeId));
    targetDurationSeconds = episode?.targetDurationSeconds ?? null;
  }

  const projectCharacters = await getShotCharacters(
    payload.projectId,
    payload.episodeId ?? null
  );

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const systemPrompt = await resolvePrompt("shot_split", {
    userId: payload.userId ?? "",
    projectId: payload.projectId,
  });
  const ai = resolveAIProvider(payload.modelConfig);

  const extracted = extractShotsFromScript(screenplay);
  if (extracted.detection.matched && extracted.shots.length > 0) {
    const completedShots = finalizeExtractedShotsForDb(extracted.shots);
    const warnings =
      extracted.warnings.length > 0 ? extracted.warnings : undefined;
    completedShots.forEach((shot) => {
      shot.warnings = warnings;
    });

    await persistStoryboardVersion({
      projectId: payload.projectId,
      episodeId: payload.episodeId ?? null,
      shotCharacters: projectCharacters,
      shots: completedShots,
    });

    return { shots: extracted.shots };
  }

  const result = await ai.generateText(
    buildShotSplitPrompt(screenplay, characterDescriptions, undefined, targetDurationSeconds),
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
