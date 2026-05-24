import {
  VISUAL_STYLE_PRESETS,
  CHARACTER_NAME_EXTRACTION_SYSTEM,
  buildCharacterNameExtractionPrompt,
} from "./character-extract";

// Re-export so import/characters/route.ts can import from one place
export { CHARACTER_NAME_EXTRACTION_SYSTEM as IMPORT_CHARACTER_NAME_EXTRACTION_SYSTEM };
export { buildCharacterNameExtractionPrompt as buildImportCharacterNameExtractionPrompt };

function buildImportStyleInstruction(visualStyle: string): string {
  const preset = VISUAL_STYLE_PRESETS[visualStyle];
  if (!preset || !preset.tag) {
    return `═══ STEP 1 — DETECT VISUAL STYLE ═══
Identify the style declared or implied by the text:
- "真人" / "realistic" / "live-action" / historical → describe as photorealistic cinematic. NO anime aesthetics.
- "动漫" / "anime" / "manga" → describe with anime proportions, stylized features.
- "3D CG" / "Pixar" → describe for 3D rendering.
- If no style is specified, infer from content (historical text → photorealistic historical drama).`;
  }

  return `═══ STEP 1 — VISUAL STYLE (PROJECT SETTING — DO NOT OVERRIDE) ═══
The project owner has explicitly set the visual style. Use ONLY this style for every character:

STYLE TAG (copy verbatim as the first words of every description field):
"${preset.tag}"

Do NOT infer or change the style from the text content. The style tag above is absolute.`;
}

export function buildImportCharacterExtractSystem(visualStyle = "auto"): string {
  return `You are a senior character designer, cinematographer, and art director. Your task is to extract ALL named characters from the given text, estimate appearance frequency, and produce a professional visual specification for each character at the level of a real film production bible.

RULES:
1. Extract ONLY characters who need a CONSISTENT, RECOGNIZABLE face across multiple scenes — characters that a director would give a dedicated costume fitting and makeup reference sheet.
2. A character qualifies if it has a PERSONAL IDENTITY: a real name, a distinct personality, or a role where the same individual recurs and must look the same every time.
3. SKIP characters whose "name" is actually a TYPE, GROUP LABEL, or NON-CHARACTER ENTITY — even if they appear frequently or have dialogue lines:
   SUBSTITUTION TEST (apply first): "Could a different person with the same label do the exact same thing in this scene?" If YES → SKIP.
   a) INTERCHANGEABLE HUMAN CROWD/FUNCTIONAL ROLES — even with spoken dialogue lines:
      - "旁观佣兵" → SKIP (any bystander mercenary could say that line)
      - "魔族士兵" / "人族斥候" / "精灵哨兵" → SKIP (type labels, interchangeable)
      - "村民" / "百姓" / "路人" → SKIP (crowd types)
      - "守卫" / "士兵" / "卫兵" / "信使" / "传令兵" → SKIP (interchangeable functional roles)
      - "[race]的[role]" patterns: "人族的斥候"、"精灵的卫兵" → SKIP
   b) NON-HUMAN BOSS / CREATURE INDIVIDUALS — HARD OVERRIDE, always KEEP:
      Any creature, monster, or supernatural entity that is THE unique individual in its scene
      (not a generic horde) → KEEP regardless of name form, even if it looks like a type label.
      - "狼人领主" / "火龙" / "魔龙" / "石龙" / "魔王" → KEEP (unique individual with distinct design)
      - Distinction: "一群火龙"(horde) → SKIP; "THE 火龙 guarding the lair" → KEEP
   c) SKILLS, SPELLS, ABILITIES, AND TECHNIQUE NAMES:
      - Shouted as a battle cry or spell invocation → SKIP
      - Examples to SKIP: "星晶护盾", "霜魂斩", "寒星锁", "永夜壁"
      - KEEP character names that sound action-like: "龙渊", "白夜", "炎魔"
   d) WEAPONS AND OBJECTS — even named ones:
      - "永夜"(staff) / "无双"(sword) / "霜魂刀"(sword) → SKIP
   The key question: is there ONE specific INDIVIDUAL this name always refers to, with a FACE worth remembering?
   KEEP examples: "魔族将军赤狮" → KEEP (personal name "赤狮"); "龙渊" → KEEP; "酒馆老板娘" → KEEP (recurring individual)
3. Count approximate appearances/mentions for each character
4. Merge obvious aliases: "小明" and "明哥" are the same person; "老板娘" and "酒馆老板娘（矮人）" describing the same role are the same person — output ONE entry. When unsure, prefer the more descriptive name.
5. "name" MUST match the script: if the source begins with a block titled like "CAST", "Character standard names", or "系统提取·角色标准名" listing official strings, copy those strings **verbatim** as each JSON "name" value. Otherwise use stable names from the narrative; avoid redundant adult-only age suffixes that duplicate a bare name (put age in "description"); output a **separate entry** when child vs adult is clearly a different look. Do not list weapons as characters.
   IMPORTANT: treat full-width brackets （ ） and half-width brackets ( ) as identical — "魔王（人形态）" and "魔王(人形态)" are the SAME character, output only ONE entry using the script's official name from the 系统提取·角色标准名 table if present.
6. Do NOT include a "scope" field — character roles are determined by the user, not inferred here.

${buildImportStyleInstruction(visualStyle)}

═══ DESCRIPTION REQUIREMENTS ═══
The "description" field must be ONE dense paragraph covering ALL of the following, written as a professional cinematographer briefing a photographer:

0. STYLE TAG: Open with the art style tag from STEP 1 verbatim.
1. 【体态】: gender, apparent age, height/build, posture, how they carry themselves
2. 【面部】: face shape, jawline, brow ridge, eye shape/color, nose, lips, skin tone with precise descriptor, skin texture, attractiveness
3. 【发型】: exact color, length, style, any head accessories
4. 【服装】: full wardrobe breakdown — top, bottom, footwear, outerwear, accessories with materials and colors
5. 【武器/装备】(if applicable): detailed description of weapons, armor, gear
6. 【色彩调色板】: 3-5 dominant colors defining this character's visual identity

═══ VISUAL HINT ═══
The "visualHint" field must be 2-4 word PHYSICAL APPEARANCE tags for instant visual identification (e.g. "龙袍金冠阴沉脸", "大红直身佩刀", "silver hair red coat"). Must describe APPEARANCE, not actions.

CRITICAL LANGUAGE RULE: ALL output fields MUST be in the SAME LANGUAGE as the source text.

OUTPUT FORMAT — JSON array only, no markdown fences, no commentary:
[
  {
    "name": "Stable short character name — no age-in-parentheses suffix; age belongs in description",
    "frequency": 5,
    "description": "Full visual specification — one dense paragraph following ALL requirements above",
    "visualHint": "2-4 word physical appearance identifier"
  }
]

Respond ONLY with the JSON array. No markdown. No commentary.`;
}

// Backward-compat export kept for any existing callers
export const IMPORT_CHARACTER_EXTRACT_SYSTEM = buildImportCharacterExtractSystem("auto");

// ─── Pass 2: full character sheet extraction (per chunk) ─────────────────────
// Pass-1 (name enumeration) is shared from character-extract.ts via re-exports above.

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
