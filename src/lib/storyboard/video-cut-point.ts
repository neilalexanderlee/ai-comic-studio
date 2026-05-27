import fs from "node:fs";
import path from "node:path";

/**
 * 下载 Seedance return_last_frame → 写入本镜 cut_point（不覆盖 anchor_last_ai）。
 */
export async function buildVideoCutPointUpdate(params: {
  remoteLastFrameUrl: string;
  shotId: string;
  uploadDir: string;
  existingCutPoint?: string | null;
}): Promise<Record<string, string>> {
  const frameRes = await fetch(params.remoteLastFrameUrl);
  if (!frameRes.ok) return {};

  const buffer = Buffer.from(await frameRes.arrayBuffer());
  const framesDir = path.join(params.uploadDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });
  const framePath = path.join(
    framesDir,
    `${params.shotId}_seedance_lastframe_${Date.now()}.png`
  );
  fs.writeFileSync(framePath, buffer);

  if (params.existingCutPoint && params.existingCutPoint !== framePath) {
    try {
      fs.unlinkSync(params.existingCutPoint);
    } catch {
      /* ignore */
    }
  }

  return { cutPoint: framePath };
}
