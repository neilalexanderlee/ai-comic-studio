export function normalizeCharacterName(name: string): string {
  return name
    .trim()
    .replace(/[：:]\s*$/, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
