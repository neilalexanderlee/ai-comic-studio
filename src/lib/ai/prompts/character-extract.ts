import { resolvePrompt } from "./resolver";
import {
  CHARACTER_EXTRACT_DEFAULT_SLOTS,
  assembleCharacterExtractPrompt,
} from "./character-extract-defaults";
import { buildStyleInstruction, VISUAL_STYLE_PRESETS } from "./visual-style-presets";

export { VISUAL_STYLE_PRESETS, buildStyleInstruction } from "./visual-style-presets";

export const CHARACTER_EXTRACT_SYSTEM = assembleCharacterExtractPrompt(
  CHARACTER_EXTRACT_DEFAULT_SLOTS
);

function injectCharacterExtractStyle(prompt: string, visualStyle: string): string {
  return prompt.replace(/\{STYLE_INSTRUCTION\}/g, buildStyleInstruction(visualStyle));
}

/** Code defaults only (no DB overrides). */
export function buildCharacterExtractSystemPrompt(visualStyle: string): string {
  return injectCharacterExtractStyle(CHARACTER_EXTRACT_SYSTEM, visualStyle);
}

/** Registry + DB overrides; always injects project visualStyle into `{STYLE_INSTRUCTION}`. */
export async function resolveCharacterExtractSystemPrompt(
  visualStyle: string,
  options: { userId: string; projectId?: string }
): Promise<string> {
  const resolved = await resolvePrompt("character_extract", options);
  return injectCharacterExtractStyle(resolved, visualStyle);
}

// ─── Pass 1: LLM name enumeration ───────────────────────────────────────────

/**
 * System prompt for the lightweight first-pass name enumeration.
 * The sole job is to produce a JSON array of character names — no descriptions.
 */
export const CHARACTER_NAME_EXTRACTION_SYSTEM = `You are a script analyst. List every character who needs a visual reference sheet (costume + appearance guide) in this screenplay.

Apply these rules IN ORDER — higher priority overrides lower:

━━━ PRIORITY 1 — HARD KEEP (non-human boss/creature individuals) ━━━
Any creature, monster, beast, or supernatural entity that is THE unique individual in its scene
(not a generic horde) → ALWAYS include, regardless of name form.
  ✓ "火龙"（有台词） / "狼人领主" / "魔龙" / "石龙" / "魔王" → KEEP
  ✗ "一群火龙" / "魔族群兽" (horde, not an individual) → SKIP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ PRIORITY 2 — HARD SKIP (interchangeable human crowd/functional roles) ━━━
Human roles where any same-type person could be substituted with zero story impact
→ SKIP even if they have spoken dialogue lines.
  THE TEST: "Could a different person of the same label deliver this line?" If YES → SKIP.
  ✗ "旁观佣兵（惊讶）：..." → SKIP (any bystander mercenary would say this)
  ✗ "人族斥候（喘息）：..." → SKIP (any scout messenger would bring this news)
  ✗ "路过商人：..." / "受伤士卒：..." / "守卫甲：..." → SKIP
  ✗ "[race]的[role]" patterns: "人族的斥候"、"精灵的卫兵" → SKIP
  ✗ Generic crowd: "士兵" / "村民" / "百姓" / "守卫" / "信使" → SKIP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INCLUDE (after priority checks above):
• Personal names: "龙渊" / "灵瑶" / "赤狮" → INCLUDE
• Relational titles who appear in ANY scene with a named action or described appearance: "龙渊父亲" / "龙渊母亲" / "母亲" / "酒馆老板娘" → INCLUDE (even one scene, even no dialogue — they need a consistent face)
• One-scene characters with high story weight (death, betrayal, key info delivery, emotional farewell) → INCLUDE

EXCLUDE always (no priority override):
• Skill/spell/technique names: 星晶护盾、霜魂斩、寒星锁
• Named weapons/objects: 无双（剑名）、永夜（法杖名）、霜魂刀

NAME FORM: use the MOST SPECIFIC form — "龙渊父亲" not just "父亲".

OUTPUT: JSON array of strings only — no descriptions, no markdown, no commentary.
Example: ["龙渊", "灵瑶", "龙渊父亲", "母亲", "火龙", "狼人领主", "酒馆老板娘"]`;

export function buildCharacterNameExtractionPrompt(screenplay: string): string {
  return `List every character who needs a visual reference sheet in this screenplay.

--- SCREENPLAY ---
${screenplay}
--- END ---

Output ONLY a JSON array of character names. Use the most specific name form for each character (e.g. "龙渊父亲" not just "父亲"). Match the language of the screenplay.`;
}

// ─── Pass 2: Full character sheet generation ─────────────────────────────────

/**
 * Build the user prompt for the full character sheet extraction.
 * confirmedNames: list produced by pass-1 LLM enumeration — injected as a mandatory list.
 */
export function buildCharacterExtractPrompt(
  screenplay: string,
  confirmedNames: string[] = []
): string {
  const mandatoryBlock =
    confirmedNames.length > 0
      ? `
⚠️ MANDATORY CAST LIST ⚠️
A dedicated name-extraction pass has already identified the following characters in this screenplay.
Every name below MUST have an entry in your output JSON array — UNLESS it is clearly a TYPE/GROUP LABEL (see SKIP rules: compound labels like "旁观佣兵", "[race]的[role]" patterns, etc. have no personal identity and may be omitted).
• If two names refer to the same person, merge into ONE entry and list both in "aliases".
• If a name is an obvious group/type label with no individual identity, you may omit it (name-extraction sometimes makes mistakes on compound role labels).

${confirmedNames.map((n) => `  • ${n}`).join("\n")}

Any name absent from your final JSON = INVALID output.
`
      : "";

  return `Extract and create detailed visual character specifications for EVERY named character in this screenplay. Each description must be specific enough to serve as a binding art reference for consistent AI image generation.
${mandatoryBlock}
--- SCREENPLAY ---
${screenplay}
--- END ---

IMPORTANT: Your output language MUST match the language of the screenplay above. If it is in Chinese, write ALL fields (name, description, personality) in Chinese.`;
}
