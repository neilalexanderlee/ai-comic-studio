/**
 * Convert a local file path (e.g., "./uploads/frames/abc.png") to an API URL
 * for serving via /api/uploads/[...path].
 */
export function uploadUrl(filePath: string): string {
  // Normalize backslashes to forward slashes (Windows compatibility)
  const normalized = filePath.replace(/\\/g, "/");
  // Strip any prefix ending with "uploads/" (handles ./uploads/, /app/uploads/, etc.)
  return `/api/uploads/${normalized.replace(/^.*uploads\//, "")}`;
}
