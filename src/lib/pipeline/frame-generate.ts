import { db } from "@/lib/db";
import { shots, characters, projects } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/character-extract";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { eq, and, lt, desc } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";
import { resolveCharacterImages } from "@/lib/ai/character-router";

/**
 * 清理运镜字段里的 Markdown 粗体标记前缀。
 * v11 剧本中运镜内容形如 "** crane up — 描述"，
 * 这里把前导 ** 去掉，只保留干净的描述文本。
 */
function cleanCameraDirection(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/^\s*\*{1,2}\s*/, "").trim();
}

/**
 * 将 projects.visualStyle 映射为 Seedream 可直接使用的画风标签字符串。
 * 例如 "anime_2d" → "日本现代2D动漫风格，8K高清，纯色背景，赛璐珞渲染，清晰线稿——"
 */
function resolveVisualStyleTag(visualStyle: string | null | undefined): string {
  if (!visualStyle) return "";
  const preset = VISUAL_STYLE_PRESETS[visualStyle];
  return preset?.tag ?? "";
}

export async function handleFrameGenerate(task: Task) {
  const payload = task.payload as {
    shotId: string;
    projectId: string;
    userId?: string;
    modelConfig?: ModelConfigPayload;
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");

  // 读取项目画风设置（用于画风硬锁）
  const [project] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, payload.projectId));

  const visualStyleTag = resolveVisualStyleTag(project?.visualStyle);

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, payload.projectId));

  // 角色描述：name + visualHint（快速视觉标识） + description
  const characterDescriptions = projectCharacters
    .map((c) => {
      const hint = c.visualHint ? `【${c.visualHint}】` : "";
      return `${c.name}${hint}: ${c.description}`;
    })
    .join("\n");

  const [previousShot] = await db
    .select()
    .from(shots)
    .where(
      and(
        eq(shots.projectId, payload.projectId),
        lt(shots.sequence, shot.sequence)
      )
    )
    .orderBy(desc(shots.sequence))
    .limit(1);

  const ai = resolveImageProvider(payload.modelConfig);

  const userId = payload.userId ?? "";
  const projectId = payload.projectId;
  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  // Intelligently resolve character images based on the scene description
  const resolvedChars = await resolveCharacterImages(
    shot.prompt || "",
    projectCharacters,
    payload.modelConfig?.text,
    userId,
    projectId
  );
  const charRefImages = resolvedChars.map(c => c.imagePath);

  // 清理运镜字段的 ** 前缀
  const cameraDirection = cleanCameraDirection(shot.cameraDirection);

  // Prefer Seedance's true last frame over the AI-generated lastFrame for better continuity.
  // seedanceLastFrame is the actual final frame of the previous shot's video,
  // so it reflects the real visual state at the cut point rather than the AI-predicted end state.
  const previousLastFrame =
    previousShot?.seedanceLastFrame ||
    previousShot?.lastFrame ||
    undefined;

  // Generate first frame using startFrameDesc
  const firstFramePrompt = buildFirstFramePrompt({
    sceneDescription: shot.prompt || "",
    startFrameDesc: shot.startFrameDesc || shot.prompt || "",
    characterDescriptions,
    previousLastFrame,
    visualStyleTag,
    cameraDirection,
    slotContents: frameFirstSlots,
  });
  let firstFrameRemoteUrl: string | undefined;
  const firstFramePath = await ai.generateImage(firstFramePrompt, {
    quality: "hd",
    aspectRatio: "16:9",
    referenceImages: charRefImages,
    onRemoteUrl: (url) => { firstFrameRemoteUrl = url; },
  });

  // Generate last frame using endFrameDesc
  const lastFramePrompt = buildLastFramePrompt({
    sceneDescription: shot.prompt || "",
    endFrameDesc: shot.endFrameDesc || shot.prompt || "",
    characterDescriptions,
    firstFramePath,
    visualStyleTag,
    cameraDirection,
    slotContents: frameLastSlots,
  });
  let lastFrameRemoteUrl: string | undefined;
  const lastFramePath = await ai.generateImage(lastFramePrompt, {
    quality: "hd",
    aspectRatio: "16:9",
    referenceImages: [firstFramePath, ...charRefImages],
    onRemoteUrl: (url) => { lastFrameRemoteUrl = url; },
  });

  await db
    .update(shots)
    .set({
      firstFrame: firstFramePath,
      firstFrameRemoteUrl: firstFrameRemoteUrl ?? null,
      lastFrame: lastFramePath,
      lastFrameRemoteUrl: lastFrameRemoteUrl ?? null,
      status: "completed",
    })
    .where(eq(shots.id, payload.shotId));

  return { firstFrame: firstFramePath, lastFrame: lastFramePath };
}
