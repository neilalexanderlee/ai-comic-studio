import "server-only";
import path from "node:path";
import { or, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { saveArtifactAt, deleteArtifact, isSameArtifact } from "@/lib/storage/artifact-store";

/**
 * 下载 Seedance return_last_frame → 写入本镜 cut_point（不覆盖 anchor_last_ai）。
 *
 * ## 删除旧尾帧前必须确认没有别人在用它
 *
 * 1. 本镜的 anchorLastAi —— 旧版「首帧参考图模式」曾把两者写成同一路径。
 * 2. **别的分镜的 anchorFirst** —— 「承接上一镜尾帧」是路径直拷。
 *
 * 第 2 条是真实事故（2026-09-02 审计发现）：某分镜 anchorFirst 指向上一镜早已被删的
 * 旧尾帧，界面表现为「缩略图裂开」，而缺失原因完全查不出来。
 * 宁可留个孤儿文件占点空间，也不能删出死链。
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

  const old = params.existingCutPoint;
  if (old && old !== framePath) {
    // ① 本镜的 anchorLastAi 指着它（旧版曾把两者写成同一路径）
    const usedByAnchorLastAi = isSameArtifact(old, params.existingAnchorLastAi);

    // ② 任何分镜的 anchorFirst / anchorLastAi 指着它 —— 「承接上一镜尾帧」是**路径直拷**
    //    （anchorFirstContinuityMode = "strict_start"），下一镜的首帧就是本镜 cutPoint
    //    这个文件本身。不查这一条，本镜视频一重新生成，下一镜首帧当场变死链。
    const referencing = await db
      .select({ id: shots.id })
      .from(shots)
      .where(or(eq(shots.anchorFirst, old), eq(shots.anchorLastAi, old)))
      .limit(1);

    if (!usedByAnchorLastAi && referencing.length === 0) {
      // 必须走 deleteArtifact：旧引用可能是 oss://，用 fs.unlinkSync 会静默失败
      // 并把对象永久遗留在 bucket 里（孤儿文件持续计费）
      await deleteArtifact(old);
    }
  }

  return { cutPoint: framePath };
}
