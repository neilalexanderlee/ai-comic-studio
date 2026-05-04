import { db } from "@/lib/db";
import { projects, episodes, shots, characters, characterAssets } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildCharacterTurnaroundPrompt } from "@/lib/ai/prompts/character-image";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Task } from "@/lib/task-queue";

export async function handleCharacterImage(task: Task) {
  const payload = task.payload as { characterId: string; modelConfig?: ModelConfigPayload };

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, payload.characterId));

  if (!character) {
    throw new Error("Character not found");
  }

  const ai = resolveImageProvider(payload.modelConfig);
  const slotContents = await resolveSlotContents("character_image", { userId: "", projectId: character.projectId });
  const prompt = buildCharacterTurnaroundPrompt(slotContents, character.name, character.description || "");

  const imagePath = await ai.generateImage(prompt, {
    size: "2560x1440",
    aspectRatio: "16:9",
    quality: "hd",
  });

  await db
    .insert(characterAssets)
    .values({
      id: ulid(),
      characterId: payload.characterId,
      imagePath,
      tag: "四视图",
      assetType: "blueprint",
      isDefault: 0,
    });

  return { imagePath };
}
