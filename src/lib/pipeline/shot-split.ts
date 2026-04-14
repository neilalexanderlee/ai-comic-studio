import { db } from "@/lib/db";
import { shots, dialogues, characters } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { eq, and, or, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { Task } from "@/lib/task-queue";

export async function handleShotSplit(task: Task) {
  const payload = task.payload as {
    projectId: string;
    screenplay: string;
    modelConfig?: ModelConfigPayload;
    episodeId?: string;
    userId?: string;
  };

  // Get characters for this project (include main + episode-scoped)
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(
      payload.episodeId
        ? and(eq(characters.projectId, payload.projectId), or(isNull(characters.episodeId), eq(characters.episodeId, payload.episodeId)))
        : eq(characters.projectId, payload.projectId)
    );

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const systemPrompt = await resolvePrompt("shot_split", {
    userId: payload.userId ?? "",
    projectId: payload.projectId,
  });

  const ai = resolveAIProvider(payload.modelConfig);
  const result = await ai.generateText(
    buildShotSplitPrompt(payload.screenplay, characterDescriptions),
    { systemPrompt, temperature: 0.5 }
  );

  const parsedShots = JSON.parse(extractJSON(result)) as Array<{
    sequence: number;
    prompt: string;
    duration: number;
    dialogues: Array<{ character: string; text: string }>;
  }>;

  const created = [];
  for (const shot of parsedShots) {
    const shotId = ulid();
    const [record] = await db
      .insert(shots)
      .values({
        id: shotId,
        projectId: payload.projectId,
        sequence: shot.sequence,
        prompt: shot.prompt,
        duration: shot.duration,
        episodeId: payload.episodeId ?? null,
      })
      .returning();

    // Create dialogues for this shot
    for (let i = 0; i < shot.dialogues.length; i++) {
      const dialogue = shot.dialogues[i];
      const matchedChar = projectCharacters.find(
        (c) => c.name === dialogue.character
      );
      if (matchedChar) {
        await db.insert(dialogues).values({
          id: ulid(),
          shotId,
          characterId: matchedChar.id,
          text: dialogue.text,
          sequence: i,
        });
      }
    }

    created.push(record);
  }

  return { shots: created };
}
