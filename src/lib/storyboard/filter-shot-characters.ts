/**
 * filter-shot-characters.ts
 *
 * Shared utility for matching characters mentioned in a shot's text fields.
 *
 * Critical invariant (documented in CLAUDE.md):
 *   filterShotCharacters MUST return [] when no character names are found in
 *   the shot text.  Callers must NOT fall back to the full character list —
 *   that would inject irrelevant reference images into crowd / background
 *   scenes and confuse the generation model.
 */

/**
 * 提取角色名的「基础名」：去掉括号及其内容。
 * 例如："龙渊（10岁）" → "龙渊"，"灵瑶（8岁）" → "灵瑶"
 * 用于双向模糊匹配：脚本里写"龙渊"能匹配到"龙渊（10岁）"的角色资产。
 */
export function extractBaseName(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim();
}

function extractAge(name: string): string | null {
  const match = name.match(/(\d+)\s*岁/);
  return match?.[1] ?? null;
}

function hasAgeCue(text: string, baseName: string, age: string): boolean {
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${age}\\s*岁\\s*的?\\s*${escapedBase}`, "i"),
    new RegExp(`${escapedBase}\\s*[（(]\\s*${age}\\s*岁\\s*[）)]`, "i"),
    new RegExp(`${escapedBase}\\s*${age}\\s*岁`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * 从 shot 的文本字段中筛选出被提及的角色列表。
 *
 * 匹配规则（任意一条即通过）：
 *   1. 全名匹配：文本包含 "龙渊（10岁）"
 *   2. 基础名匹配：文本包含 "龙渊"（可匹配"龙渊（10岁）"的角色）
 *
 * ⚠️ 无匹配时返回空数组，调用方不得将此结果 fallback 到全量角色列表。
 */
export function filterShotCharacters<T extends { name: string }>(
  shotText: string,
  allCharacters: T[],
  options?: { contextText?: string | null }
): T[] {
  if (allCharacters.length === 0) return [];
  if (!shotText) return [];
  const text = shotText.toLowerCase();
  const contextText = (options?.contextText ?? "").toLowerCase();
  const matches: T[] = [];
  const grouped = new Map<string, T[]>();

  for (const character of allCharacters) {
    if (!character.name) continue;
    const baseName = extractBaseName(character.name).toLowerCase();
    if (!baseName) continue;
    grouped.set(baseName, [...(grouped.get(baseName) ?? []), character]);
  }

  for (const [baseName, group] of grouped) {
    const ageMatches = group.filter((character) => {
      const age = extractAge(character.name);
      return age ? hasAgeCue(text, baseName, age) : false;
    });
    if (ageMatches.length > 0) {
      matches.push(...ageMatches);
      continue;
    }

    const exactMatches = group.filter((character) =>
      character.name.toLowerCase() !== baseName && text.includes(character.name.toLowerCase())
    );
    if (exactMatches.length > 0) {
      matches.push(...exactMatches);
      continue;
    }

    if (!text.includes(baseName)) continue;

    const defaultVariants = group.filter((character) => !extractAge(character.name));
    const contextualAgeMatches = contextText
      ? group.filter((character) => {
          const age = extractAge(character.name);
          return age ? hasAgeCue(contextText, baseName, age) : false;
        })
      : [];
    const uniqueContextualAgeMatches = contextualAgeMatches.length === 1
      ? contextualAgeMatches
      : [];

    matches.push(
      ...(uniqueContextualAgeMatches.length > 0
        ? uniqueContextualAgeMatches
        : defaultVariants.length > 0
          ? defaultVariants
          : group)
    );
  }

  return matches;
}
