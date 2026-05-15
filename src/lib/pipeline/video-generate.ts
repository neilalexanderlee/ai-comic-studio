import path from "path";
import { db } from "@/lib/db";
import { shots, characters, storyboardVersions } from "@/lib/db/schema";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
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

  // Fetch dialogues for this shot to include in video prompt (lip sync / voiceover cues)
  const shotDialogues = await db
    .select({
      text: dialogues.text,
      characterName: characters.name,
      visualHint: characters.visualHint,
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .innerJoin(characters, eq(dialogues.characterId, characters.id))
    .where(eq(dialogues.shotId, payload.shotId))
    .orderBy(asc(dialogues.sequence));

  const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
  const prompt = buildVideoPrompt({
    videoScript,
    cameraDirection: shot.cameraDirection || "static",
    startFrameDesc: shot.startFrameDesc ?? undefined,
    endFrameDesc: shot.endFrameDesc ?? undefined,
    duration: effectiveDuration,
    characters: projectCharacters,
    slotContents: videoSlots,
    dialogues: shotDialogues.length > 0
      ? shotDialogues.map((d) => ({
          characterName: d.characterName,
          text: d.text,
          visualHint: d.visualHint ?? undefined,
        }))
      : undefined,
  });

  const result = await videoProvider.generateVideo({
    firstFrame: shot.firstFrame,
    lastFrame: shot.lastFrame,
    prompt,
    duration: effectiveDuration,
    ratio: payload.ratio ?? "16:9",
    ...(payload.resolution && { resolution: payload.resolution }),
  });

  await db
    .update(shots)
    .set({
      videoUrl: result.filePath,
      status: "completed",
      videoResolution: payload.resolution ?? null,
    })
    .where(eq(shots.id, payload.shotId));

  return { videoPath: result.filePath };
}
