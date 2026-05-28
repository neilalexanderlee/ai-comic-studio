import { db } from "@/lib/db";
import { projects, characters } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import {
  buildCharacterExtractPrompt,
  buildCharacterExtractSystemPrompt,
  resolveCharacterExtractSystemPrompt,
} from "@/lib/ai/prompts/character-extract";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { eq, and } from "drizzle-orm";
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

  const systemPrompt = payload.userId
    ? await resolveCharacterExtractSystemPrompt(visualStyle, {
        userId: payload.userId,
        projectId: payload.projectId,
      })
    : buildCharacterExtractSystemPrompt(visualStyle);

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
    voiceHint?: string;
  }>;

  // Load all existing characters for this project (used for dedup + upsert)
  const existingChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, payload.projectId));

  let newCharacters = extracted;

  // AI deduplication when extracting for an episode with existing chars
  if (payload.episodeId && existingChars.length > 0) {
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

  // Build a lookup map: name → existing record
  const existingByName = new Map(existingChars.map((c) => [c.name, c]));

  const created = [];
  const updated = [];

  for (const char of newCharacters) {
    const existing = existingByName.get(char.name);

    if (existing) {
      // Upsert: update fields if the new extraction provides richer data.
      const newHint = char.visualHint?.trim() ?? "";
      const newDesc = char.description?.trim() ?? "";
      const newVoice = char.voiceHint?.trim() ?? "";
      const shouldUpdateHint =
        newHint.length > 0 &&
        (existing.visualHint?.trim() ?? "").length < newHint.length;
      const shouldUpdateDesc =
        newDesc.length > 0 &&
        (existing.description?.trim() ?? "").length < newDesc.length;
      // Always update voiceHint if new extraction provides one and existing is empty
      const shouldUpdateVoice =
        newVoice.length > 0 && !(existing.voiceHint?.trim());

      if (shouldUpdateHint || shouldUpdateDesc || shouldUpdateVoice) {
        const updateData: Partial<typeof characters.$inferInsert> = {};
        if (shouldUpdateHint) updateData.visualHint = newHint;
        if (shouldUpdateDesc) updateData.description = newDesc;
        if (shouldUpdateVoice) updateData.voiceHint = newVoice;

        const [record] = await db
          .update(characters)
          .set(updateData)
          .where(eq(characters.id, existing.id))
          .returning();
        updated.push(record);
        console.log(
          `[CharacterExtract] Updated ${char.name}: visualHint="${newHint}" voiceHint="${newVoice}"`
        );
      } else {
        console.log(`[CharacterExtract] Skipped ${char.name} (existing data is already richer)`);
      }
    } else {
      // Insert new character
      const id = ulid();
      const [record] = await db
        .insert(characters)
        .values({
          id,
          projectId: payload.projectId,
          name: char.name,
          description: char.description,
          visualHint: char.visualHint ?? "",
          voiceHint: char.voiceHint ?? "",
          scope: "main",
          episodeId: payload.episodeId ?? null,
        })
        .returning();
      created.push(record);
    }
  }

  console.log(
    `[CharacterExtract] Done: ${created.length} inserted, ${updated.length} updated`
  );

  return { characters: [...created, ...updated] };
}
