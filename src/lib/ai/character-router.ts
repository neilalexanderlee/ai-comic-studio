import { generateText } from "ai";
import { createLanguageModel } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";

export type CharacterAssets = {
  name: string;
  combatImage?: string | null;
  beautyImage?: string | null;
  referenceImage?: string | null;
};

/**
 * Intelligent Agentic Router that determines whether a character is in combat or casual state
 * based on the scene description.
 * It only invokes the LLM if the character has BOTH combat and beauty images to save time/cost.
 */
export async function determineCharacterState(
  sceneDesc: string,
  characterName: string,
  textModelConfig: ProviderConfig | null | undefined,
  userId: string,
  projectId: string
): Promise<"combat" | "casual"> {
  if (!textModelConfig) return "casual"; 

  try {
    const model = createLanguageModel(textModelConfig);
    
    // Resolve customizable prompt from registry
    const promptKey = "character_state_router";
    const slotContents = await resolveSlotContents(promptKey, { userId, projectId });
    const def = getPromptDefinition(promptKey);
    
    if (!def) throw new Error("character_state_router definition not found");
    
    const fullPrompt = def.buildFullPrompt(slotContents, { characterName, sceneDesc });

    const result = await generateText({
      model,
      prompt: fullPrompt,
    });

    const state = result.text.trim().toLowerCase();
    // Use regex or includes to be safer if LLM adds punctuation
    if (state.includes("combat")) return "combat";
    return "casual";
  } catch (err) {
    console.error(`[CharacterRouter] Failed to determine state for ${characterName}:`, err);
    return "casual";
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
): Promise<{ name: string; imagePath: string }[]> {
  const resolved: { name: string; imagePath: string }[] = [];

  for (const c of characters) {
    let finalPath: string | null | undefined = null;

    if (c.combatImage && c.beautyImage) {
      // Intelligent Routing needed because both exist
      const state = await determineCharacterState(sceneDesc, c.name, textModelConfig, userId, projectId);
      console.log(`[CharacterRouter] Character "${c.name}" state resolved as: ${state}`);
      finalPath = state === "combat" ? c.combatImage : c.beautyImage;
    } else {
      // Simple fallback logic if only one or none exist
      finalPath = c.combatImage || c.beautyImage || c.referenceImage;
    }

    if (finalPath) {
      resolved.push({ name: c.name, imagePath: finalPath });
    }
  }

  return resolved;
}
