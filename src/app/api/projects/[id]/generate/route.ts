import { NextResponse } from "next/server";
import { streamText, generateText, tool, stepCountIs } from "ai";
import { jsonSchema } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes, characters, shots, dialogues, storyboardVersions, episodeCharacters, characterAssets, trackVideos } from "@/lib/db/schema";
import { eq, asc, and, lt, gt, desc, inArray, isNull, sql } from "drizzle-orm";
import { groupShotsIntoTracks, buildShotTrackMap } from "@/lib/storyboard/track-grouping";
import { buildSeedanceMultiParamVideoPrompt, type SeedanceAsset, type SeedanceShot } from "@/lib/ai/prompts/seedance-multi-param";
import { superviseShots } from "@/lib/storyboard/shot-supervision";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import fs from "node:fs";
import path from "path";
import { ulid } from "ulid";
import { enqueueTask } from "@/lib/task-queue";
import type { TaskType } from "@/lib/task-queue";
import { buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { buildScriptGeneratePrompt } from "@/lib/ai/prompts/script-generate";
import { buildCharacterExtractPrompt, buildCharacterNameExtractionPrompt, CHARACTER_NAME_EXTRACTION_SYSTEM, resolveCharacterExtractSystemPrompt } from "@/lib/ai/prompts/character-extract";
import { STORYBOARD_REWRITE_SYSTEM, buildRewriteUserPrompt } from "@/lib/ai/prompts/storyboard-supervision";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/visual-style-presets";
import { getArtStylePrompt } from "@/lib/ai/prompts/art-styles/index";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getPromptDefinition, SPLIT_SHOT_SINGLE_SYSTEM } from "@/lib/ai/prompts/registry";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { resolveImageProvider, resolveVideoProvider, resolveAIProvider } from "@/lib/ai/provider-factory";
import { buildVideoPrompt, buildReferenceVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { buildCharacterTurnaroundPrompt, buildBeautyImagePrompt, buildCombatImagePrompt } from "@/lib/ai/prompts/character-image";
import { resolveCharacterImages } from "@/lib/ai/character-router";
import { assembleVideo } from "@/lib/video/ffmpeg";
import { saveVideoToHistory } from "@/lib/video/video-history";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";
import { extractShotsFromScript } from "@/lib/storyboard/extract-shot-script";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";
import {
  getShotCharacters,
  persistStoryboardVersion,
} from "@/lib/storyboard/persist-storyboard-version";
import { finalizeExtractedShotsForDb } from "@/lib/storyboard/complete-extracted-shots";
import { downloadVideoWithRetry } from "@/lib/ai/providers/download-with-retry";
import { getRemoteVideoExpiry, isRemoteVideoReusable } from "@/lib/video/remote-video";
import { enhanceImagePrompt, enhanceVideoPrompt } from "@/lib/ai/prompt-enhancer";
import {
  frameReferenceContinuityLabel,
  resolveFrameReferenceForProject,
  shotFrameFileOnDisk,
} from "@/lib/storyboard/frame-reference.server";
import type { FrameReferencePayload, FrameReferenceType } from "@/lib/storyboard/frame-reference";
import { linkNextShotAnchorFromCutPoint } from "@/lib/storyboard/shot-frame-link";
import type { ShotAutoLinkResult } from "@/lib/storyboard/shot-auto-link-messages";
import {
  collectVisionFramePaths,
  shouldUseFirstFrameVideoMode,
} from "@/lib/storyboard/shot-video-readiness.server";
import {
  pickFirstFramePromptBuildParams,
  pickLastFramePromptBuildParams,
} from "@/lib/storyboard/frame-prompt-context";
import {
  generateAndPersistDirectVideoPrompt,
  syncVideoPromptIfStale,
} from "@/lib/storyboard/shot-video-prompt-sync.server";
import { resolveDeprecatedGenerateAction } from "@/lib/storyboard/generate-route-deprecations";
import { buildVideoCutPointUpdate } from "@/lib/storyboard/video-cut-point";
import { resolveVideoMotionAndScene } from "@/lib/ai/prompts/ref-video-prompt-generate";

export const maxDuration = 300;

async function maybeAutoLinkNextShotAfterVideo(
  projectId: string,
  sourceShot: typeof shots.$inferSelect,
  characters: { id: string; name: string; description?: string | null; visualHint?: string | null }[],
  characterContextText: string
): Promise<ShotAutoLinkResult> {
  const [proj] = await db
    .select({ linkShotsViaCutPoint: projects.linkShotsViaCutPoint })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!proj?.linkShotsViaCutPoint) return { status: "disabled" };

  const link = await linkNextShotAnchorFromCutPoint({
    sourceShot,
    characters,
    characterContextText,
  });
  if (link.linked && link.nextShotId) {
    return {
      status: "linked",
      nextShotId: link.nextShotId,
      nextSequence: link.nextSequence,
    };
  }
  return { status: "skipped", reason: link.reason ?? "unknown" };
}

/** Map user-facing ratio string to ImageOptions fields */
function ratioToImageOpts(ratio?: string): { aspectRatio?: string; size?: string } {
  switch (ratio) {
    case "16:9":  return { aspectRatio: "16:9", size: "2560x1440" };
    case "9:16":  return { aspectRatio: "9:16", size: "1440x2560" };
    case "1:1":   return { aspectRatio: "1:1",  size: "2048x2048" };
    default:      return { aspectRatio: "16:9", size: "2560x1440" };
  }
}

/** Fetch characters linked to an episode via episode_characters, or all project characters if no episode. */
async function getEpisodeCharacters(projectId: string, epId?: string | null) {
  return getShotCharacters(projectId, epId);
}

// filterShotCharacters imported from @/lib/storyboard/filter-shot-characters (shared with pipeline/video-generate)

/**
 * Check if a character is visible on-screen by looking for their name
 * in the resolved motion text or startFrameDesc fields.
 *
 * Matching strategy (tolerant of age/descriptor suffixes):
 *   1. Full name match — "角色甲（10岁）" in text
 *   2. Base name match — strip （…） suffix → "角色甲" in text
 *   3. Fallback: assume on-screen if the text is non-empty (better than
 *      wrongly marking a named character as off-screen)
 */
function isCharacterOnScreen(
  characterName: string,
  motionText: string,
  startFrameDesc: string | null | undefined
): boolean {
  if (!characterName) return false;
  const text = `${motionText} ${startFrameDesc ?? ""}`;
  if (!text.trim()) return false;
  if (text.includes(characterName)) return true;
  // Strip trailing parenthetical descriptor, e.g. "角色甲（10岁）" → "角色甲"
  const baseName = characterName.replace(/[（(].*/, "").trim();
  if (baseName.length >= 2 && text.includes(baseName)) return true;
  return false;
}

/**
 * 从文本中精确剔除背景音乐内容。
 *
 * 两级策略：
 *
 * 1. 精确剔除（优先）：若提供了 bgmNote（来自 DB，parser 从 【背景音】 标签提取并存储），
 *    直接按内容匹配删除，完全不依赖关键词推测。适用于解析分镜/从剧本还原后的新数据。
 *
 * 2. 正则兜底（仅老数据）：bgmNote 为空时（历史数据未存储此字段），用最小化正则覆盖
 *    最常见的音乐词汇，避免 BGM 描述进入视频模型。
 *
 * 注意：此函数同时用于 motionScript（tag 内容直接文本）和 videoPrompt（LLM 生成文本），
 * 两者特征不同；精确模式对 motionScript 更有效，正则对 videoPrompt 也有一定覆盖。
 */
function stripBgmContent(text: string, bgmNote?: string | null): string {
  if (!text) return text;

  // ── 精确剔除：用 bgmNote 内容精确匹配 ──────────────────────────────────
  if (bgmNote) {
    const escaped = bgmNote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const cleaned = text.replace(new RegExp(escaped, "g"), "").replace(/^[，。；\s]+/, "").trim();
    // 如果精确匹配后还有剩余文本，返回剩余；若清空了（motionScript 仅含 BGM），返回空串
    if (cleaned !== text) return cleaned;
  }

  // ── 正则兜底：老数据 / LLM 生成的 videoPrompt ──────────────────────────
  // Step 1：剥离整块 【背景音】 段落（极少数情况下 tag 残留在文本里）
  let result = text.replace(/【背景音[^】]*】[^\n【]*/gi, "").trim();
  // Step 2：子句级过滤，仅保留最明确的音乐词汇（不误杀合法音效描述）
  const clauses = result.split(/([，。；\n])/);
  const bgmPatterns = [
    /配乐/,            // 民乐配乐、配乐响起等各种形式
    /背景音乐/,
    /BGM/i,
    /弦乐(?!声)/,      // 弦乐（保留"弦乐声"这种 SFX 写法）
    /木管/,            // 木管乐器
    /管弦乐/,
    /管风琴/,
    /主题(?:曲|旋律)/, // 主题曲/主题旋律
    /插曲响起/,
    /音乐(?:渐强|渐弱|响起|收束)/,
    /(?:友情|爱情|悲伤|温暖|欢快|激昂|宁静)\S*主题/,
  ];
  const filtered = clauses.map((clause) =>
    bgmPatterns.some((re) => re.test(clause)) ? "" : clause
  );
  return filtered.join("").replace(/^[，。；\s]+/, "").trim();
}

// 向后兼容别名：旧调用点逐步迁移到带 bgmNote 参数的版本
const stripBgmFromScript = (text: string) => stripBgmContent(text);

function buildShotCharacterText(shot: {
  prompt?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
}): string {
  return [
    shot.prompt,
    shot.startFrameDesc,
    shot.endFrameDesc,
    shot.motionScript,
  ].filter(Boolean).join(" ");
}


/** Strip <think>...</think> reasoning blocks from LLM output (DeepSeek R1 / QwQ etc.) */
function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*/g, "") // truncated block with no closing tag
    .trim();
}

async function getVersionedUploadDir(versionId: string | null | undefined): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({ label: storyboardVersions.label, projectId: storyboardVersions.projectId })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(process.env.UPLOAD_DIR || "./uploads", "projects", version.projectId, version.label);
}

async function resumeRemoteVideoIfAvailable(params: {
  shotId: string;
  remoteUrl: string | null | undefined;
  remoteStatus: string | null | undefined;
  remoteExpiresAt: Date | null | undefined;
  uploadDir: string;
}): Promise<string | null> {
  if (!isRemoteVideoReusable({
    url: params.remoteUrl,
    status: params.remoteStatus,
    expiresAt: params.remoteExpiresAt,
  })) {
    if (params.remoteUrl && params.remoteExpiresAt && params.remoteExpiresAt <= new Date()) {
      await db
        .update(shots)
        .set({ remoteVideoStatus: "expired" })
        .where(eq(shots.id, params.shotId));
    }
    return null;
  }
  try {
    const filePath = await downloadVideoWithRetry(params.remoteUrl!, params.uploadDir, {
      logPrefix: "RemoteVideoDownload",
    });
    await db
      .update(shots)
      .set({
        videoUrl: filePath,
        status: "completed",
        remoteVideoStatus: "downloaded",
        remoteVideoLastDownloadAt: new Date(),
      })
      .where(eq(shots.id, params.shotId));
    return filePath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[RemoteVideoResume] Re-download failed, generating a new video instead: ${message}`);
    await db
      .update(shots)
      .set({
        remoteVideoStatus: "download_failed",
        remoteVideoLastDownloadAt: new Date(),
      })
      .where(eq(shots.id, params.shotId));
    return null;
  }
}

function upstreamHttpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function mapUpstreamErrorHttpStatus(err: unknown): number {
  const status = upstreamHttpStatus(err);
  if (status !== undefined && status >= 500 && status < 600) return 502;
  return 500;
}

function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const status = upstreamHttpStatus(err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const requestId =
    typeof err === "object" && err !== null && "requestID" in err
      ? String((err as { requestID?: unknown }).requestID ?? "")
      : "";
  const requestIdHint = requestId ? `（请求 ID: ${requestId}）` : "";

  if (status !== undefined && status >= 500) {
    if (code === "InternalServiceError" || status === 500) {
      return `图像服务暂时不可用（上游 ${status}），请稍后重试或更换图像模型。${requestIdHint}`;
    }
    return `上游服务错误 ${status}：${err.message}${requestIdHint}`;
  }

  // Try to parse JSON error bodies (e.g. Google GenAI ApiError)
  try {
    const parsed = JSON.parse(err.message) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {}
  return err.message;
}

async function saveShotWarnings(shotId: string, resolvedChars: Array<{ name: string, missingState?: string | null }>) {
  const missingStates = resolvedChars
    .filter(c => c.missingState)
    .map(c => `${c.name}: ${c.missingState}`);
  
  if (missingStates.length > 0) {
    await db.update(shots).set({ warnings: missingStates.join("; ") }).where(eq(shots.id, shotId));
  } else {
    await db.update(shots).set({ warnings: null }).where(eq(shots.id, shotId));
  }
}

interface ModelConfig {
  text?: (ProviderConfig & { providerId?: string }) | null;
  image?: (ProviderConfig & { providerId?: string }) | null;
  video?: (ProviderConfig & { providerId?: string }) | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  // Verify project ownership
  const [ownerCheck] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!ownerCheck) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    action: string;
    payload?: Record<string, unknown>;
    modelConfig?: ModelConfig;
    episodeId?: string;
    enhancePrompts?: boolean;
  };

  const { action, payload, modelConfig, episodeId, enhancePrompts } = body;
  const resolvedModelConfig = (await hydrateModelConfigSecrets(
    userId,
    modelConfig
  )) as ModelConfig | undefined;

  if (action === "script_generate") {
    return handleScriptGenerate(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "script_parse") {
    return handleScriptParseStream(projectId, userId, resolvedModelConfig, episodeId);
  }

  if (action === "character_extract") {
    return handleCharacterExtract(projectId, userId, resolvedModelConfig, episodeId);
  }

  if (action === "single_character_image") {
    return handleSingleCharacterImage(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "batch_character_image") {
    return handleBatchCharacterImage(projectId, userId, resolvedModelConfig, episodeId);
  }

  if (action === "shot_split") {
    return handleShotSplitStream(projectId, userId, resolvedModelConfig, episodeId, {
      forceAi: Boolean(payload?.forceAi),
      targetVersionId: (payload?.targetVersionId as string | undefined) || undefined,
    });
  }

  if (action === "shot_extract_preview") {
    return handleShotExtractPreview(projectId, episodeId);
  }

  if (action === "single_shot_restore_from_script") {
    return handleSingleShotRestoreFromScript(projectId, payload, episodeId);
  }


  if (action === "batch_storyboard_rewrite") {
    return handleBatchStoryboardRewrite(projectId, episodeId, resolvedModelConfig);
  }

  if (action === "batch_voice_generate") {
    return handleBatchVoiceGenerate(projectId, resolvedModelConfig);
  }

  if (action === "frame_prompt_preview") {
    return handleFramePromptPreview(projectId, userId, payload, episodeId);
  }

  const deprecated = resolveDeprecatedGenerateAction(action);
  if (deprecated) {
    return NextResponse.json({ error: deprecated.error }, { status: deprecated.status });
  }

  if (action === "single_frame_generate") {
    return handleSingleFrameGenerate(projectId, userId, payload, resolvedModelConfig, episodeId, enhancePrompts);
  }

  if (action === "single_video_generate") {
    return handleSingleVideoGenerate(projectId, userId, payload, resolvedModelConfig, enhancePrompts);
  }

  if (action === "single_video_prompt") {
    return handleSingleVideoPrompt(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "batch_video_prompt") {
    return handleBatchVideoPrompt(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "ai_optimize_text") {
    return handleAiOptimizeText(payload, resolvedModelConfig);
  }

  if (action === "split_shot") {
    return handleSplitShot(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "video_assemble") {
    return handleVideoAssembleSync(projectId, payload, episodeId);
  }

  if (action === "expand_character_asset") {
    return handleExpandCharacterAsset(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "assign_tracks") {
    return handleAssignTracks(projectId, payload, episodeId);
  }

  if (action === "batch_video_generate") {
    return handleBatchVideoGenerate(projectId, userId, payload, resolvedModelConfig, episodeId, enhancePrompts);
  }

  // Image/video generation - keep in task queue
  const task = await enqueueTask({
    type: action as NonNullable<TaskType>,
    projectId,
    payload: { projectId, ...payload, modelConfig: resolvedModelConfig, episodeId, userId },
    ...(episodeId ? { episodeId } : {}),
  });

  return NextResponse.json(task, { status: 201 });
}

// --- script_generate: stream plain text screenplay from an idea ---

async function handleScriptGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const idea = (payload?.idea as string) || "";
  if (!idea.trim()) {
    return NextResponse.json({ error: "No idea provided" }, { status: 400 });
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  // Save the original idea before generating
  if (episodeId) {
    await db
      .update(episodes)
      .set({ idea, updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  } else {
    await db
      .update(projects)
      .set({ idea, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  const model = createLanguageModel(modelConfig.text);
  const scriptGenerateSystem = await resolvePrompt("script_generate", { userId, projectId });

  const result = streamText({
    model,
    system: scriptGenerateSystem,
    prompt: buildScriptGeneratePrompt(idea),
    temperature: 0.8,
    onFinish: async ({ text }) => {
      try {
        if (episodeId) {
          await db
            .update(episodes)
            .set({ script: text, updatedAt: new Date() })
            .where(eq(episodes.id, episodeId));
        } else {
          await db
            .update(projects)
            .set({ script: text, updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        }
        console.log(`[ScriptGenerate] Saved generated script for ${episodeId || projectId}`);
      } catch (err) {
        console.error("[ScriptGenerate] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

// --- script_parse: parse user script into structured screenplay ---

async function handleScriptParseStream(
  projectId: string,
  userId: string,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;

  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    script = episode?.script ?? null;
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    script = project?.script ?? null;
  }

  if (!script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const model = createLanguageModel(modelConfig.text);
  const scriptParseSystem = await resolvePrompt("script_parse", { userId, projectId });

  const result = streamText({
    model,
    system: scriptParseSystem,
    prompt: buildScriptParsePrompt(script),
    temperature: 0.7,
    onFinish: async ({ text }) => {
      try {
        const screenplay = extractJSON(text);
        JSON.parse(screenplay); // validate JSON
        if (episodeId) {
          await db.update(episodes).set({ updatedAt: new Date() }).where(eq(episodes.id, episodeId));
        } else {
          await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
        }
        console.log(`[ScriptParse] Parsed screenplay for ${episodeId || projectId}`);
      } catch (err) {
        console.error("[ScriptParse] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

// --- character_extract: stream character extraction from script ---

async function handleCharacterExtract(
  projectId: string,
  userId: string,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;
  let visualStyle: string = "anime_2d";

  // Always fetch project for visualStyle (even when episode is specified)
  const [proj] = await db
    .select({ script: projects.script, visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  visualStyle = proj?.visualStyle || "anime_2d";

  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    script = episode?.script ?? null;
  } else {
    script = proj?.script ?? null;
  }

  if (!script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  // Fetch all existing project characters for dedup
  const existingChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));
  const existingByName = new Map(
    existingChars.map((c) => [c.name.toLowerCase().trim(), c])
  );

  // If extracting for an episode, clear old episode_characters links for this episode
  if (episodeId) {
    await db.delete(episodeCharacters).where(eq(episodeCharacters.episodeId, episodeId));
  }

  const model = createLanguageModel(modelConfig.text);

  // ── Pass 1: LLM name enumeration (fast, no descriptions) ──────────────────
  // Ask the same model to list every character name first. This is a simple
  // task so it's fast and cheap. The resulting list is injected as a mandatory
  // cast list into pass-2, preventing any character from being silently dropped.
  let confirmedNames: string[] = [];
  try {
    console.log("[CharacterExtract] ── Pass 1 start: extracting name list ──");
    const { text: nameListText } = await generateText({
      model,
      system: CHARACTER_NAME_EXTRACTION_SYSTEM,
      prompt: buildCharacterNameExtractionPrompt(script),
    });
    console.log("[CharacterExtract] Pass-1 raw response:", nameListText.slice(0, 300));
    const parsed = JSON.parse(extractJSON(nameListText));
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "string")) {
      confirmedNames = parsed.filter((n) => n.trim().length > 0);
      console.log("[CharacterExtract] Pass-1 confirmed names (" + confirmedNames.length + "):", confirmedNames.join("、"));
    } else {
      console.warn("[CharacterExtract] Pass-1 returned unexpected format:", parsed);
    }
  } catch (err) {
    // Pass-1 failure is non-fatal: pass-2 runs without the mandatory list
    console.warn("[CharacterExtract] Pass-1 FAILED (will proceed without mandatory list):", err);
  }

  // ── Pass 2: Full character sheet generation ────────────────────────────────
  const charExtractSystem = await resolveCharacterExtractSystemPrompt(visualStyle, {
    userId,
    projectId,
  });
  console.log("[CharacterExtract] visualStyle:", visualStyle, "confirmed names:", confirmedNames.length);

  const { text } = await generateText({
    model,
    system: charExtractSystem,
    prompt: buildCharacterExtractPrompt(script, confirmedNames),
  });

  const extracted = JSON.parse(extractJSON(text)) as Array<{
    name: string;
    description: string;
    visualHint?: string;
    scope?: string;
  }>;

  let reusedCount = 0;
  let createdCount = 0;
  const linkedCharIds: string[] = [];

  for (const char of extracted) {
    const key = char.name.toLowerCase().trim();
    const existing = existingByName.get(key);

    if (existing) {
      // Reuse existing character — always update description from new extraction
      await db.update(characters)
        .set({
          description: char.description,
          visualHint: char.visualHint ?? existing.visualHint ?? "",
          // scope is a manual UI label — don't overwrite with LLM classification
      // scope: keep existing value (not updated here)
        })
        .where(eq(characters.id, existing.id));
      console.log(`[CharacterExtract] Updated existing character "${char.name}" (${existing.id}), desc length: ${char.description.length}`);
      linkedCharIds.push(existing.id);
      reusedCount++;
    } else {
      // Create new character
      const charId = ulid();
      await db.insert(characters).values({
        id: charId,
        projectId,
        name: char.name,
        description: char.description,
        visualHint: char.visualHint ?? "",
        scope: "main", // default — user can manually demote to guest
        episodeId: null,
      });
      existingByName.set(key, { id: charId, name: char.name } as typeof existingChars[0]);
      linkedCharIds.push(charId);
      createdCount++;
    }
  }

  // Create episode_characters links
  if (episodeId) {
    for (const charId of linkedCharIds) {
      await db.insert(episodeCharacters).values({
        id: ulid(),
        episodeId,
        characterId: charId,
      });
    }
  }

  console.log(
    `[CharacterExtract] ${extracted.length} characters: ${reusedCount} reused, ${createdCount} new, ${linkedCharIds.length} linked to episode`
  );

  return NextResponse.json({ characters: extracted });
}

// --- single_character_image: generate turnaround image for one character ---

async function handleSingleCharacterImage(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const characterId = payload?.characterId as string;
  const assetId = payload?.assetId as string; // Optional: target asset for saving
  const targetTag = (payload?.targetSlot as string) || "日常"; // targetSlot is now the tag
  const count = (payload?.count as number) || 1;
  const autoSave = payload?.autoSave !== false;

  if (!characterId) {
    return NextResponse.json({ error: "No characterId provided" }, { status: 400 });
  }

  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId));

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  // Resolve prompt dynamically based on tag
  let promptKey = "combat_image"; // Default to combat/morph
  if (targetTag === "日常") promptKey = "beauty_image";
  if (targetTag === "四视图") promptKey = "character_image";

  const slotContents = await resolveSlotContents(promptKey, { userId, projectId });
  
  let prompt: string;
  if (promptKey === "beauty_image") {
    prompt = buildBeautyImagePrompt(slotContents, character.name, character.description || "");
  } else if (promptKey === "combat_image") {
    // Pass the tag name as part of the description to give AI context
    const enhancedDesc = `${character.description || ""}\n(State: ${targetTag})`;
    prompt = buildCombatImagePrompt(slotContents, character.name, enhancedDesc);
  } else {
    prompt = buildCharacterTurnaroundPrompt(slotContents, character.name, character.description || "");
  }

  const ai = resolveImageProvider(modelConfig);

  try {
    const promises = Array.from({ length: count }).map(() =>
      ai.generateImage(prompt, {
        size: "2560x1440",
        aspectRatio: "16:9",
        quality: "hd",
      })
    );

    const imagePaths = await Promise.all(promises);

    // Auto-save logic
    if (autoSave && imagePaths.length === 1) {
      if (assetId) {
        // Save to specific asset
        await db
          .update(characterAssets)
          .set({ imagePath: imagePaths[0] })
          .where(eq(characterAssets.id, assetId));
      } else {
        // Find or create asset with tag
        const [existing] = await db.select().from(characterAssets).where(
          and(eq(characterAssets.characterId, characterId), eq(characterAssets.tag, targetTag))
        );
        if (existing) {
          await db.update(characterAssets).set({ imagePath: imagePaths[0] }).where(eq(characterAssets.id, existing.id));
        } else {
          await db.insert(characterAssets).values({
            id: ulid(),
            characterId,
            tag: targetTag,
            imagePath: imagePaths[0],
            assetType: targetTag === "四视图" ? "blueprint" : "morph"
          });
        }
      }
      return NextResponse.json({ characterId, imagePath: imagePaths[0], imagePaths, status: "ok" });
    }

    return NextResponse.json({ characterId, imagePaths, status: "ok" });
  } catch (err) {
    console.error(`[SingleCharacterImage] Error for ${character.name}:`, err);
    return NextResponse.json({ characterId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

// --- batch_character_image: generate turnaround images for all characters ---

async function handleBatchCharacterImage(
  projectId: string,
  userId: string,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  let allCharacters: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    allCharacters = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : [];
  } else {
    allCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  const results = await Promise.all(
    allCharacters.map(async (character) => {
      try {
        const assets = await db.select().from(characterAssets).where(eq(characterAssets.characterId, character.id));
        const hasBlueprint = assets.some(a => a.assetType === "blueprint");

        if (hasBlueprint) return null; // Already has four-view blueprint

        const ai = resolveImageProvider(modelConfig);
        const slotContents = await resolveSlotContents("character_image", { userId, projectId });

        // Generate Turnaround (Blueprint only — character router falls back to blueprint when no morph exists)
        const blueprintPrompt = buildCharacterTurnaroundPrompt(slotContents, character.name, character.description || "");
        const blueprintPath = await ai.generateImage(blueprintPrompt, {
          size: "2560x1440",
          aspectRatio: "16:9",
          quality: "hd",
        });

        await db.insert(characterAssets).values({
          id: ulid(),
          characterId: character.id,
          imagePath: blueprintPath,
          tag: "四视图",
          assetType: "blueprint"
        });

        return { name: character.name, status: "ok" };
      } catch (err) {
        console.error(`[BatchCharacterImage] Error for ${character.name}:`, err);
        return { name: character.name, status: "error", error: extractErrorMessage(err) };
      }
    })
  );

  return NextResponse.json({ results: results.filter(Boolean) });
}

// --- shot_split: stream shot splitting ---

async function handleShotSplitStream(
  projectId: string,
  userId: string,
  modelConfig?: ModelConfig,
  episodeId?: string,
  options?: { forceAi?: boolean; targetVersionId?: string }
) {
  let script: string | null = null;
  let targetDurationSeconds: number | null = null;
  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    script = episode.script ?? null;
    targetDurationSeconds = episode.targetDurationSeconds ?? null;
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    script = project.script ?? null;
  }

  // Always fetch project visualStyle for art-style lock in shot split prompts
  const [splitProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const splitVisualStyle = splitProject?.visualStyle || undefined;
  const splitVisualStyleTag = (() => {
    const style = splitProject?.visualStyle;
    if (!style) return undefined;
    return VISUAL_STYLE_PRESETS[style]?.tag || undefined;
  })();

  if (!script || !script.trim()) {
    return NextResponse.json(
      { error: "Script is empty. Please generate or import a script first." },
      { status: 400 }
    );
  }

  const shotCharacters = await getShotCharacters(projectId, episodeId);

  // 若前端传入 targetVersionId，验证它确实属于本项目+本集，防止跨项目 shot 清除
  let verifiedTargetVersionId: string | null = null;
  if (options?.targetVersionId) {
    const versionWhereClause = episodeId
      ? and(
          eq(storyboardVersions.projectId, projectId),
          eq(storyboardVersions.episodeId, episodeId),
          eq(storyboardVersions.id, options.targetVersionId)
        )
      : and(
          eq(storyboardVersions.projectId, projectId),
          eq(storyboardVersions.id, options.targetVersionId)
        );
    const [verifiedVersion] = await db
      .select({ id: storyboardVersions.id })
      .from(storyboardVersions)
      .where(versionWhereClause)
      .limit(1);
    if (verifiedVersion) {
      verifiedTargetVersionId = verifiedVersion.id;
    } else {
      console.warn(`[ShotSplit] targetVersionId ${options.targetVersionId} not found in project ${projectId} — creating new version instead`);
    }
  }

  // Structured storyboard path: preserve author-authored shot boundaries and exact
  // timecode durations. LLM splitting is only for unstructured scripts, because it
  // may rebalance duration even when the screenplay already has explicit timings.
  if (!options?.forceAi) {
    const extracted = extractShotsFromScript(script);
    if (extracted.detection.matched && extracted.shots.length > 0) {
      const persistableShots = finalizeExtractedShotsForDb(extracted.shots);
      const { versionId: persistedVersionId } = await persistStoryboardVersion({
        projectId,
        episodeId: episodeId ?? null,
        shotCharacters,
        shots: persistableShots,
        existingVersionId: verifiedTargetVersionId,
      });
      const totalDuration = persistableShots.reduce((sum, shot) => sum + (shot.duration ?? 0), 0);
      console.log(
        `[ShotSplit] Structured extraction: ${persistableShots.length} shots, ${totalDuration}s total, version=${persistedVersionId}`
      );
      return NextResponse.json({
        shots: persistableShots.length,
        mode: "extracted",
        versionId: persistedVersionId,
        warnings: extracted.warnings,
      });
    }
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const characterDescriptions = shotCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const characterVisualHints = shotCharacters
    .filter((c) => c.visualHint)
    .map((c) => ({ name: c.name, visualHint: c.visualHint! }));

  const model = createLanguageModel(modelConfig.text);
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);

  // Registry is the single source of truth for shot_split system prompt.
  // Slot defaults are S-grade; user overrides (if any) layer on top per slot.
  const shotSplitSlots = await resolveSlotContents("shot_split", { userId, projectId });
  const shotSplitDef = getPromptDefinition("shot_split")!;
  const systemPrompt = shotSplitDef.buildFullPrompt(shotSplitSlots, { maxDuration: videoMaxDuration });
  
  // Use portable JSON mode if possible, fallback to plain text + extractJSON
  const useJsonMode = modelConfig.text.protocol === "openai";
  const jsonMode = useJsonMode ? { openai: { response_format: { type: "json_object" } } } : undefined;

  // Split screenplay into chunks by SCENE markers (~8 scenes per chunk)
  const fullScript = script || "";
  const sceneChunks = splitScriptByScenes(fullScript, 8);
  // Log scene detection details
  const sceneRe =
    /^[\s*#]*(?:SCENE\s*\d+|场景\s*\d+|第\s*\d+\s*场|##\s*第\s*\d+\s*集\b)/i;
  const sceneMatches = fullScript.split("\n").filter((l) => sceneRe.test(l.trim()));
  console.log(`[ShotSplit] Detected ${sceneMatches.length} scenes, split into ${sceneChunks.length} chunk(s) of ~8 scenes each`);
  sceneChunks.forEach((c, i) => {
    const sceneCount = c.split("\n").filter((l) => sceneRe.test(l.trim())).length;
    console.log(`[ShotSplit] Chunk ${i + 1}: ${sceneCount} scenes, ${c.length} chars`);
  });

  type ParsedShot = {
    sequence: number;
    sceneDescription: string;
    startFrame: string;
    endFrame: string;
    motionScript: string;
    duration: number;
    dialogues: Array<{ character: string; text: string }>;
    cameraDirection?: string;
  };

  console.log(`[ShotSplit] Using LLM with S-grade system prompt (script length=${fullScript.length})`);


  // Pre-compute scene count per chunk for proportional duration distribution
  const chunkSceneCounts = sceneChunks.map(
    (chunk) => chunk.split("\n").filter((l) => sceneRe.test(l.trim())).length
  );
  const totalSceneCount = chunkSceneCounts.reduce((s, n) => s + n, 0);
  if (targetDurationSeconds) {
    console.log(`[ShotSplit] Target duration: ${targetDurationSeconds}s across ${sceneChunks.length} chunk(s), totalScenes=${totalSceneCount}`);
  }

  // Process chunks concurrently
  let lastError: string | null = null;
  const chunkResults = await Promise.all(
    sceneChunks.map(async (chunk, idx) => {
      // Distribute the episode target duration proportionally by scene count
      let chunkTargetDuration: number | null = null;
      if (targetDurationSeconds) {
        const chunkSceneCount = chunkSceneCounts[idx] ?? 0;
        // Proportional by scene count if markers detected; else split evenly across chunks
        const ratio = totalSceneCount > 0
          ? (chunkSceneCount > 0 ? chunkSceneCount / totalSceneCount : 1 / sceneChunks.length)
          : 1 / sceneChunks.length;
        chunkTargetDuration = Math.round(targetDurationSeconds * ratio);
        console.log(`[ShotSplit] Chunk ${idx + 1}: ${chunkSceneCount} scenes → targetDuration=${chunkTargetDuration}s`);
      }
      const prompt = buildShotSplitPrompt(chunk, characterDescriptions, characterVisualHints, chunkTargetDuration, splitVisualStyleTag, videoMaxDuration, splitVisualStyle);
      try {
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt,
          providerOptions: jsonMode,
          // S-grade shots are token-heavy (~500 tokens each).
          // For reasoning models (Deepseek R1 / QwQ etc.), <think> tokens also count toward
          // output quota — a long thinking chain can exhaust 16k before any JSON is written.
          // 32k gives thinking models ~16k for reasoning + ~16k for JSON output.
          maxOutputTokens: 32000,
        });
        
        if (!result.text) {
          throw new Error("AI returned empty response");
        }

        let parsed;
        try {
          const rawJson = extractJSON(result.text);
          parsed = JSON.parse(rawJson);
        } catch (parseErr) {
          console.error(`[ShotSplit] Chunk ${idx + 1} parse error. Raw text:`, result.text);
          throw new Error(`Failed to parse AI response as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
        }

        // Handle both array and {shots:[]} formats
        const shots = Array.isArray(parsed) ? parsed : (parsed.shots || []);
        if (shots.length === 0) {
          console.warn(`[ShotSplit] Chunk ${idx + 1} returned 0 shots. Raw response:`, result.text);
        }
        
        console.log(`[ShotSplit] Chunk ${idx + 1}/${sceneChunks.length}: ${shots.length} shots`);
        return shots as ParsedShot[];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ShotSplit] Chunk ${idx + 1} failed:`, msg);
        lastError = msg;
        return [] as ParsedShot[];
      }
    })
  );

  // Merge and re-sequence
  const allShots = chunkResults.flat();
  allShots.forEach((s, i) => { s.sequence = i + 1; });

  if (allShots.length === 0) {
    return NextResponse.json(
      { error: `Failed to generate shots. ${lastError || "Check script format (needs SCENE markers)."}` },
      { status: 500 }
    );
  }

  // Duration logging only — second-pass top-up removed (quality not controllable)
  if (targetDurationSeconds) {
    const actualDuration = allShots.reduce((s, shot) => s + (shot.duration ?? 0), 0);
    console.log(`[ShotSplit] Duration: ${actualDuration}s / ${targetDurationSeconds}s target (${allShots.length} shots)`);
  }

  const { versionId: persistedVersionId } = await persistStoryboardVersion({
    projectId,
    episodeId: episodeId ?? null,
    shotCharacters,
    shots: allShots.map((shot) => ({
      sequence: shot.sequence,
      prompt: shot.sceneDescription,
      startFrameDesc: shot.startFrame,
      endFrameDesc: shot.endFrame,
      motionScript: shot.motionScript,
      cameraDirection: shot.cameraDirection || "static",
      duration: shot.duration,
      soundEffectNote: (shot as Record<string, unknown>).soundEffect as string | null ?? null,
      dialogues: (shot.dialogues ?? []).map((d: { character: string; text: string; type?: string }) => ({
        character: d.character,
        text: d.text,
        type: (d.type as "dialogue" | "os" | "vo") ?? "dialogue",
      })),
    })),
    existingVersionId: verifiedTargetVersionId,
  });

  console.log(`[ShotSplit] Created ${allShots.length} shots from ${sceneChunks.length} chunks, version=${persistedVersionId}${verifiedTargetVersionId ? ` (reused version ${verifiedTargetVersionId})` : ""}`);

  // 监督层：对生成的分镜做质量校验（确定性规则，始终执行）
  const supervisionInput = allShots.map((shot, i) => ({
    id: `temp-${i}`,
    sequence: shot.sequence,
    prompt: shot.sceneDescription,
    motionScript: shot.motionScript,
    startFrameDesc: shot.startFrame,
    endFrameDesc: shot.endFrame,
    dialogues: (shot.dialogues ?? []).map((d: { character: string; text: string }) => ({
      characterName: d.character,
      text: d.text,
    })),
  }));

  const supervision = superviseShots(supervisionInput);
  console.log(`[ShotSplit] Supervision: grade=${supervision.grade}, issues=${supervision.issues.length}`);

  return NextResponse.json({
    shots: allShots.length,
    versionId: persistedVersionId,
    supervision: {
      grade: supervision.grade,
      summary: supervision.summary,
      criticalCount: supervision.criticalCount,
      warningCount: supervision.warningCount,
      issues: supervision.issues.slice(0, 10), // 只返回前10条，避免响应过大
    },
  });
}

async function handleShotExtractPreview(projectId: string, episodeId?: string) {
  let script: string | null = null;

  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    script = episode.script ?? null;
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    script = project.script ?? null;
  }

  if (!script || !script.trim()) {
    return NextResponse.json(
      { error: "Script is empty. Please generate or import a script first." },
      { status: 400 }
    );
  }

  const extracted = extractShotsFromScript(script);

  return NextResponse.json({
    mode: extracted.detection.matched ? "extracted" : "unstructured",
    score: extracted.detection.score,
    reasons: extracted.detection.reasons,
    warnings: extracted.warnings,
    shotCount: extracted.shots.length,
    shots: extracted.shots.slice(0, 20).map((shot) => ({
      sequence: shot.sequence,
      sceneTitle: shot.sceneTitle ?? "",
      duration: shot.duration ?? null,
      dialogueCount: shot.dialogues.length,
      prompt: shot.prompt,
      startFrameDesc: shot.startFrameDesc ?? null,
      endFrameDesc: shot.endFrameDesc ?? null,
      motionScript: shot.motionScript ?? null,
      cameraDirection: shot.cameraDirection ?? null,
      completeness: shot.completeness,
      dialogues: shot.dialogues,
    })),
  });
}

/** Split screenplay text into chunks by SCENE markers, ~maxScenes per chunk.
 *  Preserves the header (VISUAL STYLE + CHARACTERS) and prepends it to every chunk. */
function splitScriptByScenes(script: string, maxScenes: number): string[] {
  // Match SCENE markers with optional markdown bold (**), whitespace, or other decorators
  const scenePattern =
    /^[\s*#]*(?:SCENE\s*\d+|场景\s*\d+|第\s*\d+\s*场|##\s*第\s*\d+\s*集\b)/i;
  const lines = script.split("\n");

  // Find scene boundary line indices
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (scenePattern.test(lines[i].trim())) {
      boundaries.push(i);
    }
  }

  // If no scene markers found or few scenes, return as single chunk
  if (boundaries.length <= maxScenes) {
    return [script];
  }

  // Everything before the first SCENE marker is the header (VISUAL STYLE + CHARACTERS)
  const header = lines.slice(0, boundaries[0]).join("\n").trim();

  // Group scenes into chunks, prepend header to each
  const chunks: string[] = [];
  for (let i = 0; i < boundaries.length; i += maxScenes) {
    const start = boundaries[i];
    const end = i + maxScenes < boundaries.length
      ? boundaries[i + maxScenes]
      : lines.length;
    const scenesText = lines.slice(start, end).join("\n");
    chunks.push(header ? `${header}\n\n${scenesText}` : scenesText);
  }

  return chunks;
}

// --- single_shot_restore_from_script: restore text fields from the original script ---

async function handleSingleShotRestoreFromScript(
  projectId: string,
  payload?: Record<string, unknown>,
  episodeId?: string
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  // Read the original script from the episode (or project as fallback)
  const epId = episodeId || shot.episodeId;
  let script: string | null = null;
  if (epId) {
    const [episode] = await db.select({ script: episodes.script }).from(episodes).where(eq(episodes.id, epId));
    script = episode?.script ?? null;
  }
  if (!script) {
    const [project] = await db.select({ script: projects.script }).from(projects).where(eq(projects.id, projectId));
    script = project?.script ?? null;
  }

  if (!script?.trim()) {
    return NextResponse.json({ error: "Script is empty — cannot restore" }, { status: 400 });
  }

  // Parse the script structurally (same path as 解析分镜's fast path)
  const extracted = extractShotsFromScript(script);
  if (!extracted.detection.matched || extracted.shots.length === 0) {
    return NextResponse.json(
      { error: "Script is not in structured storyboard format — cannot restore individual shots" },
      { status: 400 }
    );
  }

  // Find the shot by sequence number (1-based)
  const scriptShot = extracted.shots.find((s) => s.sequence === shot.sequence);
  if (!scriptShot) {
    return NextResponse.json(
      { error: `Shot sequence ${shot.sequence} not found in script (script has ${extracted.shots.length} shots)` },
      { status: 404 }
    );
  }

  // Update ONLY text fields — never touch anchorFirst, anchorLastAi, videoUrl, etc.
  // bgmNote/soundEffectNote 同步还原：确保 DB 与最新 parser 解析结果一致，
  // 便于后续 stripBgmContent 进行精确剔除而非依赖正则
  await db.update(shots).set({
    prompt: scriptShot.prompt ?? shot.prompt,
    startFrameDesc: scriptShot.startFrameDesc ?? shot.startFrameDesc,
    endFrameDesc: scriptShot.endFrameDesc ?? shot.endFrameDesc,
    motionScript: scriptShot.motionScript ?? shot.motionScript,
    cameraDirection: scriptShot.cameraDirection ?? shot.cameraDirection,
    duration: scriptShot.duration ?? shot.duration,
    bgmNote: scriptShot.bgmNote ?? null,
    soundEffectNote: scriptShot.soundEffectNote ?? null,
  }).where(eq(shots.id, shotId));

  console.log(`[RestoreFromScript] Shot ${shot.sequence} text fields restored from script`);
  return NextResponse.json({ shotId, status: "ok", sequence: shot.sequence });
}


// --- batch_voice_generate: generate 9-dim voice description for characters without voiceHint ---

const VOICE_GENERATE_SYSTEM = `你是一位专业音效导演，负责为动漫角色生成标准化的 9 维音色描述。

根据角色名称和外形/性格描述，按以下固定格式输出音色描述，**只输出描述本身，不输出其他内容**：

格式：{性别}，{年龄音色}，{音调}，{音色质感}，{声音厚度}，{发音方式}，{气息}，{语速}，{特殊质感}

维度说明：
- 性别：男声 / 女声
- 年龄音色：童年音色 / 少年音色 / 青年音色 / 中年音色 / 老年音色
- 音调：音调低沉 / 音调偏低 / 音调中等 / 音调中等偏高 / 音调偏高
- 音色质感：音色浑厚有力 / 音色干净纯粹 / 音色清亮柔和 / 音色明亮清脆 / 音色沙哑粗粝 / 音色干燥偏暗
- 声音厚度：声音厚重 / 声音厚度适中 / 声音轻薄 / 声音清亮
- 发音方式：发音标准 / 发音清晰 / 发音带气声 / 发音有颗粒感
- 气息：气息极其沉稳 / 气息平稳 / 气息轻盈 / 气息充沛平稳 / 气息充沛
- 语速：语速极慢 / 语速偏慢 / 语速适中 / 语速偏快
- 特殊质感（可选，如无则写"无特殊"）：带笑意和感染力 / 带急切感 / 有威胁感 / 带温婉真诚感 / 带沙砾感

示例输出（勿带引号）：
男声，童年音色，音调偏高，音色干净纯粹，声音轻薄，发音清晰，气息轻盈，语速偏快，带急切感`;

async function handleBatchVoiceGenerate(
  projectId: string,
  modelConfig?: ModelConfig
): Promise<Response> {
  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      try {
        // 查出所有该项目下有 visualHint 的角色（无论是否已有 voiceHint，全量覆盖生成）
        const charRows = await db
          .select({ id: characters.id, name: characters.name, visualHint: characters.visualHint })
          .from(characters)
          .where(
            and(
              eq(characters.projectId, projectId),
              sql`(${characters.visualHint} IS NOT NULL AND trim(${characters.visualHint}) != '')`
            )
          );

        const total = charRows.length;
        if (total === 0) {
          send({ type: "done", updatedCount: 0, totalCount: 0 });
          controller.close();
          return;
        }

        send({ type: "start", totalCount: total });
        console.log(`[BatchVoiceGenerate] start project=${projectId} chars=${total}`);

        let updatedCount = 0;
        // 记录每个角色写入 DB 的 voiceHint，随 progress 事件回传前端做实时更新
        const voiceHintMap = new Map<string, string>();
        for (const char of charRows) {
          let savedVoiceHint: string | null = null;
          try {
            const { text } = await generateText({
              model: createLanguageModel(modelConfig.text!),
              system: VOICE_GENERATE_SYSTEM,
              prompt: `角色名：${char.name}\n外形/性格描述：${char.visualHint}`,
              temperature: 0.3,
            });

            // 剥离 <think>...</think> 推理块（扩展模型可能输出），再去除首尾引号
            const voiceHint = text
              .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
              .trim()
              .replace(/^["「『]|["」』]$/g, "");
            if (voiceHint) {
              await db
                .update(characters)
                .set({ voiceHint })
                .where(eq(characters.id, char.id));
              updatedCount++;
              savedVoiceHint = voiceHint;
              voiceHintMap.set(char.id, voiceHint);
              console.log(`[BatchVoiceGenerate] ${char.name} → ${voiceHint}`);
            }
          } catch (charErr) {
            console.warn(`[BatchVoiceGenerate] Failed for ${char.name}:`, charErr);
          }
          // 把已写入 DB 的 voiceHint 带回前端，前端实时更新角色卡片（无需额外 API 请求）
          send({ type: "progress", updatedCount, totalCount: total, characterName: char.name, characterId: char.id, voiceHint: savedVoiceHint });
        }

        send({ type: "done", updatedCount, totalCount: total });
        console.log(`[BatchVoiceGenerate] Done: ${updatedCount}/${total}`);
      } catch (err) {
        console.error("[BatchVoiceGenerate] Fatal:", err);
        send({ type: "error", error: extractErrorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// --- batch_storyboard_rewrite: tool-calling approach (Toonflow pattern) ---
// LLM calls write_shot_rewrite() once per shot → each call writes DB immediately → SSE progress

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function handleBatchStoryboardRewrite(
  projectId: string,
  episodeId: string | undefined,
  modelConfig?: ModelConfig
): Response {
  if (!modelConfig?.text) {
    return new Response(
      sseEvent({ type: "error", error: "No text model configured" }),
      { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      try {
        // Fetch all shots
        const shotRows = await db
          .select({
            id: shots.id,
            sequence: shots.sequence,
            duration: shots.duration,
            prompt: shots.prompt,
            startFrameDesc: shots.startFrameDesc,
            endFrameDesc: shots.endFrameDesc,
            motionScript: shots.motionScript,
            cameraDirection: shots.cameraDirection,
          })
          .from(shots)
          .innerJoin(storyboardVersions, eq(shots.versionId, storyboardVersions.id))
          .where(
            episodeId
              ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
              : eq(storyboardVersions.projectId, projectId)
          )
          .orderBy(shots.sequence);

        if (shotRows.length === 0) {
          send({ type: "error", error: "No shots found for this episode" });
          controller.close();
          return;
        }

        const shotIds = shotRows.map((s) => s.id);
        const validShotIds = new Set(shotIds);

        // Fetch dialogues（含 type 和 voiceHint，供批量重写将台词内嵌进 motionScript）
        const dialogueRows = await db
          .select({
            shotId: dialogues.shotId,
            text: dialogues.text,
            type: dialogues.type,
            characterName: characters.name,
            voiceHint: characters.voiceHint,
          })
          .from(dialogues)
          .innerJoin(characters, eq(dialogues.characterId, characters.id))
          .where(inArray(dialogues.shotId, shotIds))
          .orderBy(dialogues.sequence);

        const dialoguesByShotId = new Map<
          string,
          Array<{ characterName: string; text: string; type: string | null; voiceHint: string | null }>
        >();
        for (const d of dialogueRows) {
          if (!d.shotId) continue;
          if (!dialoguesByShotId.has(d.shotId)) dialoguesByShotId.set(d.shotId, []);
          dialoguesByShotId.get(d.shotId)!.push({
            characterName: d.characterName,
            text: d.text,
            type: d.type,
            voiceHint: d.voiceHint,
          });
        }

        const shotsWithDialogues = shotRows.map((s) => ({
          ...s,
          dialogues: dialoguesByShotId.get(s.id) ?? [],
        }));

        const totalCount = shotRows.length;
        let updatedCount = 0;
        const writtenShotIds = new Set<string>();

        send({ type: "start", totalCount });
        console.log(`[BatchStoryboardRewrite] start project=${projectId} episode=${episodeId} shots=${totalCount}`);

        // Tool: LLM calls this once per shot to write rewritten fields to DB.
        // Shared across all chunks; writtenShotIds prevents double-writes.
        const writeShotRewrite = tool({
          description: "将重写后的分镜视觉字段写入数据库。每个分镜调用一次，按镜头顺序逐一调用。",
          inputSchema: jsonSchema<{
            shotId: string;
            startFrameDesc: string;
            endFrameDesc: string;
            motionScript: string;
            cameraDirection: string;
          }>({
            type: "object",
            properties: {
              shotId: { type: "string", description: "镜头 ID，必须与输入完全一致" },
              startFrameDesc: { type: "string", description: "重写后的首帧描述（四要素）" },
              endFrameDesc: { type: "string", description: "重写后的尾帧描述（四要素，必须与首帧不同）" },
              motionScript: { type: "string", description: "重写后的运动脚本（四要素，≤80字）" },
              cameraDirection: { type: "string", description: "重写后的镜头朝向" },
            },
            required: ["shotId", "startFrameDesc", "endFrameDesc", "motionScript", "cameraDirection"],
          }),
          execute: async ({ shotId, startFrameDesc, endFrameDesc, motionScript, cameraDirection }) => {
            if (!validShotIds.has(shotId)) return `skipped: unknown shotId ${shotId}`;
            if (writtenShotIds.has(shotId)) return `skipped: already written ${shotId}`;
            if (!startFrameDesc || !motionScript) return `skipped: missing required fields for ${shotId}`;

            try {
              await db
                .update(shots)
                .set({ startFrameDesc, endFrameDesc, motionScript, cameraDirection, videoPrompt: null })
                .where(eq(shots.id, shotId));
              writtenShotIds.add(shotId);
              updatedCount++;
              send({ type: "progress", updatedCount, totalCount });
              console.log(`[BatchStoryboardRewrite] wrote shot ${shotId} (${updatedCount}/${totalCount})`);
              return `ok: ${shotId}`;
            } catch (dbErr) {
              console.error(`[BatchStoryboardRewrite] DB write failed for shot ${shotId}:`, dbErr);
              return `error: DB write failed for ${shotId}`;
            }
          },
        });

        // 分块处理：每次最多 CHUNK_SIZE 个镜头，避免推理模型长时间思考触发 provider 超时。
        // 每块独立 streamText，某块超时只影响该块，不影响其他块。
        const CHUNK_SIZE = 5;
        const chunks: typeof shotsWithDialogues[] = [];
        for (let i = 0; i < shotsWithDialogues.length; i += CHUNK_SIZE) {
          chunks.push(shotsWithDialogues.slice(i, i + CHUNK_SIZE));
        }

        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const chunk = chunks[chunkIdx];
          const chunkLabel = `chunk ${chunkIdx + 1}/${chunks.length}`;
          console.log(`[BatchStoryboardRewrite] ${chunkLabel} start (shots ${chunk.map(s => s.sequence).join(",")})`);

          try {
            const result = streamText({
              model: createLanguageModel(modelConfig.text!),
              system: STORYBOARD_REWRITE_SYSTEM,
              prompt: buildRewriteUserPrompt(chunk, shotsWithDialogues),
              temperature: 0.5,
              tools: { write_shot_rewrite: writeShotRewrite },
              stopWhen: stepCountIs(chunk.length + 5),
            });

            // 消费流以驱动工具调用；每 2 秒发一次心跳防止 SSE 链路被浏览器视为"断开"。
            let lastHeartbeat = Date.now();
            for await (const ch of result.fullStream) {
              const now = Date.now();
              if (now - lastHeartbeat > 2000) {
                send({ type: "thinking", updatedCount, totalCount });
                lastHeartbeat = now;
              }
              void ch;
            }
            console.log(`[BatchStoryboardRewrite] ${chunkLabel} done (${updatedCount}/${totalCount})`);
          } catch (streamErr) {
            const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
            console.warn(`[BatchStoryboardRewrite] ${chunkLabel} interrupted (${updatedCount}/${totalCount}):`, errMsg);
            // 发送 stream_error 但继续处理后续块
            send({ type: "stream_error", error: `${chunkLabel}: ${errMsg}`, updatedCount, totalCount });
          }
        }

        send({ type: "done", updatedCount, totalCount });
        console.log(`[BatchStoryboardRewrite] Done: ${updatedCount}/${totalCount}`);
      } catch (err) {
        console.error("[BatchStoryboardRewrite] Fatal error:", err);
        send({ type: "error", error: extractErrorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function handleFramePromptPreview(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  episodeId?: string
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const shotEpisodeId = episodeId || shot.episodeId;
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);
  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const [previousShot] = shot.versionId
    ? await db
        .select()
        .from(shots)
        .where(
          and(
            eq(shots.projectId, projectId),
            eq(shots.versionId, shot.versionId),
            lt(shots.sequence, shot.sequence)
          )
        )
        .orderBy(desc(shots.sequence))
        .limit(1)
    : await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, projectId), lt(shots.sequence, shot.sequence)))
        .orderBy(desc(shots.sequence))
        .limit(1);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", {
    userId,
    projectId,
  });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", {
    userId,
    projectId,
  });

  // Fetch visualStyle for style lock (same as actual generation)
  const [previewProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const previewVisualStyleTag = (() => {
    const style = previewProject?.visualStyle;
    if (!style) return undefined;
    return VISUAL_STYLE_PRESETS[style]?.tag || undefined;
  })();
  const previewShotChars = filterShotCharacters(
    buildShotCharacterText(shot),
    projectCharacters
  );

  const firstPrompt = buildFirstFramePrompt(
    pickFirstFramePromptBuildParams({
      shot,
      characterDescriptions,
      namedCharacterCount: previewShotChars.length,
      hasContinuityReference: false,
      hasCharacterSheetRefs: previewShotChars.length > 0,
      visualStyleTag: previewVisualStyleTag,
      cameraDirection: shot.cameraDirection ?? undefined,
      slotContents: frameFirstSlots,
      previousLastFrame: previousShot?.anchorLastAi || undefined,
    })
  );

  const lastPrompt = buildLastFramePrompt(
    pickLastFramePromptBuildParams({
      shot,
      characterDescriptions,
      namedCharacterCount: previewShotChars.length,
      hasAnchorFirst: !!(shot.anchorFirst || previousShot?.anchorLastAi),
      hasCharacterSheetRefs: previewShotChars.length > 0,
      visualStyleTag: previewVisualStyleTag,
      cameraDirection: shot.cameraDirection ?? undefined,
      slotContents: frameLastSlots,
    })
  );

  return NextResponse.json({
    shotId,
    reusePreviousLastFrame: Boolean(previousShot?.anchorLastAi),
    firstPrompt,
    lastPrompt,
    startFrameDesc: shot.startFrameDesc || shot.prompt || "",
    endFrameDesc: shot.endFrameDesc || shot.prompt || "",
  });
}

/**
 * Toonflow 参考图数量限制（API 上限约 10 张）。
 *
 * Toonflow 的做法：超出10张时把第10张之后的合并为一张合成图。
 * 本项目暂无 sharp，改用优先级截断：角色参考图在前，场景图在后，
 * 跨镜参考图排最前，然后是角色定妆图、场景图，整体截取前 MAX_REFERENCE_IMAGES 张。
 * Seedream API 最大支持 14 张参考图，此处设 14 以充分利用 API 能力。
 *
 * 实际使用中：1-4 角色 + 0-1 场景 = 2-5 张，极少超限。
 */
const MAX_REFERENCE_IMAGES = 14; // Seedream API 最大支持 14 张参考图

function limitReferenceImages(images: string[]): string[] {
  if (images.length <= MAX_REFERENCE_IMAGES) return images;
  console.warn(
    `[ReferenceImages] ${images.length} images exceed limit ${MAX_REFERENCE_IMAGES}, truncating to first ${MAX_REFERENCE_IMAGES}`
  );
  return images.slice(0, MAX_REFERENCE_IMAGES);
}

// --- single_frame_generate: synchronous frame generation for one shot ---

async function handleSingleFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  enhancePrompts?: boolean
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const shotEpisodeId = episodeId || shot.episodeId;
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);
  const siblingShotsForContext = shot.versionId
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, projectId), eq(shots.versionId, shot.versionId)))
        .orderBy(asc(shots.sequence))
    : shotEpisodeId
      ? await db
          .select()
          .from(shots)
          .where(and(eq(shots.projectId, projectId), eq(shots.episodeId, shotEpisodeId)))
          .orderBy(asc(shots.sequence))
      : await db
          .select()
          .from(shots)
          .where(eq(shots.projectId, projectId))
          .orderBy(asc(shots.sequence));
  const singleFrameCharacterContext = siblingShotsForContext.map(buildShotCharacterText).join("\n");

  // Filter to only the characters mentioned in this shot's text —
  // avoids injecting every episode character's reference image into unrelated frames.
  const shotText = buildShotCharacterText(shot);
  const shotCharacters = filterShotCharacters(shotText, projectCharacters, { contextText: singleFrameCharacterContext });
  // Use only characters mentioned in this shot — if none matched (crowd scene / no named chars),
  // pass an empty list so no ref images are injected.
  const charsForFrame = shotCharacters;

  // Frame-specific character subsets: only inject characters whose names appear in the
  // opening / closing frame description. A character mentioned in the scene description
  // (prompt) but NOT in startFrameDesc should not be drawn in the first frame, and vice-
  // versa for the last frame. Fall back to the full shot list only when the frame
  // description is empty so we never produce an empty character context by accident.
  // Use only the per-frame description for character filtering — motionScript covers the
  // entire shot timeline and would import characters that only appear mid-clip or at the
  // end, incorrectly pulling their reference images into the first (or last) frame prompt.
  const firstFrameFilterText = shot.startFrameDesc ?? "";
  const lastFrameFilterText  = shot.endFrameDesc ?? "";
  const charsForFirstFrame = firstFrameFilterText
    ? filterShotCharacters(firstFrameFilterText, charsForFrame)
    : charsForFrame;
  const charsForLastFrame = lastFrameFilterText
    ? filterShotCharacters(lastFrameFilterText, charsForFrame)
    : charsForFrame;

  const characterDescriptions = charsForFrame
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  // Load reference images for the union of all characters in this shot.
  const resolvedChars = await resolveCharacterImages(
    shot.prompt || "",
    charsForFrame,
    modelConfig?.text,
    userId,
    projectId
  );
  await saveShotWarnings(shotId, resolvedChars);

  // Frame-specific reference image subsets — 主图必须排在角度图前面，
  // 确保 @图N 编号与 referenceImages[N-1] 一一对应（与 Toonflow generateFlowImage 一致）。
  const firstFrameCharNames = new Set(charsForFirstFrame.map((c) => c.name));
  const lastFrameCharNames  = new Set(charsForLastFrame.map((c) => c.name));
  const resolvedFirst = resolvedChars.filter((rc) => firstFrameCharNames.has(rc.name));
  const charMainImagesFirst  = resolvedFirst.map((c) => c.imagePath);
  const charAngleImagesFirst = resolvedFirst.flatMap((c) => (c.angleImagePaths ?? []).slice(0, 2));
  const resolvedLast = resolvedChars.filter((rc) => lastFrameCharNames.has(rc.name));
  const charMainImagesLast  = resolvedLast.map((c) => c.imagePath);
  const charAngleImagesLast = resolvedLast.flatMap((c) => (c.angleImagePaths ?? []).slice(0, 2));
  // 合并版本供 length 检查和 debug 日志使用。
  const charRefImagesFirst = [...charMainImagesFirst, ...charAngleImagesFirst];
  const charRefImagesLast  = [...charMainImagesLast,  ...charAngleImagesLast];

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);
  const singleTextProvider = enhancePrompts ? resolveAIProvider(modelConfig) : null;
  const singleImageProtocol = modelConfig?.image?.protocol ?? "";

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  // Fetch project visualStyle for art-style lock
  const [singleProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const singleVisualStyle = singleProject?.visualStyle || undefined;
  const singleVisualStyleTag = (() => {
    const style = singleProject?.visualStyle;
    if (!style) return undefined;
    return VISUAL_STYLE_PRESETS[style]?.tag || undefined;
  })();

  // Clean cameraDirection (remove markdown bold markers)
  const singleCleanedCamera = shot.cameraDirection?.replace(/^\*+\s*/, "").replace(/\*+$/, "").trim() || undefined;

  // Include visualHint in character descriptions (same as batch/chain generation)
  const characterDescriptionsWithHints = charsForFrame
    .map((c) => `${c.name}${c.visualHint ? `【${c.visualHint}】` : ""}: ${c.description}`)
    .join("\n");

  // Frame-specific description strings — used to build per-frame prompts.
  const characterDescriptionsForFirst = charsForFirstFrame
    .map((c) => `${c.name}${c.visualHint ? `【${c.visualHint}】` : ""}: ${c.description}`)
    .join("\n");
  const characterDescriptionsForLast = charsForLastFrame
    .map((c) => `${c.name}${c.visualHint ? `【${c.visualHint}】` : ""}: ${c.description}`)
    .join("\n");

  // frameTarget: "first" = only regenerate anchorFirst; "last" = only anchorLastAi; "both" = default
  const frameTarget = (payload?.frameTarget as "first" | "last" | "both") ?? "both";

  // 解析多参考图（frameReferences 数组，新）或单参考图（frameReference，兼容旧版）
  // 第一张为主参考（用于 chainSourceShotId/chainSourceType 记录），后续为额外参考。
  const rawFrameRefs = payload?.frameReferences as Array<Partial<FrameReferencePayload>> | undefined;
  const rawFrameRef = payload?.frameReference as Partial<FrameReferencePayload> | undefined;

  // 统一成数组处理
  const rawRefList: Array<Partial<FrameReferencePayload>> = rawFrameRefs?.length
    ? rawFrameRefs
    : rawFrameRef?.shotId && rawFrameRef?.frameType
      ? [rawFrameRef]
      : [];

  type ResolvedFrameRef = { path: string; shotId: string; frameType: FrameReferenceType; sourceSequence: number };
  const resolvedFrameRefs: ResolvedFrameRef[] = [];

  for (const ref of rawRefList) {
    if (!ref.shotId || !ref.frameType) continue;
    const frameType = ref.frameType;
    if (
      frameType !== "anchor_first" &&
      frameType !== "anchor_last_ai" &&
      frameType !== "cut_point"
    ) {
      return NextResponse.json({ error: "无效的 frameReference.frameType" }, { status: 400 });
    }
    const resolved = await resolveFrameReferenceForProject(projectId, {
      shotId: ref.shotId,
      frameType,
    });
    if (!resolved) {
      // 某一张缺失时跳过（不阻断整批），记录警告
      console.warn(`[SingleFrameGenerate] frameReference ${ref.shotId}/${frameType} 不存在或文件缺失，已跳过`);
      continue;
    }
    resolvedFrameRefs.push(resolved);
  }

  // 主参考（第一张）用于衔接元数据记录；多张全部注入 refImages
  const continuityRef: ResolvedFrameRef | undefined = resolvedFrameRefs[0];

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const generateAnchorFirst = async (): Promise<string> => {
      // 所有跨镜参考图路径（保持顺序：主参考优先，其余附加参考次之）
      const crossShotRefPaths = resolvedFrameRefs.map((r) => r.path);
      // @图N 对齐规则（与 Toonflow generateFlowImage 一致）：
      //   referenceList 前 N 项必须与 prompt 里 @图1…@图N 编号一一对应。
      //   firstFrameAssets = [char0, char1, ..., scene]，所以：
      //     @图1 → referenceList[0] = char0 主图
      //     @图2 → referenceList[1] = char1 主图
      //   角色的多角度图（angleImages）和跨镜参考图（crossShotRefPaths）
      //   追加到末尾，作为额外上下文，不占 @图N 编号。
      // refImages 顺序：charMain(@图N 对齐) → charAngle(无编号) → crossShot(无编号)
      const refImages = [
        ...charMainImagesFirst,
        ...charAngleImagesFirst,   // 角度图追加到末尾（无 @图N 绑定，提供额外一致性上下文）
        ...crossShotRefPaths,      // 跨镜参考图追加到末尾
      ];
      const firstFrameAssets = [
        ...charsForFirstFrame.map((c) => ({ id: c.id, name: c.name, type: "role" as const })),
      ];
      const firstPromptRaw = buildFirstFramePrompt(
        pickFirstFramePromptBuildParams({
          shot,
          characterDescriptions: characterDescriptionsForFirst,
          namedCharacterCount: charsForFirstFrame.length,
          hasContinuityReference: !!continuityRef,
          hasCharacterSheetRefs: !continuityRef && charRefImagesFirst.length > 0,
          visualStyleTag: singleVisualStyleTag,
          visualStyle: singleVisualStyle,
          cameraDirection: singleCleanedCamera,
          slotContents: frameFirstSlots,
          assets: firstFrameAssets,
        })
      );
      const firstPrompt = enhancePrompts && singleTextProvider
        ? await enhanceImagePrompt(firstPromptRaw, singleImageProtocol, singleTextProvider)
        : firstPromptRaw;
      if (continuityRef) {
        console.log(
          `[SingleFrameGenerate] Shot ${shot.sequence}: frameReferences[${resolvedFrameRefs.length}] primary=${frameReferenceContinuityLabel(
            continuityRef.sourceSequence,
            continuityRef.frameType
          )} → Seedream regen anchor_first`
        );
      }
      console.log(
        `[SingleFrameGenerate][PROMPT DEBUG] shotId=${shotId} visualStyleTag=${JSON.stringify(singleVisualStyleTag)} crossShotRefs=${crossShotRefPaths.length} charRefs=${charRefImagesFirst.length} totalRefImages=${refImages.length}`
      );
      console.log(`[SingleFrameGenerate][PROMPT DEBUG] finalPrompt:\n${firstPrompt}`);
      return ai.generateImage(firstPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: limitReferenceImages(refImages),
      });
    };

    const persistAnchorFirst = async (anchorFirstPath: string) => {
      await db
        .update(shots)
        .set({
          anchorFirst: anchorFirstPath,
          status: "completed",
          chainSourceShotId: continuityRef?.shotId ?? null,
          chainSourceType: continuityRef?.frameType ?? null,
        })
        .where(eq(shots.id, shotId));
    };

    if (frameTarget === "first") {
      const firstFramePath = await generateAnchorFirst();
      await persistAnchorFirst(firstFramePath);
      return NextResponse.json({ shotId, anchorFirst: firstFramePath, status: "ok" });
    }

    if (frameTarget === "last") {
      // Regenerate last frame only, using existing anchorFirst as reference
      const existingFirstFrame = shot.anchorFirst;
      if (!existingFirstFrame) {
        await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
        return NextResponse.json({ error: "首帧不存在，请先生成首帧" }, { status: 400 });
      }
      const lastFrameAssets = [
        ...charsForLastFrame.map((c) => ({ id: c.id, name: c.name, type: "role" as const })),
      ];
      const lastPromptRaw = buildLastFramePrompt(
        pickLastFramePromptBuildParams({
          shot,
          characterDescriptions: characterDescriptionsForLast,
          namedCharacterCount: charsForLastFrame.length,
          hasAnchorFirst: true,
          hasCharacterSheetRefs: charRefImagesLast.length > 0,
          visualStyleTag: singleVisualStyleTag,
          visualStyle: singleVisualStyle,
          cameraDirection: singleCleanedCamera,
          slotContents: frameLastSlots,
          assets: lastFrameAssets,
        })
      );
      const lastPrompt = enhancePrompts && singleTextProvider
        ? await enhanceImagePrompt(lastPromptRaw, singleImageProtocol, singleTextProvider)
        : lastPromptRaw;
      // 尾帧 referenceImages 顺序与 lastFrameAssets (@图N) 严格对齐：
      //   @图1…@图N → charMainImagesLast（角色主图）
      //   无编号     → charAngleImagesLast（角度图，额外一致性上下文）
      //   无编号     → existingFirstFrame（首帧作为风格连续性锚定，排末尾）
      //   无编号     → crossShotRefPathsLast
      const crossShotRefPathsLast = resolvedFrameRefs.map((r) => r.path);
      const lastFramePath = await ai.generateImage(lastPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: limitReferenceImages([
          ...charMainImagesLast,
          ...charAngleImagesLast,
          existingFirstFrame,
          ...crossShotRefPathsLast,
        ]),
      });
      await db
        .update(shots)
        .set({ anchorLastAi: lastFramePath, status: "completed" })
        .where(eq(shots.id, shotId));
      return NextResponse.json({ shotId, anchorLastAi: lastFramePath, status: "ok" });
    }

    // frameTarget === "both" — user explicitly chose keyframe-interpolation mode;
    // always generate anchorFirst + anchorLastAi with no heuristic.
    const firstFramePath = await generateAnchorFirst();

    // Both frames: generate anchorLastAi
    const bothLastFrameAssets = [
      ...charsForLastFrame.map((c) => ({ id: c.id, name: c.name, type: "role" as const })),
    ];
    const lastPromptRaw = buildLastFramePrompt(
      pickLastFramePromptBuildParams({
        shot,
        characterDescriptions: characterDescriptionsForLast,
        namedCharacterCount: charsForLastFrame.length,
        hasAnchorFirst: true,
        hasCharacterSheetRefs: charRefImagesLast.length > 0,
        visualStyleTag: singleVisualStyleTag,
        visualStyle: singleVisualStyle,
        cameraDirection: singleCleanedCamera,
        slotContents: frameLastSlots,
        assets: bothLastFrameAssets,
      })
    );
    const lastPrompt = enhancePrompts && singleTextProvider
      ? await enhanceImagePrompt(lastPromptRaw, singleImageProtocol, singleTextProvider)
      : lastPromptRaw;
    // Both 模式尾帧：与 "last" 模式相同的对齐规则
    //   charMain → charAngle → firstFrame（连续性锚定）→ crossShot
    const bothCrossShotRefPaths = resolvedFrameRefs.map((r) => r.path);
    const lastFramePath = await ai.generateImage(lastPrompt, {
      ...imageOpts,
      quality: "hd",
      referenceImages: limitReferenceImages([
        ...charMainImagesLast,
        ...charAngleImagesLast,
        firstFramePath,
        ...bothCrossShotRefPaths,
      ]),
    });

    await db
      .update(shots)
      .set({
        anchorFirst: firstFramePath,
        anchorLastAi: lastFramePath,
        status: "completed",
        chainSourceShotId: continuityRef?.shotId ?? null,
        chainSourceType: continuityRef?.frameType ?? null,
      })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, anchorFirst: firstFramePath, anchorLastAi: lastFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleFrameGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: mapUpstreamErrorHttpStatus(err) }
    );
  }
}

// --- single_video_generate: synchronous video generation for one shot ---

async function handleSingleVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  enhancePrompts?: boolean
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  if (!shot.anchorFirst || !shotFrameFileOnDisk(shot.anchorFirst)) {
    return NextResponse.json({ error: "首帧文件不存在，请重新生成首帧" }, { status: 400 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const shotCharacters = await getEpisodeCharacters(projectId, shot.episodeId);
  const singleVideoSiblingShots = shot.versionId
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, projectId), eq(shots.versionId, shot.versionId)))
        .orderBy(asc(shots.sequence))
    : shot.episodeId
      ? await db
          .select()
          .from(shots)
          .where(and(eq(shots.projectId, projectId), eq(shots.episodeId, shot.episodeId)))
          .orderBy(asc(shots.sequence))
      : await db
          .select()
          .from(shots)
          .where(eq(shots.projectId, projectId))
          .orderBy(asc(shots.sequence));
  const singleVideoCharacterContext = singleVideoSiblingShots.map(buildShotCharacterText).join("\n");
  const characterDescriptions = shotCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  // Detect crowd shot: no named characters in this shot's text → use reference mode
  const singleVideoShotText = buildShotCharacterText(shot);
  const singleVideoShotChars = filterShotCharacters(singleVideoShotText, shotCharacters, { contextText: singleVideoCharacterContext });
  const isSingleVideoCrowdShot = singleVideoShotChars.length === 0;
  const useSingleVideoReferenceMode = shouldUseFirstFrameVideoMode(shot, isSingleVideoCrowdShot);

  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence, type: dialogues.type })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  // Project visualStyle → style lock tag for video prompt
  const [singleVideoProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const singleVideoVisualStyle = singleVideoProject?.visualStyle || undefined;
  const singleVideoStyleTag = (() => {
    const style = singleVideoProject?.visualStyle;
    if (!style) return undefined;
    return VISUAL_STYLE_PRESETS[style]?.tag || undefined;
  })();

  // 检测是否为 Seedance 协议（走新版多参提示词）
  const videoProtocol = modelConfig?.video?.protocol ?? "";
  const isSeedanceProtocol = videoProtocol === "seedance" || videoProtocol === "doubao";

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    if (!shot.videoUrl && shot.remoteVideoUrl) {
      const resumedPath = await resumeRemoteVideoIfAvailable({
        shotId,
        remoteUrl: shot.remoteVideoUrl,
        remoteStatus: shot.remoteVideoStatus,
        remoteExpiresAt: shot.remoteVideoExpiresAt,
        uploadDir: versionedUploadDir,
      });
      if (resumedPath) {
        return NextResponse.json({ shotId, videoUrl: resumedPath, status: "ok", resumedFromRemoteUrl: true });
      }
    }

    const ratio = (payload?.ratio as string) || "16:9";

    const { videoPrompt: syncedVideoPrompt, refreshed: videoPromptRefreshed } =
      await syncVideoPromptIfStale({
        shot,
        userId,
        projectId,
        deps: { stripBgmContent },
      });
    if (videoPromptRefreshed) {
      console.log(
        `[SingleVideoGenerate] Shot ${shot.sequence}: auto-refreshed videoPrompt (B2 frame fingerprint)`
      );
    }
    const shotForVideo = syncedVideoPrompt
      ? { ...shot, videoPrompt: syncedVideoPrompt }
      : shot;

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

    const { motionText: videoMotionRaw } = resolveVideoMotionAndScene(shotForVideo);
    const resolvedMotionText = stripBgmContent(
      videoMotionRaw || shotForVideo.prompt || "",
      shotForVideo.bgmNote
    );
    const videoContextForDialogue = resolvedMotionText;
    const onScreenDialogueChars = shotDialogues
      .map((d) => shotCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown")
      .filter((name) =>
        isCharacterOnScreen(name, videoContextForDialogue, shotForVideo.startFrameDesc)
      );

    const dialogueList = shotDialogues.map((d) => {
      const char = shotCharacters.find((c) => c.id === d.characterId);
      const characterName = char?.name ?? "Unknown";
      const onScreen = isCharacterOnScreen(
        characterName,
        videoContextForDialogue,
        shotForVideo.startFrameDesc
      );
      const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
      return {
        characterName,
        text: d.text,
        offscreen: !onScreen,
        visualHint,
        voiceHint: char?.voiceHint || undefined,
        type: (d.type as "dialogue" | "os" | "vo") ?? "dialogue",
      };
    });

    const hasPreGeneratedPrompt = !!shotForVideo.videoPrompt;
    const hasVisualFrameAnchors =
      !useSingleVideoReferenceMode &&
      !!shotForVideo.anchorLastAi &&
      shotFrameFileOnDisk(shotForVideo.anchorLastAi);

    // ── Seedance 新格式：@参考N + 音色 + 台词类型 ──────────────────────────────
    let videoPromptBase: string;
    if (!shotForVideo.videoPrompt && isSeedanceProtocol) {
      // 构建角色资产列表（检查是否有音频参考）
      const seedanceSingleAssets: SeedanceAsset[] = [];
      for (const char of singleVideoShotChars) {
        const charAssets = await db
          .select({ audioPath: characterAssets.audioPath })
          .from(characterAssets)
          .where(eq(characterAssets.characterId, char.id));
        const hasAudio = charAssets.some((a) => !!a.audioPath);
        seedanceSingleAssets.push({
          id: char.id,
          name: char.name,
          type: "role",
          voiceHint: char.voiceHint || null,
          hasAudio,
        });
      }

      const seedanceSingleShot: SeedanceShot = {
        hasStoryboardImage: !!shotForVideo.anchorFirst,
        duration: effectiveDuration,
        sceneDescription: shotForVideo.prompt || "",
        cameraDirection: shotForVideo.cameraDirection || null,
        motionScript: resolvedMotionText,
        soundEffect: shotForVideo.soundEffectNote || null,
        dialogues: dialogueList.map((d) => ({
          characterName: d.characterName,
          text: d.text,
          type: d.type,
        })),
      };

      videoPromptBase = stripBgmContent(
        buildSeedanceMultiParamVideoPrompt({
          visualStyle: singleVideoVisualStyle,
          assets: seedanceSingleAssets,
          shots: [seedanceSingleShot],
        }),
        shotForVideo.bgmNote
      );
    } else {
      // 非 Seedance 或已有预生成 prompt → 沿用原有逻辑
      videoPromptBase = stripBgmContent(
        shotForVideo.videoPrompt ||
          (useSingleVideoReferenceMode
            ? buildReferenceVideoPrompt({
                motionText: resolvedMotionText,
                cameraDirection: shotForVideo.cameraDirection || "static",
                duration: effectiveDuration,
                characters: singleVideoShotChars,
                dialogues: dialogueList.length > 0 ? dialogueList : undefined,
                slotContents: videoSlots,
                visualStyleTag: singleVideoStyleTag,
                soundEffectNote: shotForVideo.soundEffectNote,
                slimCharacterSection: true,
              })
            : buildVideoPrompt({
                motionText: resolvedMotionText,
                cameraDirection: shotForVideo.cameraDirection || "static",
                startFrameDesc: shotForVideo.startFrameDesc ?? undefined,
                endFrameDesc: shotForVideo.endFrameDesc ?? undefined,
                duration: effectiveDuration,
                characters: singleVideoShotChars,
                dialogues: dialogueList.length > 0 ? dialogueList : undefined,
                slotContents: videoSlots,
                visualStyleTag: singleVideoStyleTag,
                soundEffectNote: shotForVideo.soundEffectNote,
                hasVisualFrameAnchors,
              })),
        shotForVideo.bgmNote
      );
    }
    const singleVideoTextProvider = (enhancePrompts && !hasPreGeneratedPrompt) ? resolveAIProvider(modelConfig) : null;
    const videoPrompt = enhancePrompts && !hasPreGeneratedPrompt && singleVideoTextProvider
      ? await enhanceVideoPrompt(videoPromptBase, modelConfig?.video?.protocol ?? "", singleVideoTextProvider)
      : videoPromptBase;

    console.log(
      `\n${"=".repeat(80)}\n[SingleVideoGenerate] Shot ${shot.sequence} — FINAL VIDEO PROMPT (sent to model, mode=${useSingleVideoReferenceMode ? "reference" : "keyframe"})\n${"=".repeat(80)}\n${videoPrompt}\n${"=".repeat(80)}\n`
    );

    const resolution = payload?.resolution as "480p" | "720p" | undefined;

    // 首帧模式：initialImage = anchorFirst；首尾帧模式：anchorFirst + 磁盘上存在的 AI anchorLastAi。
    // 角色定妆图不传入视频模型：首帧图已由 Seedream + 定妆图生成，角色外貌已锚定其中；
    // API 规定 first_frame / reference_image 两种模式互斥，混用会丢失首帧强约束。
    const onRemoteResultSingle = async ({ videoUrl, taskId }: { videoUrl: string; taskId?: string | null }) => {
      await db.update(shots).set({
        remoteVideoUrl: videoUrl,
        remoteVideoTaskId: taskId ?? null,
        remoteVideoStatus: "available",
        remoteVideoCreatedAt: new Date(),
        remoteVideoExpiresAt: getRemoteVideoExpiry(),
      }).where(eq(shots.id, shotId));
    };
    const result = await videoProvider.generateVideo(
      useSingleVideoReferenceMode
        ? {
            initialImage: shotForVideo.anchorFirst!,
            prompt: videoPrompt,
            duration: effectiveDuration,
            ratio,
            ...(resolution && { resolution }),
            onRemoteResult: onRemoteResultSingle,
          }
        : {
            anchorFirst: shotForVideo.anchorFirst!,
            anchorLastAi: shotForVideo.anchorLastAi!,
            prompt: videoPrompt,
            duration: effectiveDuration,
            ratio,
            ...(resolution && { resolution }),
            onRemoteResult: onRemoteResultSingle,
          }
    );

    // 把旧视频存入历史（超出 5 条时自动清理最旧文件）
    await saveVideoToHistory(shotId, shot.videoUrl, shot.videoResolution, "重新生成前");

  // 视频真实尾帧只写入 seedance_last_frame（供下一镜链式继承），不覆盖 AI 尾帧 last_frame。
    let singleLastFrameUpdate: Record<string, unknown> = {};
    if (result.lastFrameUrl) {
      try {
        singleLastFrameUpdate = await buildVideoCutPointUpdate({
          remoteLastFrameUrl: result.lastFrameUrl,
          shotId,
          uploadDir: versionedUploadDir,
          existingCutPoint: shot.cutPoint,
          existingAnchorLastAi: shot.anchorLastAi,
        });
        if (Object.keys(singleLastFrameUpdate).length > 0) {
          console.log(
            `[SingleVideoGenerate] Shot ${shotId}: saved video last frame → ${singleLastFrameUpdate.cutPoint}` +
              (useSingleVideoReferenceMode ? " [first-frame mode]" : " [keyframe mode]")
          );
        }
      } catch (frameErr) {
        console.warn(`[SingleVideoGenerate] Shot ${shotId}: failed to save last frame:`, frameErr);
      }
    }

    await db.update(shots)
      .set({ videoUrl: result.filePath, status: "completed", videoResolution: resolution ?? null, ...singleLastFrameUpdate })
      .where(eq(shots.id, shotId));

    const [freshShot] = await db.select().from(shots).where(eq(shots.id, shotId));
    const shotLink = freshShot
      ? await maybeAutoLinkNextShotAfterVideo(
          projectId,
          freshShot,
          shotCharacters,
          singleVideoCharacterContext
        )
      : ({ status: "not_attempted" } satisfies ShotAutoLinkResult);

    return NextResponse.json({ shotId, videoUrl: result.filePath, status: "ok", shotLink });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

// --- video_assemble: synchronous ffmpeg concat + subtitle burn ---

async function handleVideoAssembleSync(projectId: string, payload?: Record<string, unknown>, episodeId?: string) {
  let versionId = payload?.versionId as string | undefined;

  // If no versionId provided, fall back to the latest version for this project/episode
  if (!versionId) {
    const versionWhere = episodeId
      ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
      : eq(storyboardVersions.projectId, projectId);
    const [latestVersion] = await db
      .select({ id: storyboardVersions.id })
      .from(storyboardVersions)
      .where(versionWhere)
      .orderBy(desc(storyboardVersions.versionNum))
      .limit(1);
    versionId = latestVersion?.id;
  }

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (versionId) shotWhereConditions.push(eq(shots.versionId, versionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const projectShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const videoPaths = projectShots.map((s) => s.videoUrl).filter(Boolean) as string[];

  if (videoPaths.length === 0) {
    return NextResponse.json({ error: "No video clips to assemble" }, { status: 400 });
  }

  // Get dialogues for subtitles
  const allDialogues = [];
  for (const shot of projectShots) {
    const shotDialogues = await db
      .select({
        text: dialogues.text,
        characterName: characters.name,
        sequence: dialogues.sequence,
        shotSequence: shots.sequence,
      })
      .from(dialogues)
      .innerJoin(characters, eq(dialogues.characterId, characters.id))
      .innerJoin(shots, eq(dialogues.shotId, shots.id))
      .where(eq(dialogues.shotId, shot.id))
      .orderBy(asc(dialogues.sequence));
    allDialogues.push(...shotDialogues);
  }

  try {
    const outputPath = await assembleVideo({
      videoPaths,
      subtitles: allDialogues.map((d) => ({
        text: `${d.characterName}: ${d.text}`,
        shotSequence: d.shotSequence,
      })),
      projectId,
      shotDurations: projectShots.map((s) => s.duration ?? 10),
    });

    if (episodeId) {
      await db
        .update(episodes)
        .set({ status: "completed", finalVideoUrl: outputPath, updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
    } else {
      await db
        .update(projects)
        .set({ status: "completed", finalVideoUrl: outputPath, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }

    console.log(`[VideoAssemble] Completed: ${outputPath}`);
    return NextResponse.json({ outputPath, status: "ok" });
  } catch (err) {
    console.error("[VideoAssemble] Error:", err);
    return NextResponse.json({ status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

// ─── Generate Video Prompt (single) ──────────────────────────────────────────

async function handleSingleVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  _modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  if (!shotId) return NextResponse.json({ error: "shotId required" }, { status: 400 });

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId)).limit(1);
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });

  try {
    const videoPrompt = await generateAndPersistDirectVideoPrompt({
      shot,
      userId,
      projectId,
      deps: { stripBgmContent },
    });
    console.log(
      `\n${"=".repeat(80)}\n[SingleVideoPrompt] Shot ${shot.sequence} — FINAL VIDEO PROMPT\n${"=".repeat(80)}\n${videoPrompt}\n${"=".repeat(80)}\n`
    );
    return NextResponse.json({ shotId, videoPrompt, status: "ok" });
  } catch (err) {
    console.error("[SingleVideoPrompt] Error:", err);
    return NextResponse.json({ status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

// ─── Generate Video Prompt (batch) ───────────────────────────────────────────

async function handleBatchVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  _modelConfig?: ModelConfig,
  episodeId?: string
) {
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const batchShots = await db.select().from(shots).where(and(...shotWhereConditions)).orderBy(asc(shots.sequence));

  console.log(`[BatchVideoPrompt] processing ${batchShots.length} shots`);
  const bvpStartTime = Date.now();

  const results = await Promise.all(
    batchShots.map(async (shot) => {
      try {
        const videoPrompt = await generateAndPersistDirectVideoPrompt({
          shot,
          userId,
          projectId,
          deps: { stripBgmContent },
        });
        console.log(`[BatchVideoPrompt] Shot ${shot.sequence} done`);
        console.log(`\n${"=".repeat(80)}\n[BatchVideoPrompt] Shot ${shot.sequence}\n${"=".repeat(80)}\n${videoPrompt}\n${"=".repeat(80)}\n`);
        return { shotId: shot.id, status: "ok" };
      } catch (err) {
        console.error(`[BatchVideoPrompt] Shot ${shot.sequence} failed:`, err);
        return { shotId: shot.id, status: "error" };
      }
    })
  );

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  console.log(`[BatchVideoPrompt] Done: ${okCount} ok, ${errCount} errors, total ${((Date.now() - bvpStartTime) / 1000).toFixed(1)}s`);
  return NextResponse.json({ results, status: "ok" });
}

// --- ai_optimize_text: use AI to optimize a text field ---

async function handleAiOptimizeText(
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const originalText = payload?.originalText as string;
  const instruction = payload?.instruction as string;

  if (!originalText || !instruction) {
    return NextResponse.json({ error: "Missing originalText or instruction" }, { status: 400 });
  }
  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const model = createLanguageModel(modelConfig.text);
  const { text } = await generateText({
    model,
    system: `你是一位专业的AI动画内容优化专家。用户会给你一段原始文本和优化指令，请根据指令优化原始文本。
规则：
- 只输出优化后的文本，不要添加任何解释、前言或标记
- 保持原文的语言（中文输入→中文输出）
- 保持原文的整体结构和用途
- 根据优化指令做针对性改进`,
    prompt: `原始文本：
${originalText}

优化指令：
${instruction}

请输出优化后的文本：`,
  });

  return NextResponse.json({ optimizedText: text.trim() });
}

// ── assign_tracks：为当前版本/剧集的分镜自动分配 Track ──────

async function handleAssignTracks(
  projectId: string,
  payload?: Record<string, unknown>,
  episodeId?: string
) {
  const versionId = payload?.versionId as string | undefined;

  // 查询目标分镜（按 sequence 升序）
  const conditions = [eq(shots.projectId, projectId)];
  if (versionId) conditions.push(eq(shots.versionId, versionId));
  if (episodeId) conditions.push(eq(shots.episodeId, episodeId));

  const targetShots = await db
    .select({ id: shots.id, sequence: shots.sequence, duration: shots.duration })
    .from(shots)
    .where(and(...conditions))
    .orderBy(asc(shots.sequence));

  if (targetShots.length === 0) {
    return NextResponse.json({ error: "没有找到分镜" }, { status: 404 });
  }

  // 分组
  const groups = groupShotsIntoTracks(targetShots);
  const trackMap = buildShotTrackMap(groups);

  // 批量更新 track 字段
  for (const [shotId, trackId] of trackMap.entries()) {
    await db.update(shots).set({ track: trackId }).where(eq(shots.id, shotId));
  }

  return NextResponse.json({
    totalShots: targetShots.length,
    totalTracks: groups.length,
    groups: groups.map((g) => ({
      trackId: g.trackId,
      shotCount: g.shots.length,
      totalDuration: g.totalDuration,
    })),
  });
}

// ── batch_video_generate：按 Track 分组批量生成 Seedance 多参视频 ──

async function handleBatchVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  enhancePrompts?: boolean
) {
  const trackId = payload?.trackId as string | undefined;
  const versionId = payload?.versionId as string | undefined;

  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  // 查询当前 track 的所有分镜
  const conditions = [eq(shots.projectId, projectId)];
  if (trackId) conditions.push(eq(shots.track, trackId));
  if (versionId) conditions.push(eq(shots.versionId, versionId));
  if (episodeId) conditions.push(eq(shots.episodeId, episodeId));

  const trackShots = await db
    .select()
    .from(shots)
    .where(and(...conditions))
    .orderBy(asc(shots.sequence));

  if (trackShots.length === 0) {
    return NextResponse.json({ error: "Track 内没有分镜" }, { status: 404 });
  }

  // 查询项目信息（风格）
  const [project] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));

  // 查询台词（含 type 字段）
  const shotIds = trackShots.map((s) => s.id);
  const allDialogues = await db
    .select()
    .from(dialogues)
    .where(inArray(dialogues.shotId, shotIds))
    .orderBy(asc(dialogues.sequence));

  // 构建分镜台词 Map
  const dialoguesByShotId = new Map<string, typeof allDialogues>();
  for (const d of allDialogues) {
    if (!dialoguesByShotId.has(d.shotId)) dialoguesByShotId.set(d.shotId, []);
    dialoguesByShotId.get(d.shotId)!.push(d);
  }

  // 查询出现在这些分镜中的角色（通过台词或 filterShotCharacters）
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const charById = new Map(projectCharacters.map((c) => [c.id, c]));

  // 收集所有涉及的角色（去重）
  const involvedCharIds = new Set<string>();
  for (const d of allDialogues) involvedCharIds.add(d.characterId);

  // 构建 SeedanceAsset 列表（角色部分）
  // 查询每个角色是否有默认定妆图的音频参考（audioPath）
  const seedanceAssets: SeedanceAsset[] = [];
  for (const charId of involvedCharIds) {
    const char = charById.get(charId);
    if (!char) continue;
    // 查询该角色的默认资产（或任意有 audioPath 的资产）
    const charAssetsWithAudio = await db
      .select({ audioPath: characterAssets.audioPath, isDefault: characterAssets.isDefault })
      .from(characterAssets)
      .where(eq(characterAssets.characterId, charId));
    const hasRealAudio = charAssetsWithAudio.some((a) => !!a.audioPath);
    seedanceAssets.push({
      id: char.id,
      name: char.name,
      type: "role",
      voiceHint: char.voiceHint || null,
      hasAudio: hasRealAudio, // true → 生成 @参考N 音频编号，Seedance 音色克隆
    });
  }

  // 构建 SeedanceShot 列表
  const seedanceShots: SeedanceShot[] = trackShots.map((shot) => {
    const shotDialogues = dialoguesByShotId.get(shot.id) ?? [];
    return {
      hasStoryboardImage: !!shot.anchorFirst,
      duration: shot.duration,
      sceneDescription: shot.prompt || "",
      sceneName: null,
      cameraDirection: shot.cameraDirection || null,
      motionScript: shot.motionScript || null,
      soundEffect: shot.soundEffectNote || null,
      storyboardImagePath: shot.anchorFirst || null,
      dialogues: shotDialogues.map((d) => {
        const char = charById.get(d.characterId);
        return {
          characterName: char?.name ?? "未知角色",
          text: d.text,
          type: (d.type as "dialogue" | "os" | "vo") ?? "dialogue",
        };
      }),
    };
  });

  // 生成多参提示词
  const videoPrompt = buildSeedanceMultiParamVideoPrompt({
    visualStyle: project?.visualStyle || undefined,
    assets: seedanceAssets,
    shots: seedanceShots,
  });

  // ── 收集多模态参考文件（顺序必须与 buildRefEntries/@参考N 编号完全一致）──
  // Toonflow 规范：API content 数组 = 图片先行（reference_image）+ 音频殿后（reference_audio）
  // buildRefEntries 已更新为同样的三轮顺序，此处收集逻辑必须同步。
  const videoProvider = resolveVideoProvider(modelConfig);

  // 第一轮：角色定妆图（按 seedanceAssets 输入顺序）
  const charImageRefs: Array<{ type: "image"; path: string }> = [];
  const charAudioRefs: Array<{ type: "audio"; path: string }> = [];

  for (const asset of seedanceAssets) {
    if (asset.type !== "role") continue;
    const char = charById.get(asset.id);
    if (!char) continue;

    // 默认定妆图
    const [defaultAsset] = await db
      .select()
      .from(characterAssets)
      .where(and(eq(characterAssets.characterId, char.id), eq(characterAssets.isDefault, 1)))
      .limit(1);
    if (defaultAsset?.imagePath && shotFrameFileOnDisk(defaultAsset.imagePath)) {
      charImageRefs.push({ type: "image", path: defaultAsset.imagePath });
    }

    // 音频参考（第三轮暂存，保持与图片相同的角色顺序）
    if (asset.hasAudio) {
      const audioAsset = await db
        .select({ audioPath: characterAssets.audioPath })
        .from(characterAssets)
        .where(eq(characterAssets.characterId, char.id))
        .then((rows) => rows.find((r) => !!r.audioPath));
      if (audioAsset?.audioPath) {
        charAudioRefs.push({ type: "audio", path: audioAsset.audioPath });
      }
    }
  }

  // 第二轮：分镜首帧（跳过文件缺失的分镜，与 SeedanceShot.hasStoryboardImage 一致）
  const storyboardImageRefs: Array<{ type: "image"; path: string }> = [];
  for (const shot of trackShots) {
    if (shot.anchorFirst && shotFrameFileOnDisk(shot.anchorFirst)) {
      storyboardImageRefs.push({ type: "image", path: shot.anchorFirst });
    }
  }

  // 合并：图片先行（角色图 → 分镜首帧），音频殿后（角色音频）
  const multimodalRefs = [
    ...charImageRefs,
    ...storyboardImageRefs,
    ...charAudioRefs,
  ];

  if (multimodalRefs.filter((r) => r.type === "image").length === 0) {
    return NextResponse.json(
      { error: "批量生成需要至少一张角色定妆图或分镜首帧（请先为角色上传定妆图或生成分镜首帧）" },
      { status: 400 }
    );
  }

  // 同步更新 SeedanceShot.hasStoryboardImage（确保与实际文件状态一致）
  for (const shot of seedanceShots) {
    const idx = seedanceShots.indexOf(shot);
    const trackShot = trackShots[idx];
    if (trackShot) {
      shot.hasStoryboardImage = !!trackShot.anchorFirst && shotFrameFileOnDisk(trackShot.anchorFirst);
    }
  }

  // 提交给视频模型（Seedance 多模态参考模式）
  const totalDuration = trackShots.reduce((sum, s) => sum + s.duration, 0);

  const videoResult = await videoProvider.generateVideo({
    prompt: videoPrompt,
    duration: Math.min(totalDuration, 15),
    ratio: (payload?.ratio as string) || "16:9",
    multimodalRefs,
  });

  const localVideoPath = videoResult.filePath;

  // A+B 并存策略：
  // A — 每镜 shot.videoUrl 写同一个 Track 视频路径，分镜卡可预览、素材库可加载
  // B — track_videos 表额外写一条，剪辑台可按 track 整段导入
  for (const shot of trackShots) {
    await db.update(shots).set({ videoUrl: localVideoPath }).where(eq(shots.id, shot.id));
  }

  await db.insert(trackVideos).values({
    id: ulid(),
    projectId,
    episodeId: episodeId ?? null,
    versionId: versionId ?? null,
    trackId: trackId ?? "T_unknown",
    videoUrl: localVideoPath,
    totalDuration: Math.round(totalDuration),
    shotCount: trackShots.length,
  });

  return NextResponse.json({
    trackId,
    shotCount: trackShots.length,
    totalDuration,
    videoUrl: localVideoPath,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 场景自动提取（从本集分镜推导独立场景地点）
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// 场景自动提取（从本集分镜推导独立场景地点）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 扫描本集所有分镜的 prompt，调 LLM 识别独立场景地点并生成标准化描述。
 * 返回候选场景列表（不自动创建，由前端让用户勾选后再批量 POST）。
 */

// ─── split_shot：将单个分镜拆成两个连续分镜 ───────────────

async function handleSplitShot(
  projectId: string,
  userId: string,
  payload: Record<string, unknown> | undefined,
  modelConfig: ModelConfig | undefined,
  episodeId: string | undefined,
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "缺少 shotId" }, { status: 400 });
  }

  const textProvider = resolveAIProvider(modelConfig);

  // 查询原始分镜
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot || shot.projectId !== projectId) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }

  // 查询原始分镜的台词（带角色名）
  const originalDialogues = await db
    .select({
      text: dialogues.text,
      type: dialogues.type,
      characterName: characters.name,
      sequence: dialogues.sequence,
    })
    .from(dialogues)
    .innerJoin(characters, eq(dialogues.characterId, characters.id))
    .where(eq(dialogues.shotId, shotId))
    .orderBy(dialogues.sequence);

  const dialoguesBlock = originalDialogues.length > 0
    ? `- 台词列表（必须分配到两个子分镜中，禁止丢弃）：\n` +
      originalDialogues
        .map((d) => `  [${d.type}] ${d.characterName}："${d.text}"`)
        .join("\n")
    : `- 台词：（无）`;

  // 构建用户消息
  const userMessage = [
    `原始分镜（需要拆分为两个）：`,
    `- 场景描述：${shot.prompt || "（无）"}`,
    `- 首帧：${shot.startFrameDesc || "（无）"}`,
    `- 尾帧：${shot.endFrameDesc || "（无）"}`,
    `- 动作脚本：${shot.motionScript || "（无）"}`,
    `- 时长：${shot.duration}s`,
    `- 运镜：${shot.cameraDirection || "（无）"}`,
    `- 音效：${shot.soundEffectNote || "（无）"}`,
    dialoguesBlock,
    ``,
    `拆分提示：${(payload?.hint as string | undefined) || "请在合适的叙事转折点拆分，确保每个分镜的首帧都包含该分镜主要角色。"}`,
  ].join("\n");

  let rawResponse: string;
  try {
    rawResponse = await textProvider.generateText(userMessage, {
      systemPrompt: SPLIT_SHOT_SINGLE_SYSTEM,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `AI 生成失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  // 解析 JSON
  let splitShots: unknown[];
  try {
    const extracted = JSON.parse(extractJSON(rawResponse));
    if (!Array.isArray(extracted) || extracted.length !== 2) {
      throw new Error("LLM 返回的不是包含 2 个元素的数组");
    }
    splitShots = extracted;
  } catch (err) {
    return NextResponse.json(
      { error: `解析 AI 响应失败: ${err instanceof Error ? err.message : String(err)}`, raw: rawResponse },
      { status: 500 }
    );
  }

  // 将原分镜之后所有分镜的 sequence +1，为两个新分镜腾出位置
  // 新分镜 A 占 shot.sequence，新分镜 B 占 shot.sequence + 1
  // episodeId 必须精确匹配（包括 null）：null 时用 isNull() 避免条件被省略导致跨剧集误移
  await db
    .update(shots)
    .set({ sequence: sql`${shots.sequence} + 1` })
    .where(and(
      eq(shots.versionId, shot.versionId!),
      gt(shots.sequence, shot.sequence),
      shot.episodeId ? eq(shots.episodeId, shot.episodeId) : isNull(shots.episodeId),
    ));

  const newShots = [];
  for (let i = 0; i < 2; i++) {
    const s = splitShots[i] as Record<string, unknown>;
    const dialogueList = Array.isArray(s.dialogues) ? s.dialogues : [];
    const newShotId = ulid();
    const [inserted] = await db.insert(shots).values({
      id: newShotId,
      projectId,
      versionId: shot.versionId,
      episodeId: shot.episodeId,
      sequence: shot.sequence + i,
      duration: typeof s.duration === "number" ? s.duration : shot.duration / 2,
      prompt: typeof s.sceneDescription === "string" ? s.sceneDescription : null,
      startFrameDesc: typeof s.startFrame === "string" ? s.startFrame : null,
      endFrameDesc: typeof s.endFrame === "string" ? s.endFrame : null,
      motionScript: typeof s.motionScript === "string" ? s.motionScript : null,
      soundEffectNote: typeof s.soundEffect === "string" ? s.soundEffect : null,
      cameraDirection: typeof s.cameraDirection === "string" ? s.cameraDirection : null,
    }).returning();
    newShots.push(inserted);

    // 插入台词
    for (let di = 0; di < dialogueList.length; di++) {
      const d = dialogueList[di] as Record<string, unknown>;
      if (typeof d.text !== "string" || !d.text.trim()) continue;
      // 尝试匹配角色 ID（按名称模糊匹配）
      const charName = typeof d.character === "string" ? d.character.trim() : "";
      const [matchedChar] = charName
        ? await db
            .select({ id: characters.id })
            .from(characters)
            .where(and(eq(characters.projectId, projectId), eq(characters.name, charName)))
            .limit(1)
        : [undefined];
      if (!matchedChar) continue;
      await db.insert(dialogues).values({
        id: ulid(),
        shotId: newShotId,
        characterId: matchedChar.id,
        text: d.text.trim(),
        sequence: di,
        type: typeof d.type === "string" && ["dialogue", "os", "vo"].includes(d.type) ? d.type as "dialogue" | "os" | "vo" : "dialogue",
      });
    }
  }

  // 删除原分镜
  await db.delete(shots).where(eq(shots.id, shotId));

  return NextResponse.json({
    success: true,
    originalShotId: shotId,
    newShots,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 定妆图多角度扩展（expand_character_asset）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从一张正面定妆图自动生成 3/4 侧面、正侧面、背面三个角度变体。
 * 角度变体写入 character_assets 表（angle 字段标记，sourceAssetId 指向来源）。
 * 已存在同角度资产时跳过，不重复生成。
 */
async function handleExpandCharacterAsset(
  projectId: string,
  _userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const assetId = payload?.assetId as string | undefined;
  if (!assetId) {
    return NextResponse.json({ error: "No assetId provided" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  // 查询源资产
  const [sourceAsset] = await db
    .select()
    .from(characterAssets)
    .where(eq(characterAssets.id, assetId));
  if (!sourceAsset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if (!sourceAsset.imagePath) {
    return NextResponse.json({ error: "Asset has no image" }, { status: 400 });
  }
  if (!fs.existsSync(sourceAsset.imagePath)) {
    return NextResponse.json({ error: "Asset image file not found on disk" }, { status: 400 });
  }

  // 查询所属角色
  const [character] = await db
    .select({ id: characters.id, name: characters.name, description: characters.description, visualHint: characters.visualHint })
    .from(characters)
    .where(eq(characters.id, sourceAsset.characterId));
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  // 查询项目画风
  const [project] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const visualStyle = project?.visualStyle ?? "anime_2d";
  const visualStyleTag = VISUAL_STYLE_PRESETS[visualStyle]?.tag ?? "";

  const uploadDir = path.join(process.env.UPLOAD_DIR ?? "./uploads", "projects", projectId, "characters");
  const aiImg = resolveImageProvider(modelConfig, uploadDir);

  const angles: Array<{ angle: string; prompt: string }> = [
    {
      angle: "3q",
      prompt: [
        `【画面】${character.name}，3/4侧面视角（从左前方约45度），身体姿势自然直立，展示面部轮廓与发型侧面细节。严格保持参考图@图1中的服装款式、颜色、发型颜色与样式、面部特征，不得添加任何原图没有的道具或配饰。`,
        `【背景】纯白色背景，character design sheet，全身图`,
        `【风格】${visualStyleTag}，角色设计图规格，禁止画外字幕、水印、UI文字`,
      ].join("\n"),
    },
    {
      angle: "profile",
      prompt: [
        `【画面】${character.name}，正侧面视角（从左方90度），身体姿势自然直立，展示面部轮廓、耳朵、鼻梁结构与发型侧面。严格保持参考图@图1中的服装款式、颜色、发型颜色与样式、面部特征。`,
        `【背景】纯白色背景，character design sheet，全身图`,
        `【风格】${visualStyleTag}，角色设计图规格，禁止画外字幕、水印、UI文字`,
      ].join("\n"),
    },
    {
      angle: "back",
      prompt: [
        `【画面】${character.name}，背面视角（从后方180度），展示发型背面、服装背面细节。严格保持参考图@图1中的服装颜色与样式、发型颜色与样式，不得添加任何原图没有的道具。`,
        `【背景】纯白色背景，character design sheet，全身图`,
        `【风格】${visualStyleTag}，角色设计图规格，禁止画外字幕、水印、UI文字`,
      ].join("\n"),
    },
  ];

  const generated: Array<{ id: string; angle: string; imagePath: string }> = [];

  for (const { angle, prompt } of angles) {
    // 已存在同角度资产则跳过
    const [existing] = await db
      .select({ id: characterAssets.id })
      .from(characterAssets)
      .where(
        and(
          eq(characterAssets.characterId, character.id),
          eq(characterAssets.tag, sourceAsset.tag),
          eq(characterAssets.angle, angle)
        )
      )
      .limit(1);

    if (existing) {
      console.log(`[ExpandCharacterAsset] Skipping existing angle=${angle} for asset ${assetId}`);
      continue;
    }

    try {
      const imagePath = await aiImg.generateImage(prompt, {
        referenceImages: [sourceAsset.imagePath],
        quality: "hd",
      });

      const newId = ulid();
      await db.insert(characterAssets).values({
        id: newId,
        characterId: character.id,
        imagePath,
        tag: sourceAsset.tag,
        isDefault: 0,
        assetType: "morph",
        angle,
        sourceAssetId: assetId,
      });
      generated.push({ id: newId, angle, imagePath });
    } catch (err) {
      console.error(`[ExpandCharacterAsset] Failed to generate angle=${angle}:`, err);
    }
  }

  return NextResponse.json({ success: true, generated });
}
