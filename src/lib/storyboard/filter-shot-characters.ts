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
  allCharacters: T[]
): T[] {
  if (allCharacters.length === 0) return [];
  if (!shotText) return [];
  const text = shotText.toLowerCase();
  return allCharacters.filter((c) => {
    if (!c.name) return false;
    const fullName = c.name.toLowerCase();
    const baseName = extractBaseName(c.name).toLowerCase();
    if (text.includes(fullName)) return true;
    if (baseName && text.includes(baseName)) return true;
    return false;
  });
}
