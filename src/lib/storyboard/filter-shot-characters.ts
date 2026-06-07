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
 * 例如："角色甲（10岁）" → "角色甲"，"角色乙（8岁）" → "角色乙"
 * 用于双向模糊匹配：脚本里写"角色甲"能匹配到"角色甲（10岁）"的角色资产。
 */
export function extractBaseName(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim();
}

/**
 * 检查 baseName 在文本中是否有「独立出现」——即存在至少一处位置，
 * 其后紧跟的字符串并不构成 longerNames 中任何一个的尾缀（后缀）。
 *
 * 用途：防止 "角色甲" 仅因为 "角色甲父亲" 出现在文本中而被误匹配。
 */
function hasStandaloneOccurrence(text: string, baseName: string, longerNames: string[]): boolean {
  let idx = text.indexOf(baseName);
  while (idx !== -1) {
    const isPartOfLonger = longerNames.some((longer) => {
      const suffix = longer.slice(baseName.length);
      return suffix && text.startsWith(suffix, idx + baseName.length);
    });
    if (!isPartOfLonger) return true;
    idx = text.indexOf(baseName, idx + 1);
  }
  return false;
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
 *   1. 全名匹配：文本包含 "角色甲（10岁）"
 *   2. 基础名匹配：文本包含 "角色甲"（可匹配"角色甲（10岁）"的角色）
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

    // 防止把 "角色甲" 匹配成 "角色甲父亲"/"角色甲母亲" 这类复合名的子串：
    // 若此 baseName 在文本中的每处出现都紧接着另一个角色名的尾缀，则跳过。
    const longerBaseNames = [...grouped.keys()].filter(
      (k) => k !== baseName && k.startsWith(baseName)
    );
    if (longerBaseNames.length > 0 && !hasStandaloneOccurrence(text, baseName, longerBaseNames)) {
      continue;
    }

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
