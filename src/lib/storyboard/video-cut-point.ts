import path from "node:path";
import { saveArtifactAt, deleteArtifact, isSameArtifact } from "@/lib/storage/artifact-store";

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
  const framePath = await saveArtifactAt(
    path.join(params.uploadDir, "frames"),
    `${params.shotId}_seedance_lastframe_${Date.now()}.png`,
    buffer
  );

  // 旧尾帧同时被 anchorLastAi 引用时不能删，否则会删掉用户手动生成的 AI 尾帧
  const isSameAsAnchorLastAi = isSameArtifact(params.existingCutPoint, params.existingAnchorLastAi);

  if (params.existingCutPoint && params.existingCutPoint !== framePath && !isSameAsAnchorLastAi) {
    // 必须走 deleteArtifact：旧引用可能是 oss://，用 fs.unlinkSync 会静默失败
    // 并把对象永久遗留在 bucket 里（孤儿文件持续计费）
    await deleteArtifact(params.existingCutPoint);
  }

  return { cutPoint: framePath };
}
