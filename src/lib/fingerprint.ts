const STORAGE_KEY = "ai_comic_uid";

/**
 * Read the user ID from localStorage.
 * The cookie is set by middleware; FingerprintProvider syncs it to localStorage.
 */
export function getUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}
