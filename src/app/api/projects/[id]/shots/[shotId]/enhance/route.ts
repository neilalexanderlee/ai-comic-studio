/**
 * POST /api/projects/[id]/shots/[shotId]/enhance
 *
 * 按需画质增强接口：对已生成的视频（通常是 480p）执行火山引擎 AI MediaKit 画质增强，
 * 将视频升级至 720p，并更新 shot.videoUrl 和 shot.videoResolution。
 *
 * 这是一个同步接口（会等待增强完成后再返回），
 * 因为增强任务通常在 1-3 分钟内完成，由 maxDuration = 300 秒限制保护。
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, storyboardVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { VolcengineEnhanceProvider } from "@/lib/ai/providers/volcengine-enhance";
import { getProviderSecret } from "@/lib/provider-secrets";
import { saveVideoToHistory } from "@/lib/video/video-history";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import path from "path";

const AI_MEDIAKIT_PROVIDER_ID = "volcengine-ai-mediakit";

export const maxDuration = 300;

async function getVersionedUploadDir(versionId: string | null | undefined): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({ label: storyboardVersions.label, projectId: storyboardVersions.projectId })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(process.env.UPLOAD_DIR || "./uploads", "projects", version.projectId, version.label);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, shotId));

  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  if (shot.projectId !== projectId) {
    return NextResponse.json({ error: "Shot does not belong to project" }, { status: 403 });
  }
  if (!shot.videoUrl) {
    return NextResponse.json({ error: "Shot has no video to enhance" }, { status: 400 });
  }
  if (shot.videoResolution === "720p") {
    return NextResponse.json({ error: "Video is already at 720p" }, { status: 400 });
  }

  // Load AI MediaKit API Key from provider_secrets (user-specific)
  const userId = getUserIdFromRequest(req);
  let apiKey: string | undefined;

  if (userId) {
    const secret = await getProviderSecret(userId, AI_MEDIAKIT_PROVIDER_ID);
    if (secret?.apiKey) {
      apiKey = secret.apiKey;
    }
  }

  // Fall back to env var if no DB secret found
  if (!apiKey) {
    apiKey = process.env.VOLCENGINE_ENHANCE_API_KEY;
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "AI MediaKit API Key 未配置。请前往「设置 → AI 多媒体套件」填写 MediaKit API Key。" },
      { status: 400 }
    );
  }

  // Mark as enhancing (reuse generating status)
  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, shotId));

  try {
    const uploadDir = await getVersionedUploadDir(shot.versionId);
    const enhancer = new VolcengineEnhanceProvider({ uploadDir, apiKey });

    // 画质增强 API 要求公网可访问的 HTTPS URL。
    // Seedance 生成视频时会返回云端 URL（remoteVideoUrl），有效期约 24 小时。
    // 本地文件路径无法被外网访问，因此只能使用 remoteVideoUrl。
    // 若链接已过期，用户需要重新生成视频以获取新的云端链接。
    if (!shot.remoteVideoUrl) {
      await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));
      return NextResponse.json(
        { error: "该视频没有云端链接，请重新生成视频后再进行画质增强。" },
        { status: 400 }
      );
    }
    if (shot.remoteVideoExpiresAt && shot.remoteVideoExpiresAt <= new Date()) {
      await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));
      return NextResponse.json(
        { error: "云端视频链接已过期（有效期 24 小时），请重新生成视频后再进行画质增强。" },
        { status: 400 }
      );
    }

    console.log(`[EnhanceRoute] Using remoteVideoUrl for enhance: ${shot.remoteVideoUrl}`);
    const enhancedPath = await enhancer.enhanceVideo(shot.remoteVideoUrl);

    // 把 480p 旧视频存入历史（超出 5 条时自动删除最旧文件）
    await saveVideoToHistory(shotId, shot.videoUrl, shot.videoResolution, "增强↑720p 前");

    await db
      .update(shots)
      .set({
        videoUrl: enhancedPath,
        videoResolution: "720p",
        status: "completed",
      })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ videoUrl: enhancedPath, videoResolution: "720p" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EnhanceRoute] Enhancement failed for shot ${shotId}: ${msg}`);
    // Restore completed status (keep original 480p video)
    await db
      .update(shots)
      .set({ status: "completed" })
      .where(eq(shots.id, shotId));
    return NextResponse.json({ error: `Enhancement failed: ${msg}` }, { status: 500 });
  }
}
