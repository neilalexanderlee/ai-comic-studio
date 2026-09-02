import { NextResponse } from "next/server";
import { streamText, generateText, tool, stepCountIs } from "ai";
import { jsonSchema } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes, characters, shots, storyboardVersions, episodeCharacters, characterAssets, trackVideos } from "@/lib/db/schema";
import { eq, asc, and, lt, gt, desc, inArray, isNull, sql } from "drizzle-orm";
import { groupShotsIntoTracks, buildShotTrackMap } from "@/lib/storyboard/track-grouping";
import { buildSeedanceMultiParamVideoPrompt, type SeedanceAsset, type SeedanceShot } from "@/lib/ai/prompts/seedance-multi-param";
import { superviseShots, checkBeatDensity } from "@/lib/storyboard/shot-supervision";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import fs from "node:fs";
import path from "path";
import { ulid } from "ulid";
import { enqueueTask } from "@/lib/task-queue";
import type { TaskType } from "@/lib/task-queue";
import { buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { buildScriptGeneratePrompt } from "@/lib/ai/prompts/script-generate";
import { buildCharacterExtractPrompt, buildCharacterNameExtractionPrompt, CHARACTER_NAME_EXTRACTION_SYSTEM, resolveCharacterExtractSystemPrompt } from "@/lib/ai/prompts/character-extract";
import { STORYBOARD_REWRITE_SYSTEM, buildRewriteUserPrompt, PLOT_OPTIMIZE_SYSTEM, buildPlotOptimizeUserPrompt } from "@/lib/ai/prompts/storyboard-supervision";
import { extractDialoguesFromMotionScript } from "@/lib/storyboard/extract-dialogues-from-motion-script";
import { VISUAL_STYLE_PRESETS, buildStyleInstruction } from "@/lib/ai/prompts/visual-style-presets";
import { getArtStylePrompt } from "@/lib/ai/prompts/art-styles/index";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getPromptDefinition, SPLIT_SHOT_SINGLE_SYSTEM } from "@/lib/ai/prompts/registry";
import {
  getModelMaxDuration,
  resolveVideoCapability,
  downgradeVideoMode,
  describeCapabilityLoss,
  resolveRatioForMode,
} from "@/lib/ai/video-capabilities";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { resolveImageProvider, resolveVideoProvider, resolveAIProvider } from "@/lib/ai/provider-factory";
import { buildVideoPrompt, buildReferenceVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildCharacterTurnaroundPrompt, buildBeautyImagePrompt, buildCombatImagePrompt } from "@/lib/ai/prompts/character-image";
import { resolveCharacterImages } from "@/lib/ai/character-router";
import { registerCharacterPortraitToArk } from "@/lib/ai/ark-asset-library";
import { resolveArkAssetLibraryClientCredentials } from "@/lib/ark-asset-library-credentials";
import { uploadUrl } from "@/lib/utils/upload-url";
import { shouldResolveMultimodalCharacterRefs } from "@/lib/ai/multimodal-refs";
import { openBillingGate } from "@/lib/billing/gate";
import { tryBuildPreviewProxy } from "@/lib/video/preview-proxy";
import { assembleVideo } from "@/lib/video/ffmpeg";
import { saveVideoToHistory } from "@/lib/video/video-history";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";
import {
  extractProviderErrorMessage as extractErrorMessage,
  mapUpstreamErrorHttpStatus,
} from "@/lib/ai/provider-error";
import { extractShotsFromScript } from "@/lib/storyboard/extract-shot-script";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";
import {
  getShotCharacters,
  persistStoryboardVersion,
} from "@/lib/storyboard/persist-storyboard-version";
import { finalizeExtractedShotsForDb } from "@/lib/storyboard/complete-extracted-shots";
import { downloadVideoWithRetry } from "@/lib/ai/providers/download-with-retry";
import { getRemoteVideoExpiry, isRemoteVideoReusable } from "@/lib/video/remote-video";
import {
  frameReferenceContinuityLabel,
  resolveFrameReferenceForProject,
  shotFrameFileOnDisk,
} from "@/lib/storyboard/frame-reference.server";
import type { FrameReferencePayload, FrameReferenceType } from "@/lib/storyboard/frame-reference";
import {
  collectVisionFramePaths,
  resolveSingleVideoMode,
} from "@/lib/storyboard/shot-video-readiness.server";
import {
  pickFirstFramePromptBuildParams,
  pickLastFramePromptBuildParams,
} from "@/lib/storyboard/frame-prompt-context";
import {
  generateAndPersistDirectVideoPrompt,
  syncVideoPromptIfStale,
} from "@/lib/storyboard/shot-video-prompt-sync.server";
import { buildVideoCutPointUpdate } from "@/lib/storyboard/video-cut-point";
import { resolveVideoMotionAndScene } from "@/lib/ai/prompts/ref-video-prompt-generate";

export const maxDuration = 300;

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
  const result = text.replace(/【背景音[^】]*】[^\n【]*/gi, "").trim();
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

async function saveShotWarnings(shotId: string) {
  // LLM 状态路由已移除，不再产生 missingState 警告；统一清空
  await db.update(shots).set({ warnings: null }).where(eq(shots.id, shotId));
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
  };

  const { action, payload, modelConfig, episodeId } = body;
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
    return handleBatchStoryboardRewrite(projectId, episodeId, resolvedModelConfig, userId);
  }

  if (action === "batch_plot_optimize") {
    return handleBatchPlotOptimize(projectId, episodeId, resolvedModelConfig, userId);
  }

  if (action === "batch_extract_bgm_notes") {
    return handleBatchExtractBgmNotes(projectId, episodeId);
  }

  if (action === "batch_voice_generate") {
    return handleBatchVoiceGenerate(projectId, resolvedModelConfig);
  }

  if (action === "batch_character_restyle") {
    return handleBatchCharacterRestyle(projectId, resolvedModelConfig);
  }

  if (action === "frame_prompt_preview") {
    return handleFramePromptPreview(projectId, userId, payload, episodeId);
  }

  if (action === "single_frame_generate") {
    return handleSingleFrameGenerate(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "single_video_generate") {
    return handleSingleVideoGenerate(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "single_video_prompt") {
    return handleSingleVideoPrompt(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "batch_video_prompt") {
    return handleBatchVideoPrompt(projectId, userId, payload, resolvedModelConfig, episodeId);
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

  if (action === "cover_image_generate") {
    return handleCoverImageGenerate(projectId, userId, payload, resolvedModelConfig);
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

  // 项目画风：用于画风硬锁与真人写实锚点注入（CLAUDE.md 核心约定 #3）
  const [charImgProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const charImgVisualStyle = charImgProject?.visualStyle ?? "anime_2d";
  const charImgStyleContext = {
    visualStyle: charImgVisualStyle,
    visualStyleTag: VISUAL_STYLE_PRESETS[charImgVisualStyle]?.tag ?? "",
    isRealisticStyle: charImgVisualStyle === "realistic" || charImgVisualStyle === "realistic_ancient",
  };

  // Resolve prompt dynamically based on tag
  let promptKey = "combat_image"; // Default to combat/morph
  if (targetTag === "日常") promptKey = "beauty_image";
  if (targetTag === "四视图") promptKey = "character_image";

  const slotContents = await resolveSlotContents(promptKey, { userId, projectId });

  let prompt: string;
  if (promptKey === "beauty_image") {
    prompt = buildBeautyImagePrompt(slotContents, character.name, character.description || "", charImgStyleContext);
  } else if (promptKey === "combat_image") {
    // Pass the tag name as part of the description to give AI context
    const enhancedDesc = `${character.description || ""}\n(State: ${targetTag})`;
    prompt = buildCombatImagePrompt(slotContents, character.name, enhancedDesc, charImgStyleContext);
  } else {
    prompt = buildCharacterTurnaroundPrompt(slotContents, character.name, character.description || "", charImgStyleContext);
  }

  const ai = resolveImageProvider(modelConfig);
  // 四视图是横版排版，单人定妆图（日常/战斗）用竖版画幅，把分辨率预算留给人物本身
  const imageSizeOptions =
    promptKey === "character_image"
      ? { size: "2560x1440", aspectRatio: "16:9" }
      : { aspectRatio: "3:4" };

  try {
    const promises = Array.from({ length: count }).map(() =>
      ai.generateImage(prompt, {
        ...imageSizeOptions,
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
    const status = mapUpstreamErrorHttpStatus(err);
    const error = extractErrorMessage(err);
    if (status < 500) {
      console.warn(`[SingleCharacterImage] Upstream rejected ${character.name}: ${error}`);
    } else {
      console.error(`[SingleCharacterImage] Error for ${character.name}:`, err);
    }
    return NextResponse.json(
      { characterId, status: "error", error },
      { status }
    );
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

  // 项目画风：用于画风硬锁与真人写实锚点注入（CLAUDE.md 核心约定 #3）
  const [batchCharImgProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const batchCharImgVisualStyle = batchCharImgProject?.visualStyle ?? "anime_2d";
  const batchCharImgStyleContext = {
    visualStyle: batchCharImgVisualStyle,
    visualStyleTag: VISUAL_STYLE_PRESETS[batchCharImgVisualStyle]?.tag ?? "",
    isRealisticStyle:
      batchCharImgVisualStyle === "realistic" || batchCharImgVisualStyle === "realistic_ancient",
  };

  const results = await Promise.all(
    allCharacters.map(async (character) => {
      try {
        const assets = await db.select().from(characterAssets).where(eq(characterAssets.characterId, character.id));
        const hasBlueprint = assets.some(a => a.assetType === "blueprint");

        if (hasBlueprint) return null; // Already has four-view blueprint

        const ai = resolveImageProvider(modelConfig);
        const slotContents = await resolveSlotContents("character_image", { userId, projectId });

        // Generate Turnaround (Blueprint only — character router falls back to blueprint when no morph exists)
        const blueprintPrompt = buildCharacterTurnaroundPrompt(
          slotContents,
          character.name,
          character.description || "",
          batchCharImgStyleContext
        );
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
    // Dialogues embedded in motionScript brackets; superviseShots gets them from motionScript
    dialogues: extractDialoguesFromMotionScript(shot.motionScript ?? "").map((d) => ({
      characterName: d.characterName,
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

// --- batch_character_restyle: re-render existing characters' description/visualHint under the CURRENT project.visualStyle ---
//
// 背景：character_extract 生成 description 时会把画风锚定词写进 description 开头（STEP1），
// visualHint 是从 description 提炼的 4-10 字极简识别码。切换项目画风（VisualStylePicker）后，
// 这两个字段不会自动刷新——旧画风的锚定词/服装/场景元素会被 shot_split「视觉标识必须原文复用」
// 规则和定妆图生成路径继续原样使用，直接污染新画风下的帧/视频生成提示词。
// 本 action 让用户手动触发：保留角色核心身份（脸型/气质/标志色等），仅按新画风重写视觉描述。
function buildCharacterRestyleSystem(visualStyle: string): string {
  return `你是资深角色设计师与美术指导。你的任务是把一个「已存在」角色的视觉描述，从旧画风改写为项目当前画风，同时尽量保留角色的核心身份识别特征（脸型气质、标志性配色、标志性道具等），除非这些细节与新画风的时代/场景设定冲突（如古风换成现代都市，或反之），此时必须替换为符合新设定的等价元素。

${buildStyleInstruction(visualStyle)}

═══ 输出要求 ═══
只输出 JSON，不要输出任何其他文字、markdown 代码块标记或解释：
{
  "description": "完整改写后的视觉描述，单段落，开头必须是上方画风锚定词（STYLE TAG）原文，涵盖体态/面容/发型/服装/道具等，与旧描述保持同一角色身份，但所有画风/时代相关元素换成新画风设定",
  "visualHint": "4-10个汉字的极简视觉识别码，基于新的 description 提炼最具辨识度的特征（如：银发金瞳、红甲银纹、素裙青丝），供后续分镜/台词标注中原文复用"
}

注意：不要改变角色的性别、年龄段、性格特征、姓名。`;
}

async function handleBatchCharacterRestyle(
  projectId: string,
  modelConfig?: ModelConfig
): Promise<Response> {
  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const [restyleProject] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, projectId));
  const visualStyle = restyleProject?.visualStyle || "anime_2d";
  const restyleSystem = buildCharacterRestyleSystem(visualStyle);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      try {
        const charRows = await db
          .select({
            id: characters.id,
            name: characters.name,
            description: characters.description,
            visualHint: characters.visualHint,
          })
          .from(characters)
          .where(
            and(
              eq(characters.projectId, projectId),
              sql`(${characters.description} IS NOT NULL AND trim(${characters.description}) != '')`
            )
          );

        const total = charRows.length;
        if (total === 0) {
          send({ type: "done", updatedCount: 0, totalCount: 0 });
          controller.close();
          return;
        }

        send({ type: "start", totalCount: total });
        console.log(`[BatchCharacterRestyle] start project=${projectId} style=${visualStyle} chars=${total}`);

        let updatedCount = 0;
        const failedCharacters: Array<{ name: string; error: string }> = [];
        const restyleModel = createLanguageModel(modelConfig.text!);
        for (const [charIndex, char] of charRows.entries()) {
          let savedDescription: string | null = null;
          let savedVisualHint: string | null = null;
          let failureMessage: string | null = null;

          // 模型偶尔会在合法 JSON 后追加孤立的注释/斜杠。首次解析失败时仅重试当前角色，
          // 已成功写库的角色不会重复生成。
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const { text } = await generateText({
                model: restyleModel,
                system: restyleSystem,
                prompt: `角色名：${char.name}\n旧视觉描述：${char.description}\n旧视觉识别码：${char.visualHint || "无"}${
                  attempt > 1 ? "\n这是重试请求：必须只返回一个完整 JSON 对象，最后一个右花括号后不要添加任何字符。" : ""
                }`,
                temperature: attempt === 1 ? 0.4 : 0.2,
                maxOutputTokens: 4096,
              });

              const parsed = JSON.parse(extractJSON(text)) as {
                description?: string;
                visualHint?: string;
              };
              const description = parsed.description?.trim();
              if (!description) throw new Error("AI response is missing description");

              const visualHint = parsed.visualHint?.trim() || char.visualHint || "";
              await db
                .update(characters)
                .set({ description, visualHint })
                .where(eq(characters.id, char.id));
              updatedCount++;
              savedDescription = description;
              savedVisualHint = visualHint;
              failureMessage = null;
              console.log(`[BatchCharacterRestyle] ${char.name} → ${visualHint || "(无识别码)"}`);
              break;
            } catch (charErr) {
              failureMessage = extractErrorMessage(charErr);
              if (attempt === 1) {
                console.warn(
                  `[BatchCharacterRestyle] Retry ${char.name} after parse/generation failure:`,
                  charErr
                );
              } else {
                console.warn(`[BatchCharacterRestyle] Failed for ${char.name}:`, charErr);
              }
            }
          }

          if (failureMessage) {
            failedCharacters.push({ name: char.name, error: failureMessage });
          }
          send({
            type: "progress",
            updatedCount,
            processedCount: charIndex + 1,
            totalCount: total,
            characterName: char.name,
            characterId: char.id,
            description: savedDescription,
            visualHint: savedVisualHint,
            error: failureMessage,
          });
        }

        send({ type: "done", updatedCount, totalCount: total, failedCharacters });
        console.log(`[BatchCharacterRestyle] Done: ${updatedCount}/${total}`);
      } catch (err) {
        console.error("[BatchCharacterRestyle] Fatal:", err);
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
  modelConfig?: ModelConfig,
  userId?: string
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
        // 解析用户自定义 system prompt（若有）
        const rewriteSystemPrompt = userId
          ? await resolvePrompt("batch_storyboard_rewrite", { userId, projectId }).catch(() => STORYBOARD_REWRITE_SYSTEM)
          : STORYBOARD_REWRITE_SYSTEM;

        // Fetch project visualStyle for art-style aware lighting vocabulary
        const [rewriteProject] = await db
          .select({ visualStyle: projects.visualStyle })
          .from(projects)
          .where(eq(projects.id, projectId));
        const rewriteVisualStyle = rewriteProject?.visualStyle ?? "anime_2d";

        // 风格专属词库（光影/风格锚定/进阶技法）：整读 rewrite-vocab.md，不做标题正则切片
        // ——rewrite_vocab.md 是该风格图像/视频生成侧的唯一权威词库，见 art-styles/index.ts 的类型注释
        const visualStyleContext = getArtStylePrompt(rewriteVisualStyle, "rewrite_vocab") || undefined;

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

        // 台词从 motionScript bracket 实时解析，附加角色 voiceHint
        const rewriteCharRows = await db
          .select({ name: characters.name, voiceHint: characters.voiceHint })
          .from(characters)
          .where(eq(characters.projectId, projectId));
        const charVoiceMap = new Map(
          rewriteCharRows.map((c) => [c.name, c.voiceHint ?? null])
        );
        const shotsWithDialogues = shotRows.map((s) => ({
          ...s,
          dialogues: extractDialoguesFromMotionScript(s.motionScript ?? "").map((d) => ({
            characterName: d.characterName,
            text: d.text,
            type: d.type as string | null,
            voiceHint: (charVoiceMap.get(d.characterName) ?? null) as string | null,
          })),
        }));

        const totalCount = shotRows.length;
        let updatedCount = 0;
        let lowDensityCount = 0;
        const shotDurationById = new Map(shotRows.map((s) => [s.id, s.duration]));
        const writtenShotIds = new Set<string>();
        // 本次 session 中工具写入的最新 startFrameDesc，供后续 chunk compact 模式展示可信内容。
        // 内存中的 shotsWithDialogues[].startFrameDesc 是 session 开始时从 DB 读入的旧值，
        // 不会随工具写入自动更新；这个 Map 是跨 chunk 传递新值的唯一来源。
        const writtenShotFrames = new Map<string, string>();

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
              startFrameDesc: {
                type: "string",
                description:
                  "重写后的首帧描述（五要素：景别+取景范围；角色位置姿态；主光叙述；环境/道具可见细节；情绪解剖+背景锚定词）。只写画面中实际可见内容，严禁出现摄影机/摄像机/相机/机位/镜头高度等拍摄设备词",
              },
              endFrameDesc: {
                type: "string",
                description:
                  "重写后的尾帧描述（五要素，必须与首帧有可见空间位移，光源方向须一致）。只写画面中实际可见内容，严禁出现摄影机/摄像机/相机/机位/镜头高度等拍摄设备词",
              },
              motionScript: { type: "string", description: "重写后的运动脚本（[] 包裹格式，时间段求和=镜头时长，末尾 | 朝向：标注）" },
              cameraDirection: { type: "string", description: "重写后的镜头朝向；摄影机位置、镜头高度、运镜、支撑方式只允许写在这里" },
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
              writtenShotFrames.set(shotId, startFrameDesc);
              updatedCount++;

              const density = checkBeatDensity(motionScript, shotDurationById.get(shotId));
              if (!density.ok) {
                lowDensityCount++;
                console.warn(
                  `[BatchStoryboardRewrite] shot ${shotId} low beat density: ${density.beatCount}/${density.minRequired}`
                );
              }

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
              system: rewriteSystemPrompt,
              prompt: buildRewriteUserPrompt(chunk, shotsWithDialogues, visualStyleContext, writtenShotFrames),
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
            console.warn(`[BatchStoryboardRewrite] ${chunkLabel} failed (${updatedCount}/${totalCount}): ${errMsg}`);
            send({ type: "stream_error", error: `${chunkLabel}: ${errMsg}`, updatedCount, totalCount });

            // 降级：逐个 shot 单独重试，跳过真正触发内容审核的单个 shot，其余正常写入
            const unwritten = chunk.filter((s) => !writtenShotIds.has(s.id));
            if (unwritten.length > 0) {
              console.log(`[BatchStoryboardRewrite] ${chunkLabel} fallback: retrying ${unwritten.length} shots one by one`);
              for (const singleShot of unwritten) {
                const singleLabel = `shot ${singleShot.sequence}`;
                try {
                  const singleResult = streamText({
                    model: createLanguageModel(modelConfig.text!),
                    system: rewriteSystemPrompt,
                    prompt: buildRewriteUserPrompt([singleShot], shotsWithDialogues, visualStyleContext, writtenShotFrames),
                    temperature: 0.5,
                    tools: { write_shot_rewrite: writeShotRewrite },
                    stopWhen: stepCountIs(6),
                  });
                  let lastHeartbeat = Date.now();
                  for await (const ch of singleResult.fullStream) {
                    const now = Date.now();
                    if (now - lastHeartbeat > 2000) {
                      send({ type: "thinking", updatedCount, totalCount });
                      lastHeartbeat = now;
                    }
                    void ch;
                  }
                  console.log(`[BatchStoryboardRewrite] ${chunkLabel} fallback ${singleLabel} done (${updatedCount}/${totalCount})`);
                } catch (singleErr) {
                  const singleErrMsg = singleErr instanceof Error ? singleErr.message : String(singleErr);
                  console.warn(`[BatchStoryboardRewrite] ${chunkLabel} fallback ${singleLabel} skipped: ${singleErrMsg}`);
                  send({ type: "stream_error", error: `${singleLabel} skipped: ${singleErrMsg}`, updatedCount, totalCount });
                }
              }
            }
          }
        }

        send({ type: "done", updatedCount, totalCount, lowDensityCount });
        console.log(`[BatchStoryboardRewrite] Done: ${updatedCount}/${totalCount}, lowDensity=${lowDensityCount}`);
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

// --- batch_plot_optimize: 剧情优化 Agent ---
// 读取全集 shots.prompt（场景描述），用编剧视角批量重写为有血有肉的剧本内容，写回 shots.prompt。

function handleBatchPlotOptimize(
  projectId: string,
  episodeId: string | undefined,
  modelConfig?: ModelConfig,
  userId?: string
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
        // 解析用户自定义 system prompt（若有）
        const plotSystemPrompt = userId
          ? await resolvePrompt("batch_plot_optimize", { userId, projectId }).catch(() => PLOT_OPTIMIZE_SYSTEM)
          : PLOT_OPTIMIZE_SYSTEM;

        // 拉取全集 shots
        const shotRows = await db
          .select({
            id: shots.id,
            sequence: shots.sequence,
            duration: shots.duration,
            prompt: shots.prompt,
            motionScript: shots.motionScript,
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

        // 从 motionScript bracket 中提取台词供 LLM 参考（不会修改）
        const shotsWithDialogues = shotRows.map((s) => ({
          ...s,
          dialogues: extractDialoguesFromMotionScript(s.motionScript ?? "").map((d) => ({
            characterName: d.characterName,
            text: d.text,
            type: d.type as string | null,
          })),
        }));

        const totalCount = shotRows.length;
        let updatedCount = 0;
        const writtenShotIds = new Set<string>();

        send({ type: "start", totalCount });
        console.log(`[BatchPlotOptimize] start project=${projectId} episode=${episodeId} shots=${totalCount}`);

        // 工具：LLM 按镜头顺序逐一调用，写回 shots.prompt
        const writeShotPlot = tool({
          description: "将优化后的场景描述写入数据库。每个分镜调用一次，按镜头顺序逐一调用。",
          inputSchema: jsonSchema<{
            shotId: string;
            prompt: string;
          }>({
            type: "object",
            properties: {
              shotId: { type: "string", description: "镜头 ID，必须与输入完全一致" },
              prompt: { type: "string", description: "重写后的场景描述（符合编剧标准，有血有肉）" },
            },
            required: ["shotId", "prompt"],
          }),
          execute: async ({ shotId, prompt: newPrompt }) => {
            if (!validShotIds.has(shotId)) return `skipped: unknown shotId ${shotId}`;
            if (writtenShotIds.has(shotId)) return `skipped: already written ${shotId}`;
            if (!newPrompt?.trim()) return `skipped: empty prompt for ${shotId}`;

            try {
              await db
                .update(shots)
                .set({ prompt: newPrompt })
                .where(eq(shots.id, shotId));

              writtenShotIds.add(shotId);
              const contextShot = shotsWithDialogues.find((s) => s.id === shotId);
              if (contextShot) {
                contextShot.prompt = newPrompt;
              }
              updatedCount++;
              send({ type: "progress", updatedCount, totalCount });
              console.log(`[BatchPlotOptimize] wrote shot ${shotId} (${updatedCount}/${totalCount})`);
              return `ok: ${shotId}`;
            } catch (dbErr) {
              console.error(`[BatchPlotOptimize] DB write failed for shot ${shotId}:`, dbErr);
              return `error: DB write failed for ${shotId}`;
            }
          },
        });

        // 分块处理，每块 5 个镜头，避免推理超时
        const CHUNK_SIZE = 5;
        const chunks: typeof shotsWithDialogues[] = [];
        for (let i = 0; i < shotsWithDialogues.length; i += CHUNK_SIZE) {
          chunks.push(shotsWithDialogues.slice(i, i + CHUNK_SIZE));
        }

        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const chunk = chunks[chunkIdx];
          const chunkLabel = `chunk ${chunkIdx + 1}/${chunks.length}`;
          console.log(`[BatchPlotOptimize] ${chunkLabel} start (shots ${chunk.map(s => s.sequence).join(",")})`);

          for (const singleShot of chunk) {
            if (writtenShotIds.has(singleShot.id)) continue;

            try {
              // 逐镜滚动优化：上一镜写回后会同步更新 shotsWithDialogues，
              // 下一镜 prompt 里的「全集镜头概览」就能看到已优化文本。
              const beforeCount = updatedCount;
              const result = streamText({
                model: createLanguageModel(modelConfig.text!),
                system: plotSystemPrompt,
                prompt: buildPlotOptimizeUserPrompt([singleShot], shotsWithDialogues),
                temperature: 0.7,
                tools: { write_shot_plot: writeShotPlot },
                stopWhen: stepCountIs(6),
              });

              let lastHeartbeat = Date.now();
              for await (const ch of result.fullStream) {
                const now = Date.now();
                if (now - lastHeartbeat > 2000) {
                  send({ type: "thinking", updatedCount, totalCount });
                  lastHeartbeat = now;
                }
                void ch;
              }

              if (updatedCount === beforeCount && !writtenShotIds.has(singleShot.id)) {
                const msg = `shot ${singleShot.sequence} produced no write_shot_plot call`;
                console.warn(`[BatchPlotOptimize] ${msg}`);
                send({ type: "stream_error", error: msg, updatedCount, totalCount });
              }
            } catch (singleErr) {
              const msg = singleErr instanceof Error ? singleErr.message : String(singleErr);
              console.warn(`[BatchPlotOptimize] shot ${singleShot.sequence} failed: ${msg}`);
              send({ type: "stream_error", error: `shot ${singleShot.sequence} skipped: ${msg}`, updatedCount, totalCount });
            }
          }

          console.log(`[BatchPlotOptimize] ${chunkLabel} done (${updatedCount}/${totalCount})`);
        }

        send({ type: "done", updatedCount, totalCount });
        console.log(`[BatchPlotOptimize] Done: ${updatedCount}/${totalCount}`);
      } catch (err) {
        console.error("[BatchPlotOptimize] Fatal error:", err);
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
 * 本项目暂无 sharp，改用优先级截断：跨镜参考图排最前，然后是角色主图、角度图、道具图。
 * Seedream API 最大支持 14 张参考图，此处设 14 以充分利用 API 能力。
 * 注：场景图已于 migration 0045/0046 移除，实际使用中 1-4 角色 = 1-4 张，极少超限。
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
  // 优先用 startFrameDesc（含构图/服装/光影视觉细节）+ prompt（叙事背景），让状态路由有更准确的判断依据
  const frameSceneDesc = [shot.startFrameDesc, shot.prompt].filter(Boolean).join("\n");
  const resolvedChars = await resolveCharacterImages(
    frameSceneDesc,
    charsForFrame,
  );
  await saveShotWarnings(shotId);

  // Frame-specific reference image subsets — 主图必须排在角度图前面，
  // 确保 @图N 编号与 referenceImages[N-1] 一一对应（与 Toonflow generateFlowImage 一致）。
  const firstFrameCharNames = new Set(charsForFirstFrame.map((c) => c.name));
  const lastFrameCharNames  = new Set(charsForLastFrame.map((c) => c.name));
  const resolvedFirst = resolvedChars.filter((rc) => firstFrameCharNames.has(rc.name));
  const charMainImagesFirst  = resolvedFirst.map((c) => c.imagePath);
  const charAngleImagesFirst = resolvedFirst.flatMap((c) => (c.angleImages ?? []).slice(0, 2).map(ai => ai.path));
  const resolvedLast = resolvedChars.filter((rc) => lastFrameCharNames.has(rc.name));
  const charMainImagesLast  = resolvedLast.map((c) => c.imagePath);
  const charAngleImagesLast = resolvedLast.flatMap((c) => (c.angleImages ?? []).slice(0, 2).map(ai => ai.path));
  // 合并版本供 length 检查和 debug 日志使用。
  const charRefImagesFirst = [...charMainImagesFirst, ...charAngleImagesFirst];
  const charRefImagesLast  = [...charMainImagesLast,  ...charAngleImagesLast];

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);
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

  // frameTarget: "first" = only regenerate anchorFirst; "last" = only anchorLastAi
  // 客户端始终显式传入，服务端 default 为 "first"（防御性兜底，不应依赖）
  const frameTarget = (payload?.frameTarget as "first" | "last") ?? "first";

  // 解析多参考图（frameReferences 数组，新）或单参考图（frameReference，兼容旧版）
  // 第一张为主参考（用于来源追溯），后续为额外参考；参考图重绘不等于 strict 首帧承接。
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

  // 主参考（第一张）用于来源追溯；多张全部注入 refImages
  const continuityRef: ResolvedFrameRef | undefined = resolvedFrameRefs[0];

  // 分镜级道具参考图：读取 shot.propRefs（JSON 数组 assetId），查出磁盘上存在的图片路径
  const propRefIds: string[] = (() => {
    if (!shot.propRefs) return [];
    try { return JSON.parse(shot.propRefs) as string[]; }
    catch { return []; }
  })();
  const propRefPaths: string[] = propRefIds.length > 0
    ? (await db
        .select({ imagePath: characterAssets.imagePath })
        .from(characterAssets)
        .where(inArray(characterAssets.id, propRefIds)))
      .map((a) => a.imagePath)
      .filter((p): p is string => !!p && shotFrameFileOnDisk(p))
    : [];

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
      // refImages 顺序：charMain(@图N 对齐) → charAngle(无编号) → crossShot(无编号) → propRef(无编号)
      const refImages = [
        ...charMainImagesFirst,
        ...charAngleImagesFirst,   // 角度图追加到末尾（无 @图N 绑定，提供额外一致性上下文）
        ...crossShotRefPaths,      // 跨镜参考图追加到末尾
        ...propRefPaths,           // 道具参考图追加到末尾（分镜级手动绑定）
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
      const firstPrompt = firstPromptRaw;
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
          anchorFirstContinuityMode: continuityRef ? "reference_redraw" : null,
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
      const lastPrompt = lastPromptRaw;
      // 尾帧 referenceImages 顺序与 lastFrameAssets (@图N) 严格对齐：
      //   @图1…@图N → charMainImagesLast（角色主图）
      //   无编号     → charAngleImagesLast（角度图，额外一致性上下文）
      //   无编号     → existingFirstFrame（首帧作为风格连续性锚定，排末尾）
      //   无编号     → crossShotRefPathsLast
      //   无编号     → propRefPaths（道具参考图，分镜级手动绑定）
      const crossShotRefPathsLast = resolvedFrameRefs.map((r) => r.path);
      const lastFramePath = await ai.generateImage(lastPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: limitReferenceImages([
          ...charMainImagesLast,
          ...charAngleImagesLast,
          existingFirstFrame,
          ...crossShotRefPathsLast,
          ...propRefPaths,           // 道具参考图追加到末尾
        ]),
      });
      await db
        .update(shots)
        .set({ anchorLastAi: lastFramePath, status: "completed" })
        .where(eq(shots.id, shotId));
      return NextResponse.json({ shotId, anchorLastAi: lastFramePath, status: "ok" });
    }

    // 未知 frameTarget 兜底：生成首帧（不应发生，客户端始终显式传 first/last）
    const firstFramePath = await generateAnchorFirst();
    await persistAnchorFirst(firstFramePath);
    return NextResponse.json({ shotId, anchorFirst: firstFramePath, status: "ok" });
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
  // ── 能力解析 + 模式降级 ────────────────────────────────────────────────────
  // resolveSingleVideoMode 只看分镜数据算出「理想模式」；能否真的用取决于 provider。
  // Kling / Veo / 即梦都只实现了首帧和首尾帧两种 body，把 multimodal（绝大多数镜头的默认模式）
  // 直接送进去会崩，所以必须过一道 downgradeVideoMode。
  const videoProtocol = modelConfig?.video?.protocol ?? "";
  const videoCapability = resolveVideoCapability(modelConfig?.video?.modelId, videoProtocol);
  const videoModeDecision = downgradeVideoMode(resolveSingleVideoMode(shot), videoCapability);
  const singleVideoMode = videoModeDecision.mode;
  if (videoModeDecision.downgraded) {
    console.log(
      `[SingleVideoGenerate] Shot ${shot.sequence}: mode downgraded ` +
        `${videoModeDecision.requested} → ${singleVideoMode}（${videoCapability.label} 不支持前者）`
    );
  }
  // keyframe（首尾帧强约束）/ initialImage（严格首帧承接）都把 anchorFirst 当必需字段用
  // （下面会有 shotForVideo.anchorFirst! 非空断言）；multimodal 模式首帧只是可选构图参考，
  // 缺失时优雅降级为纯文字提示词 + 角色定妆图生成，不应该卡在这里。
  if (singleVideoMode !== "multimodal" && (!shot.anchorFirst || !shotFrameFileOnDisk(shot.anchorFirst))) {
    return NextResponse.json({ error: "首帧文件不存在，请重新生成首帧" }, { status: 400 });
  }
  // 向后兼容：prompt 拼接逻辑仍用此布尔值判断"是否首帧模式"
  const useSingleVideoReferenceMode = singleVideoMode !== "keyframe";

  const shotDialoguesParsed = extractDialoguesFromMotionScript(shot.motionScript ?? "");

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

  // 提示词方言由能力描述符决定（原先是 `protocol === "seedance" || "doubao"` 的硬编码判断）
  const usesSeedanceDialect = videoCapability.promptDialect === "seedance-multi-param";

  // ── 计费闸门（BILLING_ENABLED=1 时生效，否则完全空操作）──────────────────
  // 必须在调用上游之前预扣：视频生成是数分钟的长任务，生成完再扣费时，
  // 余额不足的钱已经花在上游了，追不回来。
  const billing = await openBillingGate(
    userId,
    {
      kind: "video",
      modelId: modelConfig?.video?.modelId,
      durationSeconds: Math.min(shot.duration ?? 10, videoCapability.duration.max),
      resolution: (payload?.resolution as string) ?? "480p",
    },
    { projectId, shotId, protocol: videoProtocol }
  );
  if (!billing.ok) return billing.response;

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

    // 部分模型在特定模式下把比例锁死（例：MiniMax H3 的图生视频恒为 adaptive），
    // 由能力表统一表达，不再在各 provider 内部各写各的。
    const ratio =
      resolveRatioForMode(videoCapability, singleVideoMode) ??
      (payload?.ratio as string) ??
      "16:9";

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

    const videoMaxDuration = videoCapability.duration.max;
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

    // 生成前把「本次会丢什么」算出来并记录 —— 降级必须可见，不能静默处理。
    // 返回给客户端后由分镜卡展示（见 capabilityNotes）。
    const capabilityNotes = describeCapabilityLoss(videoCapability, {
      decision: videoModeDecision,
      characterImageCount: singleVideoShotChars.length,
      // 有台词才谈得上音色克隆的损失
      audioRefCount: shotDialoguesParsed.length > 0 ? singleVideoShotChars.length : 0,
      requestedDuration: shot.duration ?? undefined,
    });
    if (capabilityNotes.length > 0) {
      console.log(
        `[SingleVideoGenerate] Shot ${shot.sequence}: capability notes — ${capabilityNotes.join("；")}`
      );
    }

    const { motionText: videoMotionRaw } = resolveVideoMotionAndScene(shotForVideo);
    const resolvedMotionText = stripBgmContent(
      videoMotionRaw || shotForVideo.prompt || "",
      shotForVideo.bgmNote
    );
    const videoContextForDialogue = resolvedMotionText;
    const onScreenDialogueChars = shotDialoguesParsed
      .map((d) => d.characterName)
      .filter((name) =>
        isCharacterOnScreen(name, videoContextForDialogue, shotForVideo.startFrameDesc)
      );

    const dialogueList = shotDialoguesParsed.map((d) => {
      const char = shotCharacters.find((c) => c.name === d.characterName);
      const characterName = d.characterName;
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

    const hasVisualFrameAnchors =
      !useSingleVideoReferenceMode &&
      !!shotForVideo.anchorLastAi &&
      shotFrameFileOnDisk(shotForVideo.anchorLastAi);

    // ── multimodal 模式预解析：在 prompt 构建前 resolve 角色图，确保 @参考N 编号与 refs 数组同步 ──
    // 只要是 Seedance multimodal，就必须解析角色图；已有 videoPrompt 也不能跳过，
    // 否则会只传 anchorFirst，丢失角色主图、角度变体和音频参考。
    const needPreResolveCharImages = shouldResolveMultimodalCharacterRefs({
      singleVideoMode,
      capability: videoCapability,
      namedCharacterCount: singleVideoShotChars.length,
    });

    // charImagesForVideo：multimodal 模式下实际有图（磁盘存在）的角色列表
    // 其余模式为 []，三路分流里 multimodal 分支直接复用，不重复查询
    const charImagesForVideo = needPreResolveCharImages
      ? await resolveCharacterImages(
          // startFrameDesc 优先（含服装/光影视觉细节），prompt 补充叙事背景
          [shotForVideo.startFrameDesc, shotForVideo.prompt].filter(Boolean).join("\n"),
          singleVideoShotChars,
        )
      : [];

    // ── Seedance 新格式：@参考N + 音色 + 台词类型 ──────────────────────────────
    let videoPromptBase: string;
    if (usesSeedanceDialect && (!shotForVideo.videoPrompt || singleVideoMode === "multimodal")) {
      // 构建角色资产列表：
      //   multimodal 模式：只包含有磁盘图片的角色（与 multimodalRefs 第一轮完全对应）
      //   其余模式：包含所有命名角色（@参考N 空悬无妨，API 不传 refs）
      const charsForPrompt = needPreResolveCharImages
        ? singleVideoShotChars.filter((c) =>
            charImagesForVideo.some(
              (ci) => ci.name === c.name && !!ci.imagePath && shotFrameFileOnDisk(ci.imagePath)
            )
          )
        : singleVideoShotChars;

      const seedanceSingleAssets: SeedanceAsset[] = [];
      for (const char of charsForPrompt) {
        // multimodal 模式：audioPath 已由 resolveCharacterImages 查好，直接复用
        const resolvedChar = charImagesForVideo.find((ci) => ci.name === char.name);
        const hasAudio = resolvedChar
          ? !!resolvedChar.audioPath
          : await (async () => {
              const rows = await db
                .select({ audioPath: characterAssets.audioPath })
                .from(characterAssets)
                .where(eq(characterAssets.characterId, char.id));
              return rows.some((r) => !!r.audioPath);
            })();
        seedanceSingleAssets.push({
          id: char.id,
          name: char.name,
          type: "role",
          voiceHint: char.voiceHint || null,
          hasAudio,
          // angleImages：multimodal 预解析时已获取，其余模式传空数组（@参考N 不传 refs，空悬无妨）
          angleImages: resolvedChar?.angleImages ?? [],
        });
      }

      const seedanceSingleShot: SeedanceShot = {
        hasStoryboardImage: !!shotForVideo.anchorFirst,
        duration: effectiveDuration,
        sceneDescription: shotForVideo.prompt || "",
        cameraDirection: shotForVideo.cameraDirection || null,
        motionScript: shotForVideo.videoPrompt || resolvedMotionText,
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
          // 2.0 用全局连续的 @参考N，2.5 用按类型的 @图片N/@音频N（能力表说了算）
          refNumbering: videoCapability.refNumbering === "per-type" ? "per-type" : "global",
        }),
        shotForVideo.bgmNote
      );
    } else {
      // 非 Seedance，或 Seedance keyframe/initialImage 已有预生成 prompt → 沿用原有逻辑
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
    const videoPrompt = videoPromptBase;

    console.log(
      `\n${"=".repeat(80)}\n[SingleVideoGenerate] Shot ${shot.sequence} — FINAL VIDEO PROMPT (sent to model, mode=${singleVideoMode})\n${"=".repeat(80)}\n${videoPrompt}\n${"=".repeat(80)}\n`
    );

    const resolution = payload?.resolution as "480p" | "720p" | undefined;

    const onRemoteResultSingle = async ({ videoUrl, taskId }: { videoUrl: string; taskId?: string | null }) => {
      await db.update(shots).set({
        remoteVideoUrl: videoUrl,
        remoteVideoTaskId: taskId ?? null,
        remoteVideoStatus: "available",
        remoteVideoCreatedAt: new Date(),
        remoteVideoExpiresAt: getRemoteVideoExpiry(),
      }).where(eq(shots.id, shotId));
    };

    // ── 三路分流：keyframe / initialImage / multimodal ──────────────────────────
    let result: Awaited<ReturnType<typeof videoProvider.generateVideo>>;

    if (singleVideoMode === "keyframe") {
      // 首尾帧模式：两帧双锁，最强约束（极少数情况，需手动生成 AI 尾帧）
      result = await videoProvider.generateVideo({
        anchorFirst: shotForVideo.anchorFirst!,
        anchorLastAi: shotForVideo.anchorLastAi!,
        prompt: videoPrompt,
        duration: effectiveDuration,
        ratio,
        ...(resolution && { resolution }),
        onRemoteResult: onRemoteResultSingle,
      });
    } else if (singleVideoMode === "multimodal") {
      // 多模态参考模式：anchorFirst 作构图参考，角色定妆图锁定外貌（修复角色跑偏 bug）
      // charImagesForVideo 已在 prompt 构建前预解析（needPreResolveCharImages），无需重复查询。
      // 即使 videoPrompt 已预生成，也必须预解析角色图；文本会被 Seedance 多参模板包裹，
      // 让 @参考N 定义和 multimodalRefs 顺序保持一致。

      // 组装 multimodalRefs，顺序必须与 buildSeedanceMultiParamVideoPrompt 的 buildRefEntries 完全一致：
      //   第一轮：角色资产主图 + 紧跟该角色的角度变体（3q → profile → back）
      //   第二轮：分镜首帧 anchorFirst（构图锚点）
      //   第三轮：音频（音色克隆参考）
      //   第四轮：道具参考图（分镜级手动绑定，不占 @参考N 编号）
      //
      // 图片优先级（高→低）：主图 > anchorFirst > 道具图 > 角度变体
      //   道具图是用户为特定镜头手动选的，比角度变体更关键，必须先预留槽位。
      //   角度变体超出时按 back → profile → 3q 顺序裁剪（character-router 已保证 3q→profile→back
      //   顺序，角度预算耗尽时后面的角度自然被跳过，即背面先丢）。
      //
      // API 上限（Seedance 2.0 官方文档硬限制）：
      //   图片：1~9 张（type:"image"）
      //   音频：最多 3 个（type:"audio"，独立类型，不占图片名额）
      // 上限来自能力表（`video-capabilities.ts`），不再在这里写死 Seedance 2.0 的数字。
      // 换模型/换品牌时这两个值自动跟着变，不需要改本路由。
      const MAX_MULTIMODAL_REFS = videoCapability.refs.image;
      const MAX_AUDIO_REFS = videoCapability.refs.audio;
      // 主图可用条件：本地文件存在，或已锁定进私域素材库（asset:// 引用，无需本地文件）
      const charMainUsable = (ci: (typeof charImagesForVideo)[number]) =>
        ci.arkAssetStatus === "active" && ci.arkAssetId
          ? true
          : !!(ci.imagePath && shotFrameFileOnDisk(ci.imagePath));
      const charMainCount = charImagesForVideo.filter(charMainUsable).length;
      const anchorCount =
        shotForVideo.anchorFirst && shotFrameFileOnDisk(shotForVideo.anchorFirst) ? 1 : 0;

      // 预先获取道具图 ID，计算需预留的槽位（道具 > 角度变体）
      const videoPropRefIds: string[] = (() => {
        if (!shot.propRefs) return [];
        try { return JSON.parse(shot.propRefs) as string[]; }
        catch { return []; }
      })();
      // 保守预留（实际磁盘存在数可能更少，但预留不足比过度预留危害更大）
      const propReserve = Math.min(
        videoPropRefIds.length,
        Math.max(0, MAX_MULTIMODAL_REFS - charMainCount - anchorCount)
      );
      // 角度变体可用槽位 = 总图片预算 − 主图 − anchorFirst − 道具预留
      let angleSlotBudget = Math.max(
        0,
        MAX_MULTIMODAL_REFS - charMainCount - anchorCount - propReserve
      );

      const multimodalRefs: import("@/lib/ai/types").MultimodalRefItem[] = [];

      // 第一轮：角色主图 + 角度变体（顺序对应 buildRefEntries 的 asset_image + asset_angle_image 轮）
      // 主图已锁定私域素材库（arkAssetStatus === "active"）时优先用 asset://<arkAssetId> 引用，
      // 绕过 Seedance 2.0 真人人脸拦截；否则走原有本地路径（toImageUrl 转 data URI）。
      for (const ci of charImagesForVideo) {
        if (charMainUsable(ci)) {
          const useArkAsset = ci.arkAssetStatus === "active" && !!ci.arkAssetId;
          multimodalRefs.push({
            type: "image",
            path: useArkAsset ? `asset://${ci.arkAssetId}` : ci.imagePath,
          });
          for (const ai of ci.angleImages ?? []) {
            if (angleSlotBudget > 0) {
              const useArkAssetForAngle = ai.arkAssetStatus === "active" && !!ai.arkAssetId;
              multimodalRefs.push({
                type: "image",
                path: useArkAssetForAngle ? `asset://${ai.arkAssetId}` : ai.path,
              });
              angleSlotBudget--;
            }
          }
        }
      }
      // 第二轮：分镜首帧（对应 buildRefEntries 的 storyboard_image 轮）
      if (shotForVideo.anchorFirst && shotFrameFileOnDisk(shotForVideo.anchorFirst)) {
        multimodalRefs.push({ type: "image", path: shotForVideo.anchorFirst });
      }
      // 第三轮：音频（对应 buildRefEntries 的 asset_audio 轮），最多 MAX_AUDIO_REFS 个
      let audioRefCount = 0;
      for (const ci of charImagesForVideo) {
        if (ci.audioPath && fs.existsSync(ci.audioPath) && audioRefCount < MAX_AUDIO_REFS) {
          multimodalRefs.push({ type: "audio", path: ci.audioPath });
          audioRefCount++;
        }
      }
      // 第四轮：道具参考图（不占 @参考N 编号，仅用图片配额保护）
      // imageCount 只计 image 类型，不把第三轮的 audio 计入图片配额
      if (videoPropRefIds.length > 0) {
        const videoPropAssets = await db
          .select({ imagePath: characterAssets.imagePath })
          .from(characterAssets)
          .where(inArray(characterAssets.id, videoPropRefIds));
        for (const pa of videoPropAssets) {
          const imageCount = multimodalRefs.filter((r) => r.type === "image").length;
          if (pa.imagePath && shotFrameFileOnDisk(pa.imagePath) && imageCount < MAX_MULTIMODAL_REFS) {
            multimodalRefs.push({ type: "image", path: pa.imagePath });
          }
        }
      }

      console.log(
        `[SingleVideoGenerate] Shot ${shot.sequence}: multimodal refs — ` +
          `${multimodalRefs.filter((r) => r.type === "image").length} image(s), ` +
          `${multimodalRefs.filter((r) => r.type === "audio").length} audio(s)`
      );

      result = await videoProvider.generateVideo({
        multimodalRefs,
        prompt: videoPrompt,
        duration: effectiveDuration,
        ratio,
        ...(resolution && { resolution }),
        onRemoteResult: onRemoteResultSingle,
      });
    } else {
      // initialImage 模式：strict_start 承接帧，像素级时序连续（严格首帧锚定）
      result = await videoProvider.generateVideo({
        initialImage: shotForVideo.anchorFirst!,
        prompt: videoPrompt,
        duration: effectiveDuration,
        ratio,
        ...(resolution && { resolution }),
        onRemoteResult: onRemoteResultSingle,
      });
    }

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

    // 预览代理：编辑器直接解码 1080p 源片会把音频解码线程饿死（MP4Clip.tick audio timeout）
    // 并严重卡顿。转一份 480p 代理 + 封面帧，编辑器优先用它们。
    // tryBuild 吞掉所有错误 —— 视频已经生成出来、钱也花了，不能因为转码失败就判整体失败。
    const proxy = await tryBuildPreviewProxy(
      result.filePath,
      `${path.relative(process.env.UPLOAD_DIR || "./uploads", versionedUploadDir).replace(/\\/g, "/")}/previews`
    );

    await db.update(shots)
      .set({
        videoUrl: result.filePath,
        status: "completed",
        videoResolution: resolution ?? null,
        ...(proxy && { previewUrl: proxy.previewUrl, posterUrl: proxy.posterUrl }),
        ...singleLastFrameUpdate,
      })
      .where(eq(shots.id, shotId));

    await billing.settle();

    return NextResponse.json({
      shotId,
      videoUrl: result.filePath,
      status: "ok",
      // 本次因模型能力差异而丢弃/降级的东西，供 UI 告知用户（空数组表示无损失）
      ...(capabilityNotes.length > 0 && { capabilityNotes }),
      ...(billing.credits > 0 && { creditsCharged: billing.credits }),
    });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    // 生成失败全额退回预扣积分。放在 status 更新之前，确保即使后续 DB 操作出错，
    // 用户的钱也已经退了。
    await billing.refund(extractErrorMessage(err));
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

  // Get dialogues for subtitles (from motionScript brackets, no DB query needed)
  const allDialogues: Array<{ text: string; characterName: string; sequence: number; shotSequence: number }> = [];
  for (const shot of projectShots) {
    for (const d of extractDialoguesFromMotionScript(shot.motionScript ?? "")) {
      allDialogues.push({ text: d.text, characterName: d.characterName, sequence: d.sequence, shotSequence: shot.sequence ?? 0 });
    }
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

// ─── batch_extract_bgm_notes：从剧集 script 重新提取 bgmNote 到分镜 ───────────

/**
 * 读取 episodes.script 原始剧本，重新解析每个 shot 的【背景音】标签，
 * 只更新 shots.bgm_note 字段，不触碰其他分镜字段。
 * 按 sequence 号匹配 DB 中的 shots（与当前 storyboard version 一致）。
 */
async function handleBatchExtractBgmNotes(
  projectId: string,
  episodeId: string | undefined,
) {
  if (!episodeId) {
    return NextResponse.json({ error: "episodeId 为必填" }, { status: 400 });
  }

  // 1. 读取剧集 script 原文
  const [episode] = await db
    .select({ script: episodes.script })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));

  if (!episode) {
    return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
  }

  const scriptText = episode.script?.trim();
  if (!scriptText) {
    return NextResponse.json({ error: "剧集 script 为空，无法提取" }, { status: 400 });
  }

  // 2. 重新解析 bgmNote
  const { shots: extractedShots } = extractShotsFromScript(scriptText);
  const bgmMap = new Map<number, string | null>();
  for (const s of extractedShots) {
    if (s.bgmNote) bgmMap.set(s.sequence, s.bgmNote);
  }

  if (bgmMap.size === 0) {
    return NextResponse.json({ updated: 0, message: "剧本中未发现【背景音】标签" });
  }

  // 3. 找当前剧集最新 storyboard version 的所有 shots
  const [latestVersion] = await db
    .select({ id: storyboardVersions.id })
    .from(storyboardVersions)
    .where(and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId)))
    .orderBy(desc(storyboardVersions.createdAt))
    .limit(1);

  if (!latestVersion) {
    return NextResponse.json({ error: "该剧集没有分镜版本" }, { status: 404 });
  }

  const targetShots = await db
    .select({ id: shots.id, sequence: shots.sequence })
    .from(shots)
    .where(eq(shots.versionId, latestVersion.id))
    .orderBy(asc(shots.sequence));

  // 4. 按 sequence 匹配，只更新有 bgmNote 的
  let updated = 0;
  for (const shot of targetShots) {
    const bgmNote = bgmMap.get(shot.sequence);
    if (bgmNote !== undefined) {
      await db.update(shots).set({ bgmNote }).where(eq(shots.id, shot.id));
      updated++;
    }
  }

  return NextResponse.json({
    updated,
    total: targetShots.length,
    message: `已从剧本中提取并更新 ${updated} 个分镜的背景音乐注记`,
  });
}

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

  // 从 motionScript bracket 提取原始台词（无需查 dialogues 表）
  const originalDialogues = extractDialoguesFromMotionScript(shot.motionScript ?? "");

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
    // Dialogues are embedded in motionScript brackets; no separate table insert needed.
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
 *
 * 若来源正面图已锁定私域素材库（arkAssetStatus=active），新生成的角度变体会
 * 尽力（best-effort）一并注册进同一素材组合——否则「先锁主图、后扩展角度」这个顺序
 * 会导致角度图漏锁，视频生成时这几张角度图仍是本地真人照片，一样触发人脸拦截。
 * 注册失败（限流/凭证缺失等）不影响角度图生成本身的成功返回，只是该图停在
 * arkAssetStatus=failed，用户可在卡片上对这张角度图单独点「锁定到素材库」重试。
 */
async function handleExpandCharacterAsset(
  projectId: string,
  userId: string,
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
    .select({
      id: characters.id,
      name: characters.name,
      description: characters.description,
      visualHint: characters.visualHint,
      arkAssetGroupId: characters.arkAssetGroupId,
    })
    .from(characters)
    .where(eq(characters.id, sourceAsset.characterId));
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  // 来源正面图已锁定私域素材库时，新角度变体尽力一并注册（见函数顶部注释）
  const shouldAutoLockAngles = sourceAsset.arkAssetStatus === "active";
  const arkPublicBase = process.env.AI_COMIC_APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  const arkCredentials = shouldAutoLockAngles
    ? await resolveArkAssetLibraryClientCredentials(userId)
    : null;

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

      if (shouldAutoLockAngles && arkCredentials && arkPublicBase) {
        await db.update(characterAssets).set({ arkAssetStatus: "pending" }).where(eq(characterAssets.id, newId));
        try {
          const arkResult = await registerCharacterPortraitToArk({
            credentials: arkCredentials,
            characterName: character.name,
            existingGroupId: character.arkAssetGroupId,
            imageUrl: `${arkPublicBase}${uploadUrl(imagePath)}`,
            label: `${sourceAsset.tag}-${angle}`,
          });
          await db
            .update(characterAssets)
            .set({
              arkAssetId: arkResult.assetId,
              arkAssetStatus: arkResult.status === "Active" ? "active" : "failed",
              arkAssetRegisteredAt: new Date(),
            })
            .where(eq(characterAssets.id, newId));
        } catch (err) {
          console.error(`[ExpandCharacterAsset] 角度变体(${angle}) 自动锁定私域素材库失败:`, err);
          await db.update(characterAssets).set({ arkAssetStatus: "failed" }).where(eq(characterAssets.id, newId));
        }
      }
    } catch (err) {
      console.error(`[ExpandCharacterAsset] Failed to generate angle=${angle}:`, err);
    }
  }

  return NextResponse.json({ success: true, generated });
}

// --- cover_image_generate: 生成2:3竖版封面图（支持角色定妆图 @图N 绑定） ---
async function handleCoverImageGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  let prompt = payload?.prompt as string;
  // 客户端传来的角色定妆图路径数组（本地 uploads/... 相对路径）
  const referenceImagePaths = (payload?.referenceImagePaths as string[] | undefined) ?? [];
  // 每张参考图对应的角色名（与 referenceImagePaths 顺序对应）
  const referenceLabels = (payload?.referenceLabels as string[] | undefined) ?? [];

  if (!prompt) {
    return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
  }

  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const ai = resolveImageProvider(modelConfig);

  // 将相对路径转为绝对路径，过滤掉不存在的文件
  const validRefs: Array<{ absPath: string; label: string }> = [];
  for (let i = 0; i < referenceImagePaths.length; i++) {
    const p = referenceImagePaths[i];
    if (!p) continue;
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    try {
      if (fs.existsSync(abs)) {
        validRefs.push({ absPath: abs, label: referenceLabels[i] ?? "" });
      }
    } catch { /* skip */ }
  }
  const cappedRefs = validRefs.slice(0, 14); // Seedream 最多 14 张

  // ── @图N 绑定：在 prompt 头部注入参考图说明 ──
  // 只声明"@图N 为X角色"，不替换正文里的角色名。
  // 原因：正文里的位置描述（由左至右：角色甲、角色乙...）是用户的空间排列意图，
  // 一旦替换成@图N数字编号，模型会按编号大小重排位置，违背用户意图。
  // 保留角色名原文 + 头部声明，模型能自动将声明与正文名字对应。
  if (cappedRefs.length > 0) {
    const prefix = cappedRefs
      .map((r, i) => (r.label ? `@图${i + 1} 为${r.label}角色` : `@图${i + 1}`))
      .join(" ");
    prompt = `${prefix},\n\n${prompt}\n\n严格保持各角色的面部特征、发型、服饰与对应参考图完全一致，不得改动。`;
  }

  const absRefPaths = cappedRefs.map((r) => r.absPath);
  console.log(`[CoverImageGenerate] refs=${absRefPaths.length}, prompt[:80]=${prompt.slice(0, 80)}...`);

  try {
    const imagePath = await ai.generateImage(prompt, {
      aspectRatio: "2:3",
      size: "1664x2496", // Seedream 5.0/4.5/4.0 官方推荐 2K 2:3
      quality: "hd",
      ...(absRefPaths.length > 0 ? { referenceImages: absRefPaths } : {}),
    });

    return NextResponse.json({ imagePath, status: "ok" });
  } catch (err) {
    console.error("[CoverImageGenerate] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Image generation failed" },
      { status: 500 }
    );
  }
}
