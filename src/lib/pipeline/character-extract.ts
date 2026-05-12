import { db } from "@/lib/db";
import { projects, characters } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildCharacterExtractPrompt, buildCharacterExtractSystemPrompt } from "@/lib/ai/prompts/character-extract";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Task } from "@/lib/task-queue";

export async function handleCharacterExtract(task: Task) {
  const payload = task.payload as {
    projectId: string;
    screenplay: string;
    modelConfig?: ModelConfigPayload;
    episodeId?: string;
    userId?: string;
    visualStyle?: string;
  };

  // Resolve visual style: payload override → project setting → default anime_2d
  let visualStyle = payload.visualStyle ?? "anime_2d";
  if (!payload.visualStyle) {
    const [project] = await db
      .select({ visualStyle: projects.visualStyle })
      .from(projects)
      .where(eq(projects.id, payload.projectId));
    visualStyle = project?.visualStyle || "anime_2d";
  }

  const systemPrompt = buildCharacterExtractSystemPrompt(visualStyle);

  const ai = resolveAIProvider(payload.modelConfig);
  const result = await ai.generateText(
    buildCharacterExtractPrompt(payload.screenplay),
    { systemPrompt, temperature: 0.5 }
  );

  const extracted = JSON.parse(extractJSON(result)) as Array<{
    name: string;
    aliases?: string[];
    description: string;
    visualHint?: string;
  }>;

  let newCharacters = extracted;

  // AI deduplication when extracting for an episode with existing chars
  if (payload.episodeId) {
    const existingChars = await db
      .select()
      .from(characters)
      .where(eq(characters.projectId, payload.projectId));

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
