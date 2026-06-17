/**
 * Normalize a character name for dialogue-matching purposes.
 *
 * Rules:
 * - Strip trailing ：/ : punctuation (dialogue-line artefact)
 * - Preserve "form" identity markers that end in 形态, e.g. (人形态), (龙形态)
 *   even when they carry a ·emotion suffix like (人形态·愤怒) → (人形态)
 * - Strip all other parentheticals (age, emotion, state, etc.)
 * - Collapse whitespace and lowercase
 *
 * Examples:
 *   魔王(人形态·愤怒)  → 魔王(人形态)
 *   魔王(龙形态)       → 魔王(龙形态)
 *   角色甲(25岁)      → 角色甲
 *   林小白(紧张)       → 林小白
 */
export function normalizeCharacterName(name: string): string {
  // Unify full-width brackets/colons to half-width first
  let result = name
    .trim()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[：:]\s*$/, "");

  // Replace each parenthetical: keep form-identity markers, strip the rest
  result = result.replace(/[（(]([^)）]*)[)）]/g, (_match, content: string) => {
    // A "form" identifier ends with 形态 (optionally preceded by adjective)
    // It may be followed by ·emotion suffix — strip the suffix, keep the form
    const formMatch = content.match(/^([^·•]*形态)[·•]/);
    if (formMatch) {
      // e.g. "人形态·愤怒" → keep "(人形态)"
      return `(${formMatch[1].trim()})`;
    }
    // Pure form with no suffix: "人形态" or "龙形态"
    if (/形态$/.test(content.trim())) {
      return `(${content.trim()})`;
    }
    // Everything else (age, emotion, state): strip
    return "";
  });

  return result.replace(/\s+/g, "").toLowerCase();
}

/**
 * Normalize keeping age qualifiers (e.g. "10岁") but stripping emotion/state.
 * Used for the first-pass exact match in dialogue-to-character resolution,
 * so "龙渊（10岁）" matches the 10-year-old variant and "龙渊" matches the adult.
 *
 * Examples:
 *   龙渊（10岁）       → 龙渊(10岁)
 *   龙渊（10岁·愤怒）  → 龙渊(10岁)
 *   魔王(人形态·愤怒)  → 魔王(人形态)
 *   林小白(紧张)       → 林小白
 */
export function normalizeCharacterNameWithAge(name: string): string {
  let result = name
    .trim()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[：:]\s*$/, "");

  result = result.replace(/[（(]([^)）]*)[)）]/g, (_match, content: string) => {
    const trimmed = content.trim();
    // Keep pure age qualifiers: "10岁", "8岁" etc.
    if (/^\d+\s*岁$/.test(trimmed)) return `(${trimmed})`;
    // Keep age with emotion suffix stripped: "10岁·愤怒" → "(10岁)"
    const ageWithSuffix = trimmed.match(/^(\d+\s*岁)[·•]/);
    if (ageWithSuffix) return `(${ageWithSuffix[1].trim()})`;
    // Keep form identifiers (existing logic)
    const formMatch = content.match(/^([^·•]*形态)[·•]/);
    if (formMatch) return `(${formMatch[1].trim()})`;
    if (/形态$/.test(trimmed)) return `(${trimmed})`;
    // Strip everything else (emotion, state)
    return "";
  });

  return result.replace(/\s+/g, "").toLowerCase();
}
