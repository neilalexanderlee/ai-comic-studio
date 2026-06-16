import fs from "node:fs";
import path from "node:path";

/**
 * 下载 Seedance return_last_frame → 写入本镜 cut_point（不覆盖 anchor_last_ai）。
 *
 * ⚠️ 历史 bug 修复：旧版「首帧参考图模式」曾将 anchorLastAi 和 cutPoint 写成同一路径。
 * 若二者相同，不得删除旧 cutPoint，否则会连带删掉 anchorLastAi 的物理文件。
 */
export async function buildVideoCutPointUpdate(params: {
  remoteLastFrameUrl: string;
  shotId: string;
  uploadDir: string;
  existingCutPoint?: string | null;
  /** 当前 shot 的 anchorLastAi 路径 — 用于防止误删共用文件 */
  existingAnchorLastAi?: string | null;
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

  const isSameAsAnchorLastAi =
    params.existingAnchorLastAi &&
    path.resolve(params.existingCutPoint ?? "") === path.resolve(params.existingAnchorLastAi);

  if (params.existingCutPoint && params.existingCutPoint !== framePath && !isSameAsAnchorLastAi) {
    try {
      fs.unlinkSync(params.existingCutPoint);
    } catch {
      /* ignore */
    }
  }

  return { cutPoint: framePath };
}
