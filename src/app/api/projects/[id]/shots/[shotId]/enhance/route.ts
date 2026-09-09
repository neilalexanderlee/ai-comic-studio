/**
 * POST /api/projects/[id]/shots/[shotId]/enhance
 *
 * 按需画质增强接口：对已生成的视频（通常是 480p）执行火山引擎 AI MediaKit 画质增强，
 * 升级到指定分辨率，并更新 shot.videoUrl 和 shot.videoResolution。
 *
 * Body: { resolution?: "720p" | "1080p" | "4k" }（默认 1080p）
 *
 * ⚠️ 这里曾经有一个记账错误：路由调 `enhanceVideo()` 时**没传 resolution**，
 * 于是走 provider 的默认值 —— 实际产出的一直是 **1080p**，
 * 而 DB、界面文案、历史标签、额度折算全都按 720p 记。
 * 结果是用户以为拿到 720p、实际拿到 1080p，而额度只按 2.25 倍扣（真实成本 5.06 倍）。
 * 现在目标分辨率是显式参数，三处（落库/额度/文案）都跟着它走。
 *
 * 这是一个同步接口（会等待增强完成后再返回），
 * 因为增强任务通常在 1-3 分钟内完成，由 maxDuration = 300 秒限制保护。
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, storyboardVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { VolcengineEnhanceProvider } from "@/lib/ai/providers/volcengine-enhance";
import { resolveProviderCredentials, type KeySource } from "@/lib/provider-secrets";
import { saveVideoToHistory } from "@/lib/video/video-history";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";
import { resolutionRank } from "@/lib/billing/pricing";
import {
  checkPlatformUsage,
  platformUsageResponse,
  recordPlatformUsage,
} from "@/lib/billing/platform-usage";
import path from "path";

const AI_MEDIAKIT_PROVIDER_ID = "volcengine-ai-mediakit";

/** provider 支持的目标档位（见 volcengine-enhance.ts） */
const ENHANCE_TARGETS = ["720p", "1080p", "4k"] as const;
type EnhanceTarget = (typeof ENHANCE_TARGETS)[number];

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
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;

  // ⚠️ 原来这条路由**完全没有归属校验** —— 只调了 getUserIdFromRequest 拿去查密钥，
  // 于是知道 projectId + shotId 就能对别人的分镜跑一次增强（花的是 Key 的钱）。
  // 而按标志词扫描的守卫测试照样是绿的：它调了鉴权函数、返回值也用了，只是没用来鉴权。
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const userId = guard.userId;

  const shotGuard = await requireShotInProject(shotId, projectId);
  if (!shotGuard.ok) return shotGuard.response;

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, shotId));

  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  if (!shot.videoUrl) {
    return NextResponse.json({ error: "Shot has no video to enhance" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { resolution?: string };
  const target: EnhanceTarget = ENHANCE_TARGETS.includes(body.resolution as EnhanceTarget)
    ? (body.resolution as EnhanceTarget)
    : "1080p";

  // 只能往上升。原来是写死的「已经是 720p 就拒绝」，那样 720p 的片子
  // 再也升不到 1080p —— 而 provider 本来就支持。
  if (resolutionRank(shot.videoResolution) >= resolutionRank(target)) {
    return NextResponse.json(
      { error: `该视频已经是 ${shot.videoResolution}，不需要升到 ${target}` },
      { status: 400 }
    );
  }

  // 密钥：用户自己的 → 管理员的平台 Key → 环境变量（见下）。
  //
  // 平台兜底不能少：托管模式下非管理员的设置页**不显示** MediaKit 配置区，
  // 只查用户自己的密钥必然查不到，而报错还写着「请前往设置填写」——
  // 指向一个根本不存在的入口，是最难自查的一类失败。
  const creds = await resolveProviderCredentials(userId, AI_MEDIAKIT_PROVIDER_ID);
  let apiKey: string | undefined = creds.ok ? creds.apiKey : undefined;
  let keySource: KeySource = creds.ok ? creds.keySource : "user";

  // 环境变量兜底**记为 user**：它是部署者自己配的 Key，自部署场景下不该被平台限额约束
  // （与「限额只作用于确实用了平台 Key 的请求」一致）。托管部署要让限额生效，
  // 就把 Key 配在管理员的设置页里 —— 那才是平台 Key 的标准路径。
  if (!apiKey) {
    apiKey = process.env.VOLCENGINE_ENHANCE_API_KEY;
    keySource = "user";
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "AI MediaKit API Key 未配置。请前往「设置 → AI 多媒体套件」填写 MediaKit API Key。" },
      { status: 400 }
    );
  }

  // 画质增强按视频时长向上游计费，用的还是同一把 Key —— 所以计入同一份额度。
  // 额度的语义是「这个人每天最多花多少钱」，不是「最多生成多少条」。
  const enhanceSeconds = Math.max(1, Math.ceil(shot.duration ?? 5));
  const usage = await checkPlatformUsage(userId, {
    kind: "video",
    keySource,
    durationSeconds: enhanceSeconds,
    resolution: target, // 额度按**真实产物**折算：1080p 是 5.06 倍，不是 2.25 倍
    protocol: "volcengine-enhance",
  });
  if (usage) return platformUsageResponse(usage);
  await recordPlatformUsage(userId, {
    kind: "video",
    keySource,
    durationSeconds: enhanceSeconds,
    resolution: target,
    protocol: "volcengine-enhance",
    modelId: "ai-mediakit-enhance",
    projectId,
    shotId,
  });

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
    const enhancedPath = await enhancer.enhanceVideo(shot.remoteVideoUrl, {
      resolution: target,
    });

    // 把 480p 旧视频存入历史（超出 5 条时自动删除最旧文件）
    await saveVideoToHistory(shotId, shot.videoUrl, shot.videoResolution, `增强↑${target} 前`);

    await db
      .update(shots)
      .set({
        videoUrl: enhancedPath,
        videoResolution: target,
        status: "completed",
      })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ videoUrl: enhancedPath, videoResolution: target });
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
