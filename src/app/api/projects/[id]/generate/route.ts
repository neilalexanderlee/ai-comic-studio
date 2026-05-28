import { NextResponse } from "next/server";
import { streamText, generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes, characters, shots, dialogues, storyboardVersions, episodeCharacters, characterAssets } from "@/lib/db/schema";
import { eq, asc, and, lt, gt, desc, inArray } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import fs from "node:fs";
import path from "path";
import { ulid } from "ulid";
import { enqueueTask } from "@/lib/task-queue";
import type { TaskType } from "@/lib/task-queue";
import { buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { buildScriptGeneratePrompt } from "@/lib/ai/prompts/script-generate";
import { buildCharacterExtractPrompt, buildCharacterNameExtractionPrompt, CHARACTER_NAME_EXTRACTION_SYSTEM, resolveCharacterExtractSystemPrompt } from "@/lib/ai/prompts/character-extract";
import {
  buildSingleShotRewriteUserPrompt,
  resolveSingleShotRewriteSystem,
} from "@/lib/ai/prompts/single-shot-rewrite";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/visual-style-presets";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";
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
import { resolveFrameMode } from "@/lib/storyboard/frame-generation-strategy";
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
  generateAndPersistVisionVideoPrompt,
  syncVideoPromptIfStale,
} from "@/lib/storyboard/shot-video-prompt-sync.server";
import { resolveDeprecatedGenerateAction } from "@/lib/storyboard/generate-route-deprecations";
import { buildVideoCutPointUpdate } from "@/lib/storyboard/video-cut-point";

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
 * in the videoScript or startFrameDesc fields.
 *
 * Matching strategy (tolerant of age/descriptor suffixes):
 *   1. Full name match — "龙渊（10岁）" in text
 *   2. Base name match — strip （…） suffix → "龙渊" in text
 *   3. Fallback: assume on-screen if the text is non-empty (better than
 *      wrongly marking a named character as off-screen)
 */
function isCharacterOnScreen(
  characterName: string,
  videoScript: string,
  startFrameDesc: string | null | undefined
): boolean {
  if (!characterName) return false;
  const text = `${videoScript} ${startFrameDesc ?? ""}`;
  if (!text.trim()) return false;
  if (text.includes(characterName)) return true;
  // Strip trailing parenthetical descriptor, e.g. "龙渊（10岁）" → "龙渊"
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

/**
 * 确保视频提示词中始终包含来自 DB 的最新对白。
 *
 * 当 videoPrompt 是预生成的（Step 6）时，可能：
 * 1. 对白在 DB 中后续被修改，与 videoPrompt 不同步
 * 2. LLM 生成时忘记附加对白
 * 3. 对白生成时系统版本较旧，没有对白注入逻辑
 *
 * 此函数先剥离已有的对白/画外音行，再用最新 dialogueList 重新附加，保证一致性。
 * 若 dialogueList 为空，原样返回。
 */
function ensureDialoguesInPrompt(
  prompt: string,
  dialogueList: Array<{
    characterName: string;
    text: string;
    offscreen?: boolean;
    visualHint?: string;
    voiceHint?: string;
  }>
): string {
  if (!dialogueList.length) return prompt;
  // 剥离已有对白区块（NOTE 行 + 对白行）
  // 同时清理 LLM 嵌入正文末尾的行中标签（不带前导 \n 的情况）
  let base = prompt
    .replace(/\nNOTE: The following are the ONLY lines[^\n]*/g, "")
    .replace(/【对白口型】[^\n]*/g, "")   // 行中 + 行首均清理
    .replace(/【画外音】[^\n]*/g, "")     // 行中 + 行首均清理
    .replace(/\n{3,}/g, "\n\n")           // 清理后可能出现连续空行，合并
    .trimEnd();
  // 重新附加最新对白
  base +=
    "\n\nNOTE: The following are the ONLY lines of speech. Do not repeat or infer additional dialogue from the scene description above.";
  for (const d of dialogueList) {
    if (d.offscreen) {
      const voiceSuffix = d.voiceHint ? `（${d.voiceHint}）` : "";
      base += `\n【画外音】${d.characterName}${voiceSuffix}: "${d.text}"`;
    } else {
      const visualPart = d.visualHint ? `（${d.visualHint}）` : "";
      const voicePart = d.voiceHint ? `，声音属性：${d.voiceHint}` : "";
      base += `\n【对白口型】${d.characterName}${visualPart}${voicePart}: "${d.text}"`;
    }
  }
  return base;
}

function buildShotCharacterText(shot: {
  prompt?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
  videoScript?: string | null;
}): string {
  return [
    shot.prompt,
    shot.startFrameDesc,
    shot.endFrameDesc,
    shot.motionScript,
    shot.videoScript,
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

  if (action === "single_shot_rewrite") {
    return handleSingleShotRewrite(
      projectId,
      userId,
      payload,
      resolvedModelConfig,
      episodeId
    );
  }

  if (action === "single_shot_restore_from_script") {
    return handleSingleShotRestoreFromScript(projectId, payload, episodeId);
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



  if (action === "video_assemble") {
    return handleVideoAssembleSync(projectId, payload, episodeId);
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
    videoScript?: string;
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
      const prompt = buildShotSplitPrompt(chunk, characterDescriptions, characterVisualHints, chunkTargetDuration, splitVisualStyleTag, videoMaxDuration);
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
      videoScript: shot.videoScript ?? null,
      cameraDirection: shot.cameraDirection || "static",
      duration: shot.duration,
      dialogues: shot.dialogues,
    })),
    existingVersionId: verifiedTargetVersionId,
  });

  console.log(`[ShotSplit] Created ${allShots.length} shots from ${sceneChunks.length} chunks, version=${persistedVersionId}${verifiedTargetVersionId ? ` (reused version ${verifiedTargetVersionId})` : ""}`);

  return NextResponse.json({ shots: allShots.length, versionId: persistedVersionId });
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
    videoScript: scriptShot.videoScript ?? shot.videoScript,
    motionScript: scriptShot.motionScript ?? shot.motionScript,
    cameraDirection: scriptShot.cameraDirection ?? shot.cameraDirection,
    duration: scriptShot.duration ?? shot.duration,
    bgmNote: scriptShot.bgmNote ?? null,
    soundEffectNote: scriptShot.soundEffectNote ?? null,
  }).where(eq(shots.id, shotId));

  console.log(`[RestoreFromScript] Shot ${shot.sequence} text fields restored from script`);
  return NextResponse.json({ shotId, status: "ok", sequence: shot.sequence });
}

// --- single_shot_rewrite: regenerate text fields for one shot ---

async function handleSingleShotRewrite(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const shotEpisodeId = episodeId || shot.episodeId;
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);
  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}${c.visualHint ? `【${c.visualHint}】` : ""}: ${c.description}`)
    .join("\n");
  const [rewriteProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const rewriteVisualStyleTag = (() => {
    const style = rewriteProject?.visualStyle;
    if (!style) return undefined;
    return VISUAL_STYLE_PRESETS[style]?.tag || undefined;
  })();

  const model = createLanguageModel(modelConfig.text);

  const hasNamedChars = characterDescriptions.length > 0;

  const system = await resolveSingleShotRewriteSystem(
    { userId, projectId },
    rewriteVisualStyleTag
  );
  const userPrompt = buildSingleShotRewriteUserPrompt({
    sequence: shot.sequence,
    duration: shot.duration ?? 10,
    prompt: shot.prompt,
    startFrameDesc: shot.startFrameDesc,
    endFrameDesc: shot.endFrameDesc,
    motionScript: shot.motionScript,
    videoScript: shot.videoScript,
    cameraDirection: shot.cameraDirection,
    characterDescriptions,
    hasNamedChars,
  });

  console.log(
    `[SingleShotRewrite] Shot ${shot.sequence} system=${system.length} user=${userPrompt.length}`
  );

  try {
    const { text } = await import("ai").then(({ generateText }) =>
      generateText({ model, system, prompt: userPrompt, temperature: 0.7 })
    );

    const parsed = JSON.parse(extractJSON(text)) as {
      startFrameDesc: string;
      endFrameDesc: string;
      motionScript: string;
      videoScript?: string;
      cameraDirection: string;
    };

    await db
      .update(shots)
      .set({
        // prompt（场景描述）来自用户剧本，不在此处覆盖
        startFrameDesc: parsed.startFrameDesc,
        endFrameDesc: parsed.endFrameDesc,
        motionScript: parsed.motionScript,
        videoScript: parsed.videoScript ?? null,
        cameraDirection: parsed.cameraDirection,
      })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, status: "ok", ...parsed });
  } catch (err) {
    console.error(`[SingleShotRewrite] Error for shot ${shotId}:`, err);
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
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

  const characterDescriptions = charsForFrame
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const resolvedChars = await resolveCharacterImages(
    shot.prompt || "",
    charsForFrame,
    modelConfig?.text,
    userId,
    projectId
  );
  await saveShotWarnings(shotId, resolvedChars);
  const charRefImages = resolvedChars.map((c) => c.imagePath);

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

  // frameTarget: "first" = only regenerate anchorFirst; "last" = only anchorLastAi; "both" = default
  const frameTarget = (payload?.frameTarget as "first" | "last" | "both") ?? "both";

  const rawFrameRef = payload?.frameReference as Partial<FrameReferencePayload> | undefined;
  let continuityRef:
    | { path: string; shotId: string; frameType: FrameReferenceType; sourceSequence: number }
    | undefined;
  if (rawFrameRef?.shotId && rawFrameRef?.frameType) {
    const frameType = rawFrameRef.frameType;
    if (
      frameType !== "anchor_first" &&
      frameType !== "anchor_last_ai" &&
      frameType !== "cut_point"
    ) {
      return NextResponse.json({ error: "无效的 frameReference.frameType" }, { status: 400 });
    }
    const resolved = await resolveFrameReferenceForProject(projectId, {
      shotId: rawFrameRef.shotId,
      frameType,
    });
    if (!resolved) {
      return NextResponse.json(
        { error: "参考帧不存在或文件已缺失，请重新生成该镜画面或换一张参考图" },
        { status: 400 }
      );
    }
    continuityRef = resolved;
  }

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const generateAnchorFirst = async (): Promise<string> => {
      const refImages = continuityRef
        ? [continuityRef.path, ...charRefImages]
        : charRefImages;
      const firstPromptRaw = buildFirstFramePrompt(
        pickFirstFramePromptBuildParams({
          shot,
          characterDescriptions: characterDescriptionsWithHints,
          namedCharacterCount: charsForFrame.length,
          hasContinuityReference: !!continuityRef,
          hasCharacterSheetRefs: !continuityRef && charRefImages.length > 0,
          visualStyleTag: singleVisualStyleTag,
          cameraDirection: singleCleanedCamera,
          slotContents: frameFirstSlots,
        })
      );
      const firstPrompt = enhancePrompts && singleTextProvider
        ? await enhanceImagePrompt(firstPromptRaw, singleImageProtocol, singleTextProvider)
        : firstPromptRaw;
      if (continuityRef) {
        console.log(
          `[SingleFrameGenerate] Shot ${shot.sequence}: frameReference ${frameReferenceContinuityLabel(
            continuityRef.sourceSequence,
            continuityRef.frameType
          )} → Seedream regen anchor_first`
        );
      }
      console.log(
        `[SingleFrameGenerate][PROMPT DEBUG] shotId=${shotId} visualStyleTag=${JSON.stringify(singleVisualStyleTag)} charRefs=${refImages.length}`
      );
      console.log(`[SingleFrameGenerate][PROMPT DEBUG] finalPrompt:\n${firstPrompt}`);
      return ai.generateImage(firstPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: refImages,
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
      const lastPromptRaw = buildLastFramePrompt(
        pickLastFramePromptBuildParams({
          shot,
          characterDescriptions: characterDescriptionsWithHints,
          namedCharacterCount: charsForFrame.length,
          hasAnchorFirst: true,
          hasCharacterSheetRefs: charRefImages.length > 0,
          visualStyleTag: singleVisualStyleTag,
          cameraDirection: singleCleanedCamera,
          slotContents: frameLastSlots,
        })
      );
      const lastPrompt = enhancePrompts && singleTextProvider
        ? await enhanceImagePrompt(lastPromptRaw, singleImageProtocol, singleTextProvider)
        : lastPromptRaw;
      const lastFramePath = await ai.generateImage(lastPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: [existingFirstFrame, ...charRefImages],
      });
      await db
        .update(shots)
        .set({ anchorLastAi: lastFramePath, status: "completed" })
        .where(eq(shots.id, shotId));
      return NextResponse.json({ shotId, anchorLastAi: lastFramePath, status: "ok" });
    }

    // frameTarget === "both" (default) — 首帧仅 Seedream 生成；参考图仅来自 payload.frameReference
    const firstFramePath = await generateAnchorFirst();

    // Intelligent frame strategy: decide whether to generate the last frame.
    // When frameTarget is "both" (user clicked "重新生成帧"), base the decision on
    // how many frames the shot already has:
    //   - both anchorFirst + anchorLastAi exist → regenerate both
    //   - only anchorFirst exists (anchorLastAi was never generated) → regenerate first only
    //   - neither exists yet → fall back to resolveFrameMode heuristic
    const singleFrameDecision: { mode: "both" | "first_only"; source: string; reason: string } =
      shot.anchorLastAi
        ? { mode: "both", source: "existing_frames", reason: "both frames existed — regenerate both" }
        : shot.anchorFirst
          ? { mode: "first_only", source: "existing_frames", reason: "only first frame existed — skip last frame" }
          : await resolveFrameMode(
              {
                duration: shot.duration,
                cameraDirection: singleCleanedCamera ?? null,
                startFrameDesc: shot.startFrameDesc,
                endFrameDesc: shot.endFrameDesc,
                prompt: shot.prompt,
              },
              charsForFrame.length > 0,
              enhancePrompts ? modelConfig?.text ?? null : null
            );

    if (singleFrameDecision.mode === "first_only") {
      console.log(
        `[SingleFrameGenerate] Shot ${shot.sequence}: first_only` +
        ` (${singleFrameDecision.source}: ${singleFrameDecision.reason})`
      );
      await persistAnchorFirst(firstFramePath);
      return NextResponse.json({ shotId, anchorFirst: firstFramePath, status: "ok" });
    }

    // Both frames: generate anchorLastAi
    const lastPromptRaw = buildLastFramePrompt(
      pickLastFramePromptBuildParams({
        shot,
        characterDescriptions: characterDescriptionsWithHints,
        namedCharacterCount: charsForFrame.length,
        hasAnchorFirst: true,
        hasCharacterSheetRefs: charRefImages.length > 0,
        visualStyleTag: singleVisualStyleTag,
        cameraDirection: singleCleanedCamera,
        slotContents: frameLastSlots,
      })
    );
    const lastPrompt = enhancePrompts && singleTextProvider
      ? await enhanceImagePrompt(lastPromptRaw, singleImageProtocol, singleTextProvider)
      : lastPromptRaw;
    const lastFramePath = await ai.generateImage(lastPrompt, {
      ...imageOpts,
      quality: "hd",
      referenceImages: [firstFramePath, ...charRefImages],
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
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
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
  const singleVideoStyleTag = (() => {
    const style = singleVideoProject?.visualStyle;
    if (!style) return undefined;
    return VISUAL_STYLE_PRESETS[style]?.tag || undefined;
  })();

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

    const videoPromptSyncDeps = {
      stripBgmContent,
      ensureDialoguesInPrompt,
      isCharacterOnScreen,
      stripThinkingBlocks,
    };

    const { videoPrompt: syncedVideoPrompt, refreshed: videoPromptRefreshed } =
      await syncVideoPromptIfStale({
        shot,
        shotCharacters,
        shotDialogues,
        modelConfig,
        userId,
        projectId,
        deps: videoPromptSyncDeps,
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

    const videoScript = stripBgmContent(
      shotForVideo.videoScript || shotForVideo.motionScript || shotForVideo.prompt || "",
      shotForVideo.bgmNote
    );
    const videoContextForDialogue = videoScript;
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
      };
    });
    // If the user already ran "generate video prompt" (Step 7), shot.videoPrompt is a
    // vision-informed, model-specific prompt — but we still need to:
    //   1. Strip any BGM language the LLM may have included (was based on old motionScript w/ BGM)
    //   2. Inject fresh dialogues from DB (pre-generated prompt may be stale or LLM may have omitted them)
    const hasPreGeneratedPrompt = !!shotForVideo.videoPrompt;
    const hasVisualFrameAnchors =
      !useSingleVideoReferenceMode &&
      !!shotForVideo.anchorLastAi &&
      shotFrameFileOnDisk(shotForVideo.anchorLastAi);
    const videoPromptBase = stripBgmContent(
      shotForVideo.videoPrompt ||
        (useSingleVideoReferenceMode
          ? buildReferenceVideoPrompt({
              videoScript,
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
              videoScript,
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
    const singleVideoTextProvider = (enhancePrompts && !hasPreGeneratedPrompt) ? resolveAIProvider(modelConfig) : null;
    const videoPromptEnhanced = enhancePrompts && !hasPreGeneratedPrompt && singleVideoTextProvider
      ? await enhanceVideoPrompt(videoPromptBase, modelConfig?.video?.protocol ?? "", singleVideoTextProvider)
      : videoPromptBase;
    // 始终用 DB 最新对白覆盖 prompt 中的对白区块（处理预生成 prompt 过期的情况）
    const videoPrompt = ensureDialoguesInPrompt(videoPromptEnhanced, dialogueList);

    console.log(
      `\n${"=".repeat(80)}\n[SingleVideoGenerate] Shot ${shot.sequence} — FINAL VIDEO PROMPT (sent to model, mode=${useSingleVideoReferenceMode ? "reference" : "keyframe"})\n${"=".repeat(80)}\n${videoPrompt}\n${"=".repeat(80)}\n`
    );

    const resolution = payload?.resolution as "480p" | "720p" | undefined;

    // 首帧模式：initialImage = anchorFirst；首尾帧模式：anchorFirst + 磁盘上存在的 AI anchorLastAi。
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
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  console.log(`[SingleVideoPrompt] called, shotId=${shotId}`);
  if (!shotId) return NextResponse.json({ error: "shotId required" }, { status: 400 });

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId)).limit(1);
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });

  const visionFrames = collectVisionFramePaths(shot);
  console.log(`[SingleVideoPrompt] shot.sequence=${shot.sequence}, frames=${visionFrames.length}`);
  if (visionFrames.length === 0) {
    return NextResponse.json({ error: "No frame available. Generate frames first." }, { status: 400 });
  }

  // 使用集绑定角色（而非全量项目角色），确保幼年集只选幼年变体
  const shotCharacters = await getEpisodeCharacters(shot.projectId, shot.episodeId);
  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  try {
    const videoPrompt = await generateAndPersistVisionVideoPrompt({
      shot,
      shotCharacters,
      shotDialogues,
      modelConfig,
      userId,
      projectId,
      deps: {
        stripBgmContent,
        ensureDialoguesInPrompt,
        isCharacterOnScreen,
        stripThinkingBlocks,
      },
    });
    console.log(
      `\n${"=".repeat(80)}\n[SingleVideoPrompt] Shot ${shot.sequence} — FINAL VIDEO PROMPT (saved to DB)\n${"=".repeat(80)}\n${videoPrompt}\n${"=".repeat(80)}\n`
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
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const batchShots = await db.select().from(shots).where(and(...shotWhereConditions)).orderBy(asc(shots.sequence));

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  const eligible = batchShots.filter((s) => collectVisionFramePaths(s).length > 0);

  console.log(`[BatchVideoPrompt] Processing ${eligible.length} shots (${batchShots.length} total, ${batchCharacters.length} chars)`);
  const bvpStartTime = Date.now();

  const results = await Promise.all(
    eligible.map(async (shot) => {
      try {
        const shotStart = Date.now();
        const visionFrames = collectVisionFramePaths(shot);
        if (visionFrames.length === 0) {
          return { shotId: shot.id, sequence: shot.sequence, status: "error" as const, error: "No frame on disk" };
        }
        const shotDialogues = await db
          .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
          .from(dialogues)
          .where(eq(dialogues.shotId, shot.id))
          .orderBy(asc(dialogues.sequence));
        const videoPrompt = await generateAndPersistVisionVideoPrompt({
          shot,
          shotCharacters: batchCharacters,
          shotDialogues,
          modelConfig,
          userId,
          projectId,
          deps: {
            stripBgmContent,
            ensureDialoguesInPrompt,
            isCharacterOnScreen,
            stripThinkingBlocks,
          },
        });
        console.log(`\n${"=".repeat(80)}\n[BatchVideoPrompt] Shot ${shot.sequence} — FINAL VIDEO PROMPT (saved to DB)\n${"=".repeat(80)}\n${videoPrompt}\n${"=".repeat(80)}\n`);
        console.log(`[BatchVideoPrompt] Shot ${shot.sequence} done (${((Date.now() - shotStart) / 1000).toFixed(1)}s, ${visionFrames.length} frames)`);
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
