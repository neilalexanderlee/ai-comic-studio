import path from "path";
import fs from "fs";
import { db } from "@/lib/db";
import { shots, characters, storyboardVersions, projects } from "@/lib/db/schema";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/character-extract";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { downloadVideoWithRetry } from "@/lib/ai/providers/download-with-retry";
import { getRemoteVideoExpiry, isRemoteVideoReusable } from "@/lib/video/remote-video";
import { eq, asc } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";
import { dialogues } from "@/lib/db/schema";

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
     * 生成分辨率：
     *   "480p" - 低成本生成，后续可通过「画质增强」按需升至 720p
     *   "720p" - 直接生成 720p（成本较高）
     *   undefined - 使用模型默认分辨率
     */
    resolution?: "480p" | "720p";
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");
  if (!shot.anchorFirst || !shot.anchorLastAi) {
    throw new Error("Shot frames not generated yet");
  }

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  // 读取项目画风，注入视频 prompt（锁定动画风格，防止视频生成漂移）
  const [project] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, shot.projectId));
  const visualStyleTag = (() => {
    const style = project?.visualStyle;
    if (!style) return "";
    return VISUAL_STYLE_PRESETS[style]?.tag ?? "";
  })();

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

  if (!shot.videoUrl && isRemoteVideoReusable({
    url: shot.remoteVideoUrl,
    status: shot.remoteVideoStatus,
    expiresAt: shot.remoteVideoExpiresAt,
  })) {
    try {
      const resumedVideoPath = await downloadVideoWithRetry(shot.remoteVideoUrl!, versionedUploadDir, {
        logPrefix: "PipelineRemoteVideoDownload",
      });
      await db
        .update(shots)
        .set({
          videoUrl: resumedVideoPath,
          status: "completed",
          remoteVideoStatus: "downloaded",
          remoteVideoLastDownloadAt: new Date(),
        })
        .where(eq(shots.id, payload.shotId));
      return { videoPath: resumedVideoPath, resumedFromRemoteUrl: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[PipelineRemoteVideoDownload] Re-download failed, generating a new video instead: ${message}`);
      await db
        .update(shots)
        .set({ remoteVideoStatus: "download_failed", remoteVideoLastDownloadAt: new Date() })
        .where(eq(shots.id, payload.shotId));
    }
  }

  // Fetch dialogues for this shot to include in video prompt (lip sync / voiceover cues)
  const shotDialogues = await db
    .select({
      text: dialogues.text,
      characterName: characters.name,
      visualHint: characters.visualHint,
      charVoiceHint: characters.voiceHint,   // character-level voice (auto-generated at extraction)
      dialogueVoiceHint: dialogues.voiceHint, // per-line override (manual, optional)
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .innerJoin(characters, eq(dialogues.characterId, characters.id))
    .where(eq(dialogues.shotId, payload.shotId))
    .orderBy(asc(dialogues.sequence));

  const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";

  // 清理运镜字段 ** 前缀（与 frame-generate 保持一致）
  const cleanCamera = (shot.cameraDirection || "static").replace(/^\s*\*{1,2}\s*/, "").trim();

  // 如有项目画风标签，前置注入到视频脚本中作为风格锁
  const styledVideoScript = visualStyleTag
    ? `【画风】${visualStyleTag}\n\n${videoScript}`
    : videoScript;

  // 仅传入当前 shot 中被提及的角色，避免群演场景注入无关角色的外貌描述
  // 与 generate/route.ts 中 filterShotCharacters 的用法保持一致：无匹配时传空列表
  const shotText = [shot.videoScript, shot.motionScript, shot.prompt, shot.startFrameDesc, shot.endFrameDesc]
    .filter(Boolean)
    .join(" ");
  const shotCharacters = filterShotCharacters(shotText, projectCharacters);

  const prompt = buildVideoPrompt({
    videoScript: styledVideoScript,
    cameraDirection: cleanCamera,
    startFrameDesc: shot.startFrameDesc ?? undefined,
    endFrameDesc: shot.endFrameDesc ?? undefined,
    duration: effectiveDuration,
    // 只传入本镜头提及的角色（无匹配时为空列表，群演场景不注入无关角色）
    characters: shotCharacters.map((c) => ({
      name: c.name,
      visualHint: c.visualHint,
      description: c.description,
    })),
    slotContents: videoSlots,
    dialogues: shotDialogues.length > 0
      ? shotDialogues.map((d) => ({
          characterName: d.characterName,
          text: d.text,
          visualHint: d.visualHint ?? undefined,
          // Per-line voiceHint takes priority; falls back to character-level voiceHint
          voiceHint: (d.dialogueVoiceHint || d.charVoiceHint) ?? undefined,
        }))
      : undefined,
  });

  const result = await videoProvider.generateVideo({
    anchorFirst: shot.anchorFirst,
    anchorLastAi: shot.anchorLastAi,
    anchorFirstRemoteUrl: shot.anchorFirstRemoteUrl ?? undefined,
    anchorLastAiRemoteUrl: shot.anchorLastAiRemoteUrl ?? undefined,
    prompt,
    duration: effectiveDuration,
    ratio: payload.ratio ?? "16:9",
    ...(payload.resolution && { resolution: payload.resolution }),
    onRemoteResult: async ({ videoUrl, taskId }) => {
      await db
        .update(shots)
        .set({
          remoteVideoUrl: videoUrl,
          remoteVideoTaskId: taskId ?? null,
          remoteVideoStatus: "available",
          remoteVideoCreatedAt: new Date(),
          remoteVideoExpiresAt: getRemoteVideoExpiry(),
        })
        .where(eq(shots.id, payload.shotId));
    },
  });

  // Download Seedance's true last frame (the actual last frame of the generated video).
  // This provides higher-quality continuity anchoring for the NEXT shot's frame generation
  // compared to the AI-generated `anchorLastAi` image used as input.
  let cutPointPath: string | null = null;
  if (result.lastFrameUrl) {
    try {
      const frameRes = await fetch(result.lastFrameUrl);
      if (frameRes.ok) {
        const buffer = Buffer.from(await frameRes.arrayBuffer());
        const frameFilename = `${shot.id}_seedance_lastframe.png`;
        const framesDir = path.join(versionedUploadDir, "frames");
        fs.mkdirSync(framesDir, { recursive: true });
        const framePath = path.join(framesDir, frameFilename);
        fs.writeFileSync(framePath, buffer);
        cutPointPath = framePath;
        console.log(`[VideoGenerate] Saved Seedance last frame: ${framePath}`);
      }
    } catch (err) {
      // Non-fatal: log and continue — video itself was saved successfully
      console.warn(`[VideoGenerate] Failed to download Seedance last frame:`, err);
    }
  }

  await db
    .update(shots)
    .set({
      videoUrl: result.filePath,
      status: "completed",
      videoResolution: payload.resolution ?? null,
      ...(cutPointPath && { cutPoint: cutPointPath }),
    })
    .where(eq(shots.id, payload.shotId));

  return { videoPath: result.filePath, cutPoint: cutPointPath ?? undefined };
}
