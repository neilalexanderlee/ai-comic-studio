import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildCharacterExtractPrompt } from "@/lib/ai/prompts/character-extract";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Task } from "@/lib/task-queue";

export async function handleCharacterExtract(task: Task) {
  const payload = task.payload as {
    projectId: string;
    screenplay: string;
    modelConfig?: ModelConfigPayload;
    episodeId?: string;
    userId?: string;
  };

  const systemPrompt = await resolvePrompt("character_extract", {
    userId: payload.userId ?? "",
    projectId: payload.projectId,
  });

  const ai = resolveAIProvider(payload.modelConfig);
  const result = await ai.generateText(
    buildCharacterExtractPrompt(payload.screenplay),
    { systemPrompt, temperature: 0.5 }
  );

  const extracted = JSON.parse(extractJSON(result)) as Array<{
    name: string;
    description: string;
    visualHint?: string;
  }>;

  let newCharacters = extracted;

  // AI deduplication when extracting for an episode with existing main chars
  if (payload.episodeId) {
    const existingChars = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.projectId, payload.projectId), eq(characters.scope, "main"))
      );

    if (existingChars.length > 0) {
      try {
        const existingNames = existingChars.map((c) => c.name);
        const dedupeResult = await ai.generateText(
          `Existing characters: ${JSON.stringify(existingNames)}\n\nNewly extracted characters: ${JSON.stringify(extracted.map(c => c.name))}\n\nReturn a JSON array of ONLY the truly new character names that are NOT variants or aliases of existing characters. Consider nicknames, shortened names, and honorific variations as the same character.`,
          { systemPrompt: "You are a character deduplication assistant. Return only a JSON array of strings.", temperature: 0 }
        );
        const newNames = new Set(JSON.parse(extractJSON(dedupeResult)) as string[]);
        newCharacters = extracted.filter((c) => newNames.has(c.name));
      } catch (dedupeErr) {
        console.warn("[CharacterExtract] Deduplication failed, inserting all:", dedupeErr);
      }
    }
  }

  const created = [];
  for (const char of newCharacters) {
    const id = ulid();
    const [record] = await db
      .insert(characters)
      .values({
        id,
        projectId: payload.projectId,
        name: char.name,
        description: char.description,
        visualHint: char.visualHint ?? "",
        scope: "main",
        episodeId: payload.episodeId ?? null,
      })
      .returning();
    created.push(record);
  }

  return { characters: created };
}
