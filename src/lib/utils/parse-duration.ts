/**
 * Parses a human-readable duration string and returns total seconds.
 * Supports common Chinese and English formats found in episode descriptions/ideas:
 *   "4分30秒", "4分钟30秒", "4分", "30秒", "4:30", "4min30s", "270s", "5分钟"
 * Returns null if no recognisable pattern is found.
 */
export function parseTargetDurationSeconds(text: string): number | null {
  if (!text) return null;

  // Chinese: "4分30秒" / "4分钟" / "30秒" etc.
  const cnFull = text.match(/(\d+)\s*分(?:钟)?\s*(\d+)\s*秒/);
  if (cnFull) return parseInt(cnFull[1]) * 60 + parseInt(cnFull[2]);

  const cnMin = text.match(/(\d+)\s*分(?:钟)?(?!\s*\d)/);
  if (cnMin) return parseInt(cnMin[1]) * 60;

  const cnSec = text.match(/(\d+)\s*秒/);
  if (cnSec) {
    // Only use bare-seconds pattern if no minutes were found
    const minutes = parseInt(cnSec[1]);
    if (minutes > 0 && minutes < 3600) return minutes;
  }

  // Colon format: "4:30"
  const colonFmt = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colonFmt) return parseInt(colonFmt[1]) * 60 + parseInt(colonFmt[2]);

  // English: "4min30s" / "4m30s"
  const enFull = text.match(/(\d+)\s*m(?:in)?\s*(\d+)\s*s(?:ec)?/i);
  if (enFull) return parseInt(enFull[1]) * 60 + parseInt(enFull[2]);

  const enMin = text.match(/(\d+)\s*m(?:in(?:utes?)?)?\b/i);
  if (enMin) {
    const v = parseInt(enMin[1]);
    if (v > 0 && v <= 120) return v * 60; // sanity cap: no episode > 2h
  }

  return null;
}
