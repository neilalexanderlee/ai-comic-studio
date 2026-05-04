import { generateText } from "ai";
import { createLanguageModel } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";
import { db } from "@/lib/db";
import { characterAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export type CharacterAssets = {
  id: string;
  name: string;
};

/**
 * Intelligent Agentic Router that determines whether a character is in combat or casual state
 * based on the scene description.
 * It only invokes the LLM if the character has BOTH combat and beauty images to save time/cost.
 */
export async function determineCharacterState(
  sceneDesc: string,
  characterName: string,
  availableTags: string[],
  textModelConfig: ProviderConfig | null | undefined,
  userId: string,
  projectId: string
): Promise<{ tag: string; missing?: string }> {
  if (!textModelConfig || availableTags.length === 0) {
    return { tag: availableTags[0] || "日常" };
  }

  try {
    const model = createLanguageModel(textModelConfig);
    
    const promptKey = "character_state_router";
    const slotContents = await resolveSlotContents(promptKey, { userId, projectId });
    const def = getPromptDefinition(promptKey);
    
    if (!def) throw new Error("character_state_router definition not found");
    
    const fullPrompt = def.buildFullPrompt(slotContents, { 
      characterName, 
      sceneDesc,
      tags: availableTags
    });

    const result = await generateText({
      model,
      prompt: fullPrompt,
    });

    const output = result.text.trim();
    // Parse format: "Match: [Tag] (Missing: [Needed Tag])"
    const matchMatch = output.match(/Match:\s*([^(\n\r]+)/);
    const missingMatch = output.match(/\(Missing:\s*([^)]+)\)/);
    
    let matchedTag = matchMatch ? matchMatch[1].trim() : availableTags[0];
    
    // Ensure the matched tag is actually in the available list
    if (!availableTags.includes(matchedTag)) {
        matchedTag = availableTags[0];
    }

    return { 
        tag: matchedTag,
        missing: missingMatch ? missingMatch[1].trim() : undefined
    };
  } catch (err) {
    console.error(`[CharacterRouter] Failed to determine state for ${characterName}:`, err);
    return { tag: availableTags[0] || "日常" };
  }
}

/**
 * Resolves the most appropriate reference image for each character in a scene.
 */
export async function resolveCharacterImages(
  sceneDesc: string,
  characters: CharacterAssets[],
  textModelConfig: ProviderConfig | null | undefined,
  userId: string,
  projectId: string
): Promise<{ name: string; imagePath: string; missingState?: string }[]> {
  const resolved: { name: string; imagePath: string; missingState?: string }[] = [];

  for (const c of characters) {
    // 1. Fetch all morph assets for this character
    const assets = await db.select()
        .from(characterAssets)
        .where(and(
            eq(characterAssets.characterId, c.id),
            eq(characterAssets.assetType, "morph")
        ));

    const blueprintAssets = await db.select()
        .from(characterAssets)
        .where(and(
            eq(characterAssets.characterId, c.id),
            eq(characterAssets.assetType, "blueprint")
        ));

    const tags = assets.map(a => a.tag);
    let finalPath: string | null = null;
    let missing: string | undefined = undefined;

    if (tags.length > 1) {
      // Multiple options -> Ask AI
      const result = await determineCharacterState(sceneDesc, c.name, tags, textModelConfig, userId, projectId);
      const matchedAsset = assets.find(a => a.tag === result.tag);
      finalPath = matchedAsset?.imagePath || assets[0]?.imagePath || null;
      missing = result.missing;
    } else if (tags.length === 1) {
      // Only one morph -> Use it but still check for missing state if possible
      finalPath = assets[0].imagePath;
      // Optional: we could still call AI to see if it *thinks* it's missing something
      // But for performance, if only one exists, we just use it.
    } else {
      // No morphs -> Use blueprint
      finalPath = blueprintAssets[0]?.imagePath || null;
    }

    if (finalPath) {
      resolved.push({ 
        name: c.name, 
        imagePath: finalPath,
        missingState: missing
      });
      if (missing) {
          console.warn(`[CharacterRouter] Character "${c.name}" is missing visual state: ${missing} in scene: ${sceneDesc}`);
      }
    }
  }

  return resolved;
}
