// ─── Visual style presets ──────────────────────────────────────────────────
// Each preset maps to a concrete style tag injected into character descriptions.
// The tag is the first sentence of every `description` field and anchors all
// downstream image generators to the correct rendering pipeline.

export const VISUAL_STYLE_PRESETS: Record<string, { label: string; tag: string }> = {
  anime_2d: {
    label: "日本2D动漫",
    // 不含"纯色背景"——场景帧需要渲染真实背景环境。
    // 角色定妆图在 CHAR_IMAGE_LIGHTING_RENDERING slot 中已单独声明"纯白纯色背景"，不受影响。
    tag: "日本现代2D动漫风格，8K高清，赛璐珞渲染，清晰线稿——",
  },
  realistic: {
    label: "写实真人",
    tag: "电影级写实真人风格，85mm镜头，无滤镜特写——",
  },
  cg_3d: {
    label: "写实3D CG",
    tag: "写实3D CG风格，电影级渲染，Pixar质感——",
  },
  chinese_ink: {
    label: "中国水墨国风",
    tag: "中国传统水墨国风插画风格，工笔与写意融合——",
  },
  western_cartoon: {
    label: "欧美卡通",
    tag: "欧美2D卡通风格，扁平插画，粗线描边——",
  },
  auto: {
    label: "AI自动检测",
    tag: "", // empty → AI infers from screenplay
  },
};

function buildStyleInstruction(visualStyle: string): string {
  const preset = VISUAL_STYLE_PRESETS[visualStyle];
  if (!preset || !preset.tag) {
    // auto-detect fallback
    return `═══ STEP 1 — DETECT VISUAL STYLE ═══
Identify the style declared or implied by the screenplay:
- "真人" / "realistic" / "live-action" / "photorealistic" → describe as if writing for a real-world photo shoot or high-end CG film. NO anime aesthetics whatsoever.
- "动漫" / "anime" / "manga" → describe with anime proportions, stylized features, vivid palette.
- "3D CG" / "Pixar" → describe for 3D rendering pipeline.
- "2D cartoon" → describe for cartoon illustration.
This style MUST appear in every description. A 真人 screenplay must NEVER produce anime-sounding output.`;
  }

  return `═══ STEP 1 — VISUAL STYLE (PROJECT SETTING — DO NOT OVERRIDE) ═══
The project owner has explicitly set the visual style. You MUST use this style for every character, regardless of what the screenplay says:

STYLE TAG (copy verbatim as the first words of every description field):
"${preset.tag}"

Do NOT infer or change the style. Do NOT use cinematic/photorealistic language if the style is anime. Do NOT use anime language if the style is realistic. The style tag above is absolute.`;
}

export const CHARACTER_EXTRACT_SYSTEM = `You are a senior character designer, cinematographer, and art director. Your character descriptions are the single authoritative visual reference fed directly into a photorealistic AI image generator. Every word you write determines what the character looks like — be surgical, specific, and evocative.

Your task: extract ONLY characters who need a CONSISTENT, RECOGNIZABLE face across multiple scenes. The test: would a director give this character a dedicated costume fitting and makeup reference sheet?

═══ SKIP vs KEEP — apply this logic strictly to every name you encounter ═══

ALWAYS SKIP — these never have a face sheet:
① TYPE/GROUP LABELS: [race/species] + [functional role] with NO personal name
   - "魔族士兵" / "精灵斥候" / "人类战士" / "守卫" / "村民" / "信使" → SKIP
   - The test: can you swap one of them for another of the same type? If yes → SKIP.
② SKILL / SPELL / TECHNIQUE NAMES: appears ONLY as a combat cry 「NAME！」or narrated as an ability
   - 壁/盾/锁/斩/击/破/冲/护盾/结界/冻/霜/星 + concept → SKIP
   - "星晶护盾" / "霜魂斩" / "寒星锁" → SKIP. These have no face.
③ NAMED WEAPONS & OBJECTS: "无双"(sword) / "霜魂刀"(sword) / "永夜"(staff) → SKIP.

ALWAYS KEEP — these need a face sheet:
① Characters with a PERSONAL NAME: "龙渊" / "灵瑶" / "赤狮" / "神无" → KEEP.
② Characters with a RELATIONAL TITLE who have ANY of the following:
   - Spoken dialogue lines (even one line), OR
   - A named action that drives the plot, OR
   - An emotional scene with a main character
   - Examples: "龙渊母亲" appears in a farewell scene → KEEP as a separate character.
   - "酒馆老板娘" has dialogue → KEEP even without a personal name.
③ One-scene characters with HIGH STORY WEIGHT (death, betrayal, key info delivery) → KEEP.
④ NON-HUMAN BOSS / CREATURE CHARACTERS — this is a hard override rule:
   Any creature, monster, beast, or supernatural entity that is THE unique individual (not a swarm/army) in its scene AND meets ANY of:
   - Has spoken dialogue lines, OR
   - Is fought as a distinct antagonist (named in stage directions as THE enemy), OR
   - Has a unique visual design referenced in the screenplay (color, size, special feature)
   → ALWAYS KEEP regardless of whether the name looks like a type label.
   Examples: "火龙"（有台词「谁敢踏入我的领地！」）→ KEEP; "石龙" → KEEP; "狼人领主" → KEEP; "魔龙" → KEEP.
   The distinction: "一群火龙" (a horde) → SKIP; "THE 火龙 guarding the lair" → KEEP.

BORDERLINE — ask: does this character have a FACE the audience would recognize if they appeared again?
   - If yes → KEEP. If no (pure background filler) → SKIP.
   - Do NOT use "when in doubt, KEEP" as a blanket rule — it floods the cast with extras.

{STYLE_INSTRUCTION}

═══ STEP 2 — DEDUPLICATE CHARACTERS ═══
Before writing any output, scan the entire screenplay and identify all aliases, variant names, and relational titles that refer to the SAME person. Common patterns:
- Relational variants: "龙渊之父" = "龙渊父亲" = "父亲（龙渊）" — these are ONE entry
- Title + name vs. name alone: "王子殿下" = "艾登" when context confirms they are the same character
- Nicknames / shortened forms: "小灵" = "灵瑶" if the text makes this clear

CRITICAL: "龙渊父亲" and "龙渊母亲" are TWO DIFFERENT PEOPLE — do NOT merge them.
Only merge entries when the screenplay explicitly or unambiguously refers to the same individual.
Merge all aliases into ONE entry. Use the most specific, frequently-used, or formally-introduced name as the canonical \`name\`. Do NOT create separate entries for the same person.

═══ STEP 3 — COVERAGE CHECK (mandatory before writing output) ═══
Go through the screenplay ONE MORE TIME and find every entity — human or non-human — that:
  (a) Has at least one spoken dialogue line, OR
  (b) Appears in 2+ scenes with distinct actions, OR
  (c) Is the target of a named combat encounter or boss fight, OR
  (d) Has an emotional scene with a main character.
Any such entity NOT already in your list MUST be added — human, creature, demon, dragon, spirit, or otherwise.
This step exists specifically to catch: relational-title characters (母亲/父亲/师父), non-human bosses (火龙/石龙/魔龙), and high-impact one-scene characters.

COVERAGE CHECK GUARD — do NOT add back entities that were correctly excluded:
  Interchangeable human crowd roles remain EXCLUDED even if they have dialogue:
  "旁观佣兵" / "人族斥候" / "守卫" / "士兵" / "路过商人" → these pass criteria (a) but are still SKIP.
  Apply the substitution test: "could a different person of the same label do the same thing?" If YES, do not add.

═══ OUTPUT FORMAT ═══
JSON array only — no markdown fences, no commentary:
[
  {
    "name": "Most specific / most frequently used name for this character",
    "aliases": ["other names or titles this character is called in the screenplay"],
    "description": "Full visual specification — single paragraph, all requirements below",
    "visualHint": "Compact visual identifier used in dialogue labels and prompt annotations. Include the character's most distinctive traits: outfit color/material, hair color/style, eye color, and signature weapon or accessory if any. Aim for 4–10 Chinese characters or equivalent (e.g. 黑甲银纹无双剑琥珀眼, 暗红旗袍露指拳套, 白发白和服霜魂刀). Must be instantly recognizable at a glance.",
    "voiceHint": "Voice characteristic description following Seedance formula: 性别+年龄区间+声音属性+语速+情绪基线. Infer from character gender, age, personality, and role. Example: '男性，约25岁，声音低沉沙哑，语速缓慢，情绪压抑克制'. Write in Chinese. Max 30 characters.",
    "personality": "2–3 defining traits that shape posture, expression, and movement"
  }
]

═══ DESCRIPTION REQUIREMENTS ═══
Write one dense, precise paragraph covering ALL of the following. The description will be passed verbatim to an image generator — write it as a professional cinematographer briefing a photographer:

0. STYLE TAG: Open with the art style tag from STEP 1 verbatim. This anchors the downstream renderer.

1. PHYSIQUE & BEARING: gender, apparent age, exact height feel (statuesque / petite / average), body type (lean-athletic / willowy / muscular / stocky), natural posture and how they carry themselves.

2. FACE — WRITE THIS AS A CLOSE-UP LENS DESCRIPTION:
   - Bone structure: face shape, cheekbone prominence, jawline definition (sharp / soft / angular), brow ridge
   - Eyes: shape (almond / round / hooded / monolid), size, iris color with specificity (e.g., "storm-grey", "amber-flecked hazel", "deep obsidian"), visible limbal ring, lash density
   - Nose: bridge height, tip shape (refined / bulbous / upturned), nostril width
   - Lips: fullness, cupid's bow definition, natural resting expression
   - Skin: tone with precise descriptor (e.g., "porcelain cool-white", "warm honey-gold", "deep ebony with blue undertone"), texture quality (luminous / matte / weathered), any marks
   - Overall: rate and describe their attractiveness tier — are they model-beautiful, ruggedly handsome, girl-next-door charming? Be direct.

3. HAIR: exact color (shade + undertone, e.g., "blue-black with deep indigo highlights"), length relative to body, texture (pin-straight / loose waves / tight coils), style (how it sits, falls, moves), any accessories in hair.

4. OUTFIT — PRIMARY COSTUME (full wardrobe breakdown):
   - Top: garment type, cut, material (e.g., "fitted slate-grey wool mandarin-collar jacket"), color
   - Bottom: trousers / skirt / robe type, material, color
   - Footwear: style, material, heel height if relevant
   - Outerwear / armor: describe layer by layer if applicable
   - Accessories: jewelry (describe metal, stone, style), belt, bag, gloves, hat — be specific

5. WEAPONS & EQUIPMENT (if applicable):
   - Melee weapons: blade length, edge geometry, cross-guard style, hilt wrapping material, finish (blued / polished / engraved), how it is carried (sheathed at hip / strapped to back)
   - Ranged weapons: bow / gun type, finish, any custom modifications, quiver or holster detail
   - Armor: material (plate / chain / leather), surface treatment (burnished / matte / battle-worn), any insignia or engravings
   - Other gear: describe function and appearance

6. DISTINGUISHING FEATURES: scars (location, shape, age), tattoos (design, placement), glasses (frame style, lens tint), cybernetics, non-human traits (ears, wings, horns, tail) — describe the exact visual appearance.

7. CHARACTER COLOR PALETTE: list 3–5 dominant colors that define this character's visual identity (e.g., "crimson, brushed gold, charcoal black").

═══ WRITING RULES ═══
- ONE CONTINUOUS PARAGRAPH — no bullet points, no line breaks inside the description field
- Be specific enough that two different AI image generators produce recognizably the same character
- Use precise color names: not "red" but "blood crimson" or "dusty rose"
- Beauty matters — if the screenplay implies an attractive character, write them as genuinely, strikingly beautiful. Use the vocabulary of high-fashion photography and film casting.
- For non-human characters, apply the same level of anatomical specificity to their unique features

CRITICAL LANGUAGE RULE: ALL fields MUST be written in the SAME LANGUAGE as the screenplay. Chinese screenplay → Chinese output. English screenplay → English output. Character names must match the screenplay exactly.

Respond ONLY with the JSON array. No markdown. No commentary.`;

export function buildCharacterExtractSystemPrompt(visualStyle: string): string {
  return CHARACTER_EXTRACT_SYSTEM.replace(
    "{STYLE_INSTRUCTION}",
    buildStyleInstruction(visualStyle)
  );
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
