import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

export async function downloadVideoWithRetry(
  videoUrl: string,
  uploadDir: string,
  options?: { attempts?: number; delayMs?: number; logPrefix?: string }
): Promise<string> {
  const attempts = options?.attempts ?? 3;
  const delayMs = options?.delayMs ?? 2_000;
  const logPrefix = options?.logPrefix ?? "VideoDownload";
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(`download failed: ${response.status} ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error("download failed: empty response body");
      }

      const filename = `${ulid()}.mp4`;
      const dir = path.join(uploadDir, "videos");
      fs.mkdirSync(dir, { recursive: true });
      const filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, buffer);
      return filepath;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${logPrefix}] Attempt ${attempt}/${attempts} failed: ${message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${logPrefix}: failed to download video after ${attempts} attempts: ${message}`);
}
