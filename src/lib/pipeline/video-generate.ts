import path from "path";
import { db } from "@/lib/db";
import { shots, characters, storyboardVersions } from "@/lib/db/schema";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { VolcengineEnhanceProvider } from "@/lib/ai/providers/volcengine-enhance";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

async function getVersionedUploadDirFromPipeline(versionId: string | null | undefined): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({ label: storyboardVersions.label, projectId: storyboardVersions.projectId })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(process.env.UPLOAD_DIR || "./uploads", "projects", version.projectId, version.label);
}

export async function handleVideoGenerate(task: Task) {
  const payload = task.payload as {
    shotId: string;
    projectId?: string;
    userId?: string;
    ratio?: string;
    modelConfig?: ModelConfigPayload;
    /**
     * 是否使用画质增强工作流：
     * 先以 480p 生成（成本更低），再通过火山 AI MediaKit 画质增强升至 720p。
     * 需配置 VOLCENGINE_ENHANCE_ACCESS_KEY / VOLCENGINE_ENHANCE_SECRET_KEY 环境变量。
     * 参考：https://www.volcengine.com/docs/6448/2279961
     */
    useEnhance?: boolean;
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");
  if (!shot.firstFrame || !shot.lastFrame) {
    throw new Error("Shot frames not generated yet");
  }

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  const versionedUploadDir = await getVersionedUploadDirFromPipeline(shot.versionId);
  const videoProvider = resolveVideoProvider(payload.modelConfig, versionedUploadDir);

  const videoModelId = payload.modelConfig?.video?.modelId;
  const modelMaxDuration = getModelMaxDuration(videoModelId);
  const effectiveDuration = Math.min(shot.duration ?? 10, modelMaxDuration);

  const userId = payload.userId ?? "";
  const projectId = payload.projectId ?? shot.projectId;
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
  const prompt = buildVideoPrompt({
    videoScript,
    cameraDirection: shot.cameraDirection || "static",
    startFrameDesc: shot.startFrameDesc ?? undefined,
    endFrameDesc: shot.endFrameDesc ?? undefined,
    duration: effectiveDuration,
    characters: projectCharacters,
    slotContents: videoSlots,
  });

  // 画质增强工作流：先以 480p 生成再增强至 720p（降低成本）
  // 普通工作流：直接以目标分辨率生成
  const useEnhance =
    payload.useEnhance === true ||
    process.env.VOLCENGINE_ENHANCE_ENABLED === "true";

  const generationResolution = useEnhance ? "480p" : undefined;

  const result = await videoProvider.generateVideo({
    firstFrame: shot.firstFrame,
    lastFrame: shot.lastFrame,
    prompt,
    duration: effectiveDuration,
    ratio: payload.ratio ?? "16:9",
    ...(generationResolution && { resolution: generationResolution }),
  });

  let finalVideoPath = result.filePath;

  // 画质增强后处理
  if (useEnhance) {
    try {
      console.log(
        `[VideoGenerate] Starting quality enhancement for shot ${payload.shotId}`
      );
      const enhancer = new VolcengineEnhanceProvider({
        uploadDir: versionedUploadDir,
      });
      finalVideoPath = await enhancer.enhanceVideo(result.filePath);
      console.log(
        `[VideoGenerate] Enhancement complete: ${finalVideoPath}`
      );
    } catch (enhanceErr: unknown) {
      const msg =
        enhanceErr instanceof Error ? enhanceErr.message : String(enhanceErr);
      // 增强失败时降级为原始 480p 视频，不阻塞整体流程
      console.error(
        `[VideoGenerate] Enhancement failed, falling back to 480p: ${msg}`
      );
      finalVideoPath = result.filePath;
    }
  }

  await db
    .update(shots)
    .set({ videoUrl: finalVideoPath, status: "completed" })
    .where(eq(shots.id, payload.shotId));

  return { videoPath: finalVideoPath };
}
