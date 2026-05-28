import { resolvePrompt } from "./resolver";
import {
  IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS,
  assembleImportCharacterExtractPrompt,
} from "./import-character-extract-defaults";
import { CHARACTER_NAME_EXTRACTION_SYSTEM, buildCharacterNameExtractionPrompt } from "./character-extract";
import { buildStyleInstruction } from "./visual-style-presets";

// Re-export so import/characters/route.ts can import from one place
export { CHARACTER_NAME_EXTRACTION_SYSTEM as IMPORT_CHARACTER_NAME_EXTRACTION_SYSTEM };
export { buildCharacterNameExtractionPrompt as buildImportCharacterNameExtractionPrompt };

function buildImportStyleInstruction(visualStyle: string): string {
  return buildStyleInstruction(visualStyle);
}

const IMPORT_CHARACTER_EXTRACT_TEMPLATE = assembleImportCharacterExtractPrompt(
  IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS
);

function injectImportStyle(prompt: string, visualStyle: string): string {
  return prompt.replace(/\{STYLE_INSTRUCTION\}/g, buildImportStyleInstruction(visualStyle));
}

/** Code defaults only (no DB overrides). */
export function buildImportCharacterExtractSystem(visualStyle = "auto"): string {
  return injectImportStyle(IMPORT_CHARACTER_EXTRACT_TEMPLATE, visualStyle);
}

/** Registry + DB overrides; always injects project visualStyle into `{STYLE_INSTRUCTION}`. */
export async function resolveImportCharacterExtractSystem(
  visualStyle: string,
  options: { userId: string; projectId?: string }
): Promise<string> {
  const resolved = await resolvePrompt("import_character_extract", options);
  return injectImportStyle(resolved, visualStyle);
}

/** @deprecated Use buildImportCharacterExtractSystem / resolveImportCharacterExtractSystem */
export const IMPORT_CHARACTER_EXTRACT_SYSTEM = buildImportCharacterExtractSystem("auto");

export function buildImportCharacterExtractPrompt(
  textChunk: string,
  confirmedNames: string[] = []
): string {
  const mandatoryBlock =
    confirmedNames.length > 0
      ? `
⚠️ MANDATORY CAST LIST ⚠️
A dedicated name-extraction pass identified the following characters. Include every name UNLESS it is clearly a TYPE/GROUP LABEL (see SKIP rules above — e.g. "旁观佣兵", "人族斥候" are role descriptions, not individuals).
If two names refer to the same person, merge into ONE entry with the more specific name.
If a character from this list does not appear in the current text chunk, still include them with frequency=0 and infer their appearance from any context available.

${confirmedNames.map((n) => `  • ${n}`).join("\n")}

Exception: if a name from this list is an obvious group/type label with no personal identity, you may OMIT it (the name-extraction pass sometimes makes mistakes on compound role labels).

`
      : "";

  return `Extract all named characters from the following text. For each character, produce a detailed visual specification suitable for AI image generation. Count their approximate appearances. If the text doesn't describe a character's appearance explicitly, INFER it from their role, era, and context (e.g. a Ming Dynasty emperor wears 龙袍, a soldier wears 铠甲).
${mandatoryBlock}
--- TEXT ---
${textChunk}
--- END ---

Return ONLY the JSON array.`;
}
