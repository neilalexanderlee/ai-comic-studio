import { NextResponse } from "next/server";
import { streamText, generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes, characters, shots, dialogues, storyboardVersions, episodeCharacters, characterAssets } from "@/lib/db/schema";
import { eq, asc, and, lt, gt, desc, inArray } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import path from "path";
import { ulid } from "ulid";
import { enqueueTask } from "@/lib/task-queue";
import type { TaskType } from "@/lib/task-queue";
import { buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { buildScriptGeneratePrompt } from "@/lib/ai/prompts/script-generate";
import { buildCharacterExtractPrompt } from "@/lib/ai/prompts/character-extract";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { buildSceneFramePrompt } from "@/lib/ai/prompts/scene-frame-generate";
import { resolveImageProvider, resolveVideoProvider, resolveAIProvider } from "@/lib/ai/provider-factory";
import { buildVideoPrompt, buildReferenceVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { buildCharacterTurnaroundPrompt, buildBeautyImagePrompt, buildCombatImagePrompt } from "@/lib/ai/prompts/character-image";
import { resolveCharacterImages } from "@/lib/ai/character-router";
import { assembleVideo } from "@/lib/video/ffmpeg";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";
import { extractShotsFromScript } from "@/lib/storyboard/extract-shot-script";
import {
  getShotCharacters,
  persistStoryboardVersion,
  type PersistableShot,
} from "@/lib/storyboard/persist-storyboard-version";
import { finalizeExtractedShotsForDb } from "@/lib/storyboard/complete-extracted-shots";

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

/**
 * Check if a character is visible on-screen by looking for their name
 * in the videoScript or startFrameDesc fields.
 */
function isCharacterOnScreen(
  characterName: string,
  videoScript: string,
  startFrameDesc: string | null | undefined
): boolean {
  const text = `${videoScript} ${startFrameDesc ?? ""}`;
  return text.includes(characterName);
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

function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
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
    });
  }

  if (action === "shot_extract_preview") {
    return handleShotExtractPreview(projectId, episodeId);
  }

  if (action === "single_shot_rewrite") {
    return handleSingleShotRewrite(projectId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "frame_prompt_preview") {
    return handleFramePromptPreview(projectId, userId, payload, episodeId);
  }

  if (action === "batch_frame_generate") {
    return handleBatchFrameGenerate(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "single_frame_generate") {
    return handleSingleFrameGenerate(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "single_video_generate") {
    return handleSingleVideoGenerate(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "batch_video_generate") {
    return handleBatchVideoGenerate(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "single_scene_frame") {
    return handleSingleSceneFrame(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "batch_scene_frame") {
    return handleBatchSceneFrame(projectId, userId, payload, resolvedModelConfig, episodeId);
  }

  if (action === "single_reference_video") {
    return handleSingleReferenceVideo(projectId, userId, payload, resolvedModelConfig);
  }

  if (action === "batch_reference_video") {
    return handleBatchReferenceVideo(projectId, userId, payload, resolvedModelConfig, episodeId);
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
  const charExtractSystem = await resolvePrompt("character_extract", { userId, projectId });
  console.log("[CharacterExtract] resolved system prompt length:", charExtractSystem?.length ?? 0);

  const { text } = await generateText({
    model,
    system: charExtractSystem,
    prompt: buildCharacterExtractPrompt(script),
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
          scope: (char.scope === "guest" ? "guest" : "main") as "main" | "guest",
        })
        .where(eq(characters.id, existing.id));
      console.log(`[CharacterExtract] Updated existing character "${char.name}" (${existing.id}), desc length: ${char.description.length}`);
      linkedCharIds.push(existing.id);
      reusedCount++;
    } else {
      // Create new character
      const charId = ulid();
      const scope = char.scope === "guest" ? "guest" : "main";
      await db.insert(characters).values({
        id: charId,
        projectId,
        name: char.name,
        description: char.description,
        visualHint: char.visualHint ?? "",
        scope,
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
        const hasMorph = assets.some(a => a.assetType === "morph");
        
        if (hasMorph) return null; // Already has images

        const ai = resolveImageProvider(modelConfig);
        const slotContents = await resolveSlotContents("character_image", { userId, projectId });
        
        // Generate Turnaround (Blueprint)
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

        // Generate Daily (Morph)
        const dailyPrompt = buildBeautyImagePrompt(slotContents, character.name, character.description || "");
        const dailyPath = await ai.generateImage(dailyPrompt, {
          size: "2560x1440",
          aspectRatio: "16:9",
          quality: "hd",
        });

        await db.insert(characterAssets).values({
          id: ulid(),
          characterId: character.id,
          imagePath: dailyPath,
          tag: "日常",
          assetType: "morph",
          isDefault: 1
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
  options?: { forceAi?: boolean }
) {
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

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const shotCharacters = await getShotCharacters(projectId, episodeId);

  const characterDescriptions = shotCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const characterVisualHints = shotCharacters
    .filter((c) => c.visualHint)
    .map((c) => ({ name: c.name, visualHint: c.visualHint! }));

  const model = createLanguageModel(modelConfig.text);
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
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

  const extracted = extractShotsFromScript(fullScript);
  if (!options?.forceAi && extracted.detection.matched && extracted.shots.length > 0) {
    const persistableShots: PersistableShot[] = finalizeExtractedShotsForDb(
      extracted.shots
    );
    const warnings =
      extracted.warnings.length > 0 ? extracted.warnings : undefined;
    persistableShots.forEach((shot) => {
      shot.warnings = warnings;
    });

    const persisted = await persistStoryboardVersion({
      projectId,
      episodeId: episodeId ?? null,
      shotCharacters,
      shots: persistableShots,
    });

    console.log(
      `[ShotSplit] Extracted ${persisted.shotCount} shots directly from structured script (score=${extracted.detection.score})`
    );
    return NextResponse.json({
      shots: persisted.shotCount,
      mode: "extracted",
      warnings: extracted.warnings,
      reasons: extracted.detection.reasons,
    });
  }

  // Process chunks concurrently
  let lastError: string | null = null;
  const chunkResults = await Promise.all(
    sceneChunks.map(async (chunk, idx) => {
      const prompt = buildShotSplitPrompt(chunk, characterDescriptions, characterVisualHints);
      try {
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt,
          providerOptions: jsonMode,
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

  await persistStoryboardVersion({
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
  });

  console.log(`[ShotSplit] Created ${allShots.length} shots from ${sceneChunks.length} chunks`);
  return NextResponse.json({ shots: allShots.length });
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

// --- single_shot_rewrite: regenerate text fields for one shot ---

async function handleSingleShotRewrite(
  projectId: string,
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
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");
  const characterVisualHints = projectCharacters
    .filter((c) => c.visualHint)
    .map((c) => `${c.name}：${c.visualHint}`)
    .join("\n");

  const model = createLanguageModel(modelConfig.text);

  const prompt = `You are a storyboard director. Rewrite the text fields for a single shot so the descriptions are vivid, safe for AI image generation, and free of any potentially sensitive content.

Current shot (sequence ${shot.sequence}):
- Scene description: ${shot.prompt || ""}
- Start frame: ${shot.startFrameDesc || ""}
- End frame: ${shot.endFrameDesc || ""}
- Motion script: ${shot.motionScript || ""}
- Video script: ${shot.videoScript || ""}
- Camera direction: ${shot.cameraDirection || "static"}
- Duration: ${shot.duration}s

Character references:
${characterDescriptions || "none"}
${characterVisualHints ? `\nCHARACTER VISUAL IDs (MANDATORY — whenever a character appears in any field, write their name followed by exactly this identifier in parentheses, e.g. 天枢真君（银发金瞳）. Never invent alternatives):\n${characterVisualHints}` : ""}

Return ONLY a JSON object (no markdown fences) with these fields:
{
  "prompt": "rewritten scene description",
  "startFrameDesc": "rewritten start frame description",
  "endFrameDesc": "rewritten end frame description",
  "motionScript": "rewritten motion script in time-segmented format (0-Xs: ... Xs-Ys: ...)",
  "videoScript": "rewritten concise video model prompt: 1-2 sentences, no timestamps, just core motion and camera arc",
  "cameraDirection": "camera direction (keep original or adjust)"
}

IMPORTANT: Keep the same scene, characters, and narrative intent. Only rephrase to avoid safety filter triggers. Match the language of the original text.`;

  console.log(`[SingleShotRewrite] Shot ${shot.sequence} prompt length=${prompt.length}`);

  try {
    const { text } = await import("ai").then(({ generateText }) =>
      generateText({ model, prompt, temperature: 0.7 })
    );

    const parsed = JSON.parse(extractJSON(text)) as {
      prompt: string;
      startFrameDesc: string;
      endFrameDesc: string;
      motionScript: string;
      videoScript?: string;
      cameraDirection: string;
    };

    await db
      .update(shots)
      .set({
        prompt: parsed.prompt,
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

  const firstPrompt = buildFirstFramePrompt({
    sceneDescription: shot.prompt || "",
    startFrameDesc: shot.startFrameDesc || shot.prompt || "",
    characterDescriptions,
    previousLastFrame: previousShot?.lastFrame || undefined,
    slotContents: frameFirstSlots,
  });

  const lastPrompt = buildLastFramePrompt({
    sceneDescription: shot.prompt || "",
    endFrameDesc: shot.endFrameDesc || shot.prompt || "",
    characterDescriptions,
    firstFramePath: shot.firstFrame || previousShot?.lastFrame || "first-frame-reference",
    slotContents: frameLastSlots,
  });

  return NextResponse.json({
    shotId,
    reusePreviousLastFrame: Boolean(previousShot?.lastFrame),
    firstPrompt,
    lastPrompt,
    startFrameDesc: shot.startFrameDesc || shot.prompt || "",
    endFrameDesc: shot.endFrameDesc || shot.prompt || "",
  });
}

// --- batch_frame_generate: sequential frame generation with continuity chain ---

async function handleBatchFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return NextResponse.json({ results: [], message: "No shots found" });
  }

  const continueFromPrev = payload?.continueFromPrev === true;
  let copiedFirstFrame: string | undefined;

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  if (continueFromPrev && episodeId) {
    // 1. Get current episode's sequence
    const [currentEp] = await db
      .select({ sequence: episodes.sequence })
      .from(episodes)
      .where(eq(episodes.id, episodeId));

    if (currentEp && currentEp.sequence > 1) {
      // 2. Find previous episode
      const [prevEp] = await db
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.projectId, projectId),
            eq(episodes.sequence, currentEp.sequence - 1)
          )
        );

      if (prevEp) {
        // 3. Get last shot of previous episode
        const [lastShot] = await db
          .select({ lastFrame: shots.lastFrame })
          .from(shots)
          .where(eq(shots.episodeId, prevEp.id))
          .orderBy(desc(shots.sequence))
          .limit(1);

        if (!lastShot?.lastFrame) {
          return NextResponse.json(
            { error: "上一集尚未生成帧，无法续接" },
            { status: 400 }
          );
        }

        // 4. Copy the file
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { ulid: genId } = await import("ulid");
        const ext = path.extname(lastShot.lastFrame);
        const destDir = path.resolve(versionedUploadDir, "frames");
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, `${genId()}${ext}`);
        fs.copyFileSync(path.resolve(lastShot.lastFrame), destPath);
        const relativeDest = path.relative(process.cwd(), destPath);

        // 5. Update first shot's firstFrame
        if (allShots.length > 0) {
          await db
            .update(shots)
            .set({ firstFrame: relativeDest })
            .where(eq(shots.id, allShots[0].id));
          allShots[0] = { ...allShots[0], firstFrame: relativeDest };
          copiedFirstFrame = relativeDest;
        }
      }
    }
  }

  // Fetch only characters linked to this episode
  let frameCharacters: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    frameCharacters = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : [];
  } else {
    frameCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  const characterDescriptions = frameCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const results: Array<{ shotId: string; sequence: number; status: string; firstFrame?: string; lastFrame?: string; error?: string }> = [];

  const overwrite = payload?.overwrite === true;
  const needProcess = allShots.filter((s) => overwrite || !s.firstFrame || !s.lastFrame);
  const skipCount = allShots.length - needProcess.length;

  console.log(`[BatchFrameGenerate] Total: ${allShots.length} shots, need: ${needProcess.length}, skip: ${skipCount}, characters: ${frameCharacters.length}`);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  let previousLastFrame: string | undefined;

  for (let i = 0; i < allShots.length; i++) {
    const shot = allShots[i];

    // Skip completed shots in normal mode, but advance the chain from their existing lastFrame
    if (!overwrite && shot.firstFrame && shot.lastFrame) {
      previousLastFrame = shot.lastFrame;
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "skipped",
      });
      continue;
    }

    const startTime = Date.now();
    try {
      await db
        .update(shots)
        .set({ status: "generating" })
        .where(eq(shots.id, shot.id));

      let firstFramePath: string;

      if (copiedFirstFrame && i === 0) {
        // Episode continuation: use copied frame from previous episode
        firstFramePath = copiedFirstFrame;
      } else if (i === 0 || !previousLastFrame) {
        // First shot or broken chain: generate first frame
        const resolvedChars = await resolveCharacterImages(
          shot.prompt || "",
          frameCharacters,
          modelConfig?.text,
          userId,
          projectId
        );
        await saveShotWarnings(shot.id, resolvedChars);
        const charRefImages = resolvedChars.map((c) => c.imagePath);
        const charRefLabels = resolvedChars.map((c) => c.name);

        const firstPrompt = buildFirstFramePrompt({
          sceneDescription: shot.prompt || "",
          startFrameDesc: shot.startFrameDesc || shot.prompt || "",
          characterDescriptions,
          slotContents: frameFirstSlots,
        });
        firstFramePath = await ai.generateImage(firstPrompt, {
          ...imageOpts,
          quality: "hd",
          referenceImages: charRefImages,
          referenceLabels: charRefLabels,
        });
      } else {
        // Continuity chain: reuse previous shot's last frame
        firstFramePath = previousLastFrame;
      }

      // Generate last frame for this shot
      const resolvedChars = await resolveCharacterImages(
        shot.prompt || "",
        frameCharacters,
        modelConfig?.text,
        userId,
        projectId
      );
      await saveShotWarnings(shot.id, resolvedChars);
      const charRefImages = resolvedChars.map((c) => c.imagePath);
      const charRefLabels = resolvedChars.map((c) => c.name);

      const lastPrompt = buildLastFramePrompt({
        sceneDescription: shot.prompt || "",
        endFrameDesc: shot.endFrameDesc || shot.prompt || "",
        characterDescriptions,
        firstFramePath,
        slotContents: frameLastSlots,
      });
      const lastFramePath = await ai.generateImage(lastPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: [firstFramePath, ...charRefImages],
          referenceLabels: ["首帧/First Frame", ...charRefLabels],
      });

      await db
        .update(shots)
        .set({
          firstFrame: firstFramePath,
          lastFrame: lastFramePath,
          status: "completed",
        })
        .where(eq(shots.id, shot.id));

      previousLastFrame = lastFramePath;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[BatchFrameGenerate] Shot ${shot.sequence}/${allShots.length} completed (${elapsed}s)`);

      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        firstFrame: firstFramePath,
        lastFrame: lastFramePath,
      });
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[BatchFrameGenerate] Shot ${shot.sequence}/${allShots.length} failed (${elapsed}s):`, err);
      await db
        .update(shots)
        .set({ status: "failed" })
        .where(eq(shots.id, shot.id));
      previousLastFrame = undefined; // Break chain so next shot generates its own first frame
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: extractErrorMessage(err),
      });
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  console.log(`[BatchFrameGenerate] Done: ${okCount} ok, ${errCount} errors, ${skipCount} skipped`);

  return NextResponse.json({ results });
}

// --- single_frame_generate: synchronous frame generation for one shot ---

async function handleSingleFrameGenerate(
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

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const resolvedChars = await resolveCharacterImages(
    shot.prompt || "",
    projectCharacters,
    modelConfig?.text,
    userId,
    projectId
  );
  await saveShotWarnings(shotId, resolvedChars);
  const charRefImages = resolvedChars.map((c) => c.imagePath);

  // Find previous shot's last frame for continuity — same version only (if shot has a version)
  const [previousShot] = shot.versionId
    ? await db
        .select()
        .from(shots)
        .where(and(
          eq(shots.projectId, projectId),
          eq(shots.versionId, shot.versionId),
          lt(shots.sequence, shot.sequence)
        ))
        .orderBy(desc(shots.sequence))
        .limit(1)
    : await db
        .select()
        .from(shots)
        .where(and(
          eq(shots.projectId, projectId),
          lt(shots.sequence, shot.sequence)
        ))
        .orderBy(desc(shots.sequence))
        .limit(1);

  const [nextShot] = shot.versionId
    ? await db
        .select()
        .from(shots)
        .where(and(
          eq(shots.projectId, projectId),
          eq(shots.versionId, shot.versionId),
          gt(shots.sequence, shot.sequence)
        ))
        .orderBy(asc(shots.sequence))
        .limit(1)
    : await db
        .select()
        .from(shots)
        .where(and(
          eq(shots.projectId, projectId),
          gt(shots.sequence, shot.sequence)
        ))
        .orderBy(asc(shots.sequence))
        .limit(1);

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    // Reuse previous shot's lastFrame directly — no need to regenerate
    let firstFramePath: string;
    if (previousShot?.lastFrame) {
      firstFramePath = previousShot.lastFrame;
    } else {
      const firstPrompt = buildFirstFramePrompt({
        sceneDescription: shot.prompt || "",
        startFrameDesc: shot.startFrameDesc || shot.prompt || "",
        characterDescriptions,
        slotContents: frameFirstSlots,
      });
      firstFramePath = await ai.generateImage(firstPrompt, {
        ...imageOpts,
        quality: "hd",
        referenceImages: charRefImages,
      });
    }

    const lastPrompt = buildLastFramePrompt({
      sceneDescription: shot.prompt || "",
      endFrameDesc: shot.endFrameDesc || shot.prompt || "",
      characterDescriptions,
      firstFramePath,
      slotContents: frameLastSlots,
    });
    const lastFramePath = await ai.generateImage(lastPrompt, {
      ...imageOpts,
      quality: "hd",
      referenceImages: [firstFramePath, ...charRefImages],
    });

    await db
      .update(shots)
      .set({ firstFrame: firstFramePath, lastFrame: lastFramePath, status: "completed" })
      .where(eq(shots.id, shotId));

    // Sync next shot's firstFrame to maintain continuity chain
    if (nextShot) {
      await db
        .update(shots)
        .set({ firstFrame: lastFramePath })
        .where(eq(shots.id, nextShot.id));
    }

    return NextResponse.json({ shotId, firstFrame: firstFramePath, lastFrame: lastFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleFrameGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

// --- single_video_generate: synchronous video generation for one shot ---

async function handleSingleVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
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
  if (!shot.firstFrame || !shot.lastFrame) {
    return NextResponse.json({ error: "Shot frames not generated yet" }, { status: 400 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const shotCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));
  const characterDescriptions = shotCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const ratio = (payload?.ratio as string) || "16:9";

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

    const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
    const videoContextForDialogue = videoScript;
    const onScreenDialogueChars = shotDialogues
      .map((d) => shotCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown")
      .filter((name) => isCharacterOnScreen(name, videoContextForDialogue, shot.startFrameDesc));

    const dialogueList = shotDialogues.map((d) => {
      const char = shotCharacters.find((c) => c.id === d.characterId);
      const characterName = char?.name ?? "Unknown";
      const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shot.startFrameDesc);
      const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
      return {
        characterName,
        text: d.text,
        offscreen: !onScreen,
        visualHint,
      };
    });
    const videoPrompt = shot.videoPrompt || buildVideoPrompt({
      videoScript,
      cameraDirection: shot.cameraDirection || "static",
      startFrameDesc: shot.startFrameDesc ?? undefined,
      endFrameDesc: shot.endFrameDesc ?? undefined,
      duration: effectiveDuration,
      characters: shotCharacters,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      slotContents: videoSlots,
    });

    const result = await videoProvider.generateVideo({
      firstFrame: shot.firstFrame,
      lastFrame: shot.lastFrame,
      prompt: videoPrompt,
      duration: effectiveDuration,
      ratio,
    });

    await db
      .update(shots)
      .set({ videoUrl: result.filePath, status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, videoUrl: result.filePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

// --- batch_video_generate: sequential video generation for all eligible shots ---

async function handleBatchVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const overwrite = payload?.overwrite === true;
  const eligible = allShots.filter((s) =>
    s.firstFrame && s.lastFrame && (overwrite || !s.videoUrl)
  );
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);
  const characterDescriptions = batchCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const ratio = (payload?.ratio as string) || "16:9";
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  // Mark all as generating
  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const results = await Promise.all(
    eligible.map(async (shot): Promise<{ shotId: string; sequence: number; status: "ok" | "error"; videoUrl?: string; error?: string }> => {
      try {
        const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
        const shotDialogues = await db
          .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
          .from(dialogues)
          .where(eq(dialogues.shotId, shot.id))
          .orderBy(asc(dialogues.sequence));

        const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
        const videoContextForDialogue = videoScript;
        const onScreenDialogueChars = shotDialogues
          .map((d) => batchCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown")
          .filter((name) => isCharacterOnScreen(name, videoContextForDialogue, shot.startFrameDesc));

        const dialogueList = shotDialogues.map((d) => {
          const char = batchCharacters.find((c) => c.id === d.characterId);
          const characterName = char?.name ?? "Unknown";
          const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shot.startFrameDesc);
          const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
          return {
            characterName,
            text: d.text,
            offscreen: !onScreen,
            visualHint,
          };
        });

        const videoPrompt = shot.videoPrompt || buildVideoPrompt({
          videoScript,
          cameraDirection: shot.cameraDirection || "static",
          startFrameDesc: shot.startFrameDesc ?? undefined,
          endFrameDesc: shot.endFrameDesc ?? undefined,
          duration: effectiveDuration,
          characters: batchCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          slotContents: videoSlots,
        });

        const result = await videoProvider.generateVideo({
          firstFrame: shot.firstFrame!,
          lastFrame: shot.lastFrame!,
          prompt: videoPrompt,
          duration: effectiveDuration,
          ratio,
        });

        await db
          .update(shots)
          .set({ videoUrl: result.filePath, status: "completed" })
          .where(eq(shots.id, shot.id));

        console.log(`[BatchVideoGenerate] Shot ${shot.sequence} completed`);
        return { shotId: shot.id, sequence: shot.sequence, status: "ok", videoUrl: result.filePath };
      } catch (err) {
        console.error(`[BatchVideoGenerate] Error for shot ${shot.sequence}:`, err);
        await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
        return { shotId: shot.id, sequence: shot.sequence, status: "error", error: extractErrorMessage(err) };
      }
    })
  );

  return NextResponse.json({ results });
}

// --- single_scene_frame: generate Toonflow-style scene reference frame only ---

async function handleSingleSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string | undefined;
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

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  const charRefs = await resolveCharacterImages(
    shot.prompt || "",
    projectCharacters,
    modelConfig?.text,
    userId,
    projectId
  );
  await saveShotWarnings(shotId, charRefs);

  if (charRefs.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available. Please generate character reference images first." },
      { status: 400 }
    );
  }

  const charRefMapping = charRefs.map((c, i) => `${c.name}=图片${i + 1}`).join("，");
  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
    const slotContents = await resolveSlotContents("scene_frame_generate", { userId, projectId });
    const sceneFramePrompt = buildSceneFramePrompt({
      sceneDescription: shot.prompt || "",
      charRefMapping,
      characterDescriptions,
      cameraDirection: shot.cameraDirection,
      startFrameDesc: shot.startFrameDesc,
      motionScript: shot.motionScript,
      slotContents,
    });

    console.log(`[SingleSceneFrame] Shot ${shot.sequence}: generating scene frame, mapping="${charRefMapping}"`);

    const sceneFramePath = await imageProvider.generateImage(sceneFramePrompt, {
      quality: "hd",
      referenceImages: charRefs.map((c) => c.imagePath),
    });

    await db
      .update(shots)
      .set({ sceneRefFrame: sceneFramePath, status: "pending" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, sceneRefFrame: sceneFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleSceneFrame] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

// --- batch_scene_frame: generate scene reference frames for all eligible shots ---

async function handleBatchSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const overwrite = payload?.overwrite === true;
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const eligible = allShots.filter(
    (s) => s.status !== "generating" && (overwrite || !s.sceneRefFrame)
  );
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
  const sceneSlotContents = await resolveSlotContents("scene_frame_generate", { userId, projectId });

  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const results: Array<{
    shotId: string;
    sequence: number;
    status: "ok" | "error";
    sceneRefFrame?: string;
    error?: string;
  }> = [];

  for (const shot of eligible) {
    try {
      const charRefs = await resolveCharacterImages(
        shot.prompt || "",
        projectCharacters,
        modelConfig?.text,
        userId,
        projectId
      );
      const charRefMapping = charRefs.map((c, i) => `${c.name}=图片${i + 1}`).join("，");

      const sceneFramePrompt = buildSceneFramePrompt({
        sceneDescription: shot.prompt || "",
        charRefMapping,
        characterDescriptions,
        cameraDirection: shot.cameraDirection,
        startFrameDesc: shot.startFrameDesc,
        slotContents: sceneSlotContents,
        motionScript: shot.motionScript,
      });

      console.log(`[BatchSceneFrame] Shot ${shot.sequence}: generating scene frame, mapping="${charRefMapping}"`);

      const sceneFramePath = await imageProvider.generateImage(sceneFramePrompt, {
        quality: "hd",
        referenceImages: charRefs.map((c) => c.imagePath),
      });

      await db
        .update(shots)
        .set({ sceneRefFrame: sceneFramePath, status: "pending" })
        .where(eq(shots.id, shot.id));

      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", sceneRefFrame: sceneFramePath });
    } catch (err) {
      console.error(`[BatchSceneFrame] Error for shot ${shot.sequence}:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "error", error: extractErrorMessage(err) });
    }
  }

  return NextResponse.json({ results });
}

// --- single_reference_video: text2video with character reference images ---

async function handleSingleReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  // Toonflow pattern: collect all character reference images
  const charRefs = await resolveCharacterImages(
    shot.prompt || "",
    projectCharacters,
    modelConfig?.text,
    userId,
    projectId
  );
  await saveShotWarnings(shotId, charRefs);

  if (charRefs.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available. Please generate character reference images first." },
      { status: 400 }
    );
  }

  // Build Toonflow name→image mapping: "角色A=图片1，角色B=图片2"
  const charRefMapping = charRefs.map((c, i) => `${c.name}=图片${i + 1}`).join("，");

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";
  const onScreenDialogueChars = shotDialogues
    .map((d) => projectCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown")
    .filter((name) => isCharacterOnScreen(name, videoContextForDialogue, shot.startFrameDesc));
  
  const dialogueList = shotDialogues.map((d) => {
    const char = projectCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shot.startFrameDesc);
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  const ratio = (payload?.ratio as string) || "16:9";
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    // Step 1: Reuse existing scene ref frame, or generate a new one (Toonflow-style)
    let sceneFramePath = shot.sceneRefFrame ?? null;
    if (!sceneFramePath) {
      const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
      const refSlotContents = await resolveSlotContents("scene_frame_generate", { userId, projectId });
      const sceneFramePrompt = buildSceneFramePrompt({
        sceneDescription: shot.prompt || "",
        charRefMapping,
        characterDescriptions,
        cameraDirection: shot.cameraDirection,
        startFrameDesc: shot.startFrameDesc,
        motionScript: shot.motionScript,
        slotContents: refSlotContents,
      });
      console.log(`[SingleReferenceVideo] Shot ${shot.sequence}: generating scene frame, mapping="${charRefMapping}"`);
      sceneFramePath = await imageProvider.generateImage(sceneFramePrompt, {
        quality: "hd",
        referenceImages: charRefs.map((c) => c.imagePath),
      });
      await db.update(shots).set({ sceneRefFrame: sceneFramePath }).where(eq(shots.id, shotId));
    } else {
      console.log(`[SingleReferenceVideo] Shot ${shot.sequence}: reusing existing scene frame`);
    }

    // Step 2: Generate video using scene frame as initial image
    const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

    // Step 2b: Use stored videoPrompt if available; otherwise generate from scene frame via vision AI
    let videoPrompt: string;
    if (shot.videoPrompt) {
      videoPrompt = shot.videoPrompt;
    } else {
      const textProvider = resolveAIProvider(modelConfig);
      const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
      try {
        const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
        const promptRequest = buildRefVideoPromptRequest({
          motionScript: motionContext,
          cameraDirection: shot.cameraDirection || "static",
          duration: effectiveDuration,
          characters: projectCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
        });
        console.log(`[SingleReferenceVideo] Shot ${shot.sequence} promptRequest length=${promptRequest.length}`);
        const rawPrompt = await textProvider.generateText(promptRequest, {
          systemPrompt: refVideoSystem,
          images: [sceneFramePath],
          temperature: 0.7,
        });
        videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
      } catch (err) {
        console.warn("[SingleReferenceVideo] Vision prompt generation failed, falling back:", err);
        videoPrompt = buildReferenceVideoPrompt({
          videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
          cameraDirection: shot.cameraDirection || "static",
          duration: effectiveDuration,
          characters: projectCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          slotContents: refVideoSlots,
        });
      }
    }

    console.log(`[SingleReferenceVideo] Shot ${shot.sequence}: generating video from scene frame`);

    const result = await videoProvider.generateVideo({
      initialImage: sceneFramePath,
      prompt: videoPrompt,
      duration: effectiveDuration,
      ratio,
      referenceImages: charRefs.map((c) => c.imagePath),
    });

    await db
      .update(shots)
      .set({
        referenceVideoUrl: result.filePath,
        lastFrameUrl: result.lastFrameUrl ?? null,
        status: "completed",
      })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, referenceVideoUrl: result.filePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleReferenceVideo] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

// --- batch_reference_video: sequential text2video for all eligible shots ---

async function handleBatchReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const overwrite = payload?.overwrite === true;
  const eligible = allShots.filter(
    (s) => s.status !== "generating" && (overwrite || !s.referenceVideoUrl)
  );
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
  const ratio = (payload?.ratio as string) || "16:9";
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const results = await Promise.all(
    eligible.map(async (shot): Promise<{ shotId: string; sequence: number; status: "ok" | "error"; referenceVideoUrl?: string; error?: string }> => {
      try {
        const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
        const shotDialogues = await db
          .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
          .from(dialogues)
          .where(eq(dialogues.shotId, shot.id))
          .orderBy(asc(dialogues.sequence));
        const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";
        const onScreenDialogueChars = shotDialogues
          .map((d) => projectCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown")
          .filter((name) => isCharacterOnScreen(name, videoContextForDialogue, shot.startFrameDesc));

        const dialogueList = shotDialogues.map((d) => {
          const char = projectCharacters.find((c) => c.id === d.characterId);
          const characterName = char?.name ?? "Unknown";
          const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shot.startFrameDesc);
          const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
          return {
            characterName,
            text: d.text,
            offscreen: !onScreen,
            visualHint,
          };
        });

        // Step 1: Generate scene reference frame (Toonflow-style)
        const charRefs = await resolveCharacterImages(
          shot.prompt || "",
          projectCharacters,
          modelConfig?.text,
          userId,
          projectId
        );
        await saveShotWarnings(shot.id, charRefs);
        const charRefMapping = charRefs.map((c, i) => `${c.name}=图片${i + 1}`).join("，");
        
        const batchRefSlots = await resolveSlotContents("scene_frame_generate", { userId, projectId });
        const sceneFramePrompt = buildSceneFramePrompt({
          sceneDescription: shot.prompt || "",
          charRefMapping,
          characterDescriptions,
          cameraDirection: shot.cameraDirection,
          startFrameDesc: shot.startFrameDesc,
          motionScript: shot.motionScript,
          slotContents: batchRefSlots,
        });

        console.log(`[BatchReferenceVideo] Shot ${shot.sequence}: generating scene frame, mapping="${charRefMapping}"`);

        const sceneFramePath = await imageProvider.generateImage(sceneFramePrompt, {
          quality: "hd",
          referenceImages: charRefs.map((c) => c.imagePath),
        });

        // Save scene frame for display (separate field — does not pollute firstFrame used by keyframe mode)
        await db.update(shots).set({ sceneRefFrame: sceneFramePath }).where(eq(shots.id, shot.id));

        // Step 2: Use stored videoPrompt if available; otherwise generate from scene frame via vision AI
        let videoPrompt: string;
        if (shot.videoPrompt) {
          videoPrompt = shot.videoPrompt;
        } else {
          try {
            const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
            const promptRequest = buildRefVideoPromptRequest({
              motionScript: motionContext,
              cameraDirection: shot.cameraDirection || "static",
              duration: effectiveDuration,
              characters: projectCharacters,
              dialogues: dialogueList.length > 0 ? dialogueList : undefined,
            });
            const rawPrompt = await textProvider.generateText(promptRequest, {
              systemPrompt: refVideoSystem,
              images: [sceneFramePath],
              temperature: 0.7,
            });
            videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
          } catch (err) {
            console.warn("[BatchReferenceVideo] Vision prompt generation failed, falling back:", err);
            videoPrompt = buildReferenceVideoPrompt({
              videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
              cameraDirection: shot.cameraDirection || "static",
              duration: effectiveDuration,
              characters: projectCharacters,
              dialogues: dialogueList.length > 0 ? dialogueList : undefined,
              slotContents: refVideoSlots,
            });
          }
        }

        console.log(`[BatchReferenceVideo] Shot ${shot.sequence}: generating video from scene frame`);

        const result = await videoProvider.generateVideo({
          initialImage: sceneFramePath,
          prompt: videoPrompt,
          duration: effectiveDuration,
          ratio,
          referenceImages: charRefs.map((c) => c.imagePath),
        });

        await db
          .update(shots)
          .set({
            referenceVideoUrl: result.filePath,
            lastFrameUrl: result.lastFrameUrl ?? null,
            status: "completed",
          })
          .where(eq(shots.id, shot.id));

        console.log(`[BatchReferenceVideo] Shot ${shot.sequence} completed`);
        return { shotId: shot.id, sequence: shot.sequence, status: "ok", referenceVideoUrl: result.filePath };
      } catch (err) {
        console.error(`[BatchReferenceVideo] Error for shot ${shot.sequence}:`, err);
        await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
        return {
          shotId: shot.id,
          sequence: shot.sequence,
          status: "error",
          error: extractErrorMessage(err),
        };
      }
    })
  );

  return NextResponse.json({ results });
}

// --- video_assemble: synchronous ffmpeg concat + subtitle burn ---

async function handleVideoAssembleSync(projectId: string, payload?: Record<string, unknown>, episodeId?: string) {
  let generationModeValue: string = "keyframe";
  if (episodeId) {
    const [episode] = await db.select({ generationMode: episodes.generationMode }).from(episodes).where(eq(episodes.id, episodeId));
    generationModeValue = episode?.generationMode ?? "keyframe";
  } else {
    const [project] = await db.select({ generationMode: projects.generationMode }).from(projects).where(eq(projects.id, projectId));
    generationModeValue = project?.generationMode ?? "keyframe";
  }

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

  const isReference = generationModeValue === "reference";
  const videoPaths = projectShots
    .map((s) => isReference ? s.referenceVideoUrl : s.videoUrl)
    .filter(Boolean) as string[];

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

  // Determine generation mode to decide which frames to pass
  let genMode = "keyframe";
  if (shot.episodeId) {
    const [ep] = await db.select({ generationMode: episodes.generationMode }).from(episodes).where(eq(episodes.id, shot.episodeId));
    genMode = ep?.generationMode ?? "keyframe";
  } else {
    const [proj] = await db.select({ generationMode: projects.generationMode }).from(projects).where(eq(projects.id, projectId));
    genMode = proj?.generationMode ?? "keyframe";
  }

  // Keyframe mode: pass first + last frames for transition description
  // Reference mode: pass only the scene reference frame
  const visionFrames: string[] = [];
  if (genMode === "reference") {
    if (shot.sceneRefFrame) visionFrames.push(shot.sceneRefFrame);
  } else {
    if (shot.firstFrame) visionFrames.push(shot.firstFrame);
    if (shot.lastFrame) visionFrames.push(shot.lastFrame);
    if (visionFrames.length === 0 && shot.sceneRefFrame) visionFrames.push(shot.sceneRefFrame);
  }
  console.log(`[SingleVideoPrompt] shot.sequence=${shot.sequence}, mode=${genMode}, frames=${visionFrames.length}`);
  if (visionFrames.length === 0) {
    return NextResponse.json({ error: "No frame available. Generate frames first." }, { status: 400 });
  }

  const shotCharacters = await db.select().from(characters).where(eq(characters.projectId, shot.projectId));
  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue = shot.videoScript || shot.motionScript || shot.prompt || "";
  const onScreenDialogueChars = shotDialogues
    .map((d) => shotCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown")
    .filter((name) => isCharacterOnScreen(name, videoContextForDialogue, shot.startFrameDesc));
  
  const dialogueList = shotDialogues.map((d) => {
    const char = shotCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shot.startFrameDesc);
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  try {
    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
    const textProvider = resolveAIProvider(modelConfig);
    const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
    const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
    const promptRequest = buildRefVideoPromptRequest({
      motionScript: motionContext,
      cameraDirection: shot.cameraDirection || "static",
      duration: effectiveDuration,
      characters: shotCharacters,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
    });
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence} promptRequest length=${promptRequest.length}`);
    const rawPrompt = await textProvider.generateText(promptRequest, {
      systemPrompt: refVideoSystem,
      images: visionFrames,
    });
    const videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence} videoPrompt length=${videoPrompt.length}`);
    await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shotId));
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

  // Only process shots that have frames
  const eligible = batchShots.filter((s) => s.firstFrame || s.lastFrame || s.sceneRefFrame);

  // Determine generation mode for frame selection
  let batchGenMode = "keyframe";
  if (episodeId) {
    const [ep] = await db.select({ generationMode: episodes.generationMode }).from(episodes).where(eq(episodes.id, episodeId));
    batchGenMode = ep?.generationMode ?? "keyframe";
  } else {
    const [proj] = await db.select({ generationMode: projects.generationMode }).from(projects).where(eq(projects.id, projectId));
    batchGenMode = proj?.generationMode ?? "keyframe";
  }

  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);

  console.log(`[BatchVideoPrompt] Processing ${eligible.length} shots (${batchShots.length} total, ${batchCharacters.length} chars, mode=${batchGenMode})`);
  const bvpStartTime = Date.now();

  const results = await Promise.all(
    eligible.map(async (shot) => {
      try {
        const shotStart = Date.now();
        const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
        // Keyframe: pass first + last frames; Reference: pass only scene ref frame
        const visionFrames: string[] = [];
        if (batchGenMode === "reference") {
          if (shot.sceneRefFrame) visionFrames.push(shot.sceneRefFrame);
        } else {
          if (shot.firstFrame) visionFrames.push(shot.firstFrame);
          if (shot.lastFrame) visionFrames.push(shot.lastFrame);
          if (visionFrames.length === 0 && shot.sceneRefFrame) visionFrames.push(shot.sceneRefFrame);
        }
        const shotDialogues = await db
          .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
          .from(dialogues)
          .where(eq(dialogues.shotId, shot.id))
          .orderBy(asc(dialogues.sequence));
        const videoContextForDialogue = shot.videoScript || shot.motionScript || shot.prompt || "";

        const dialogueList = shotDialogues.map((d) => {
          const char = batchCharacters.find((c) => c.id === d.characterId);
          const characterName = char?.name ?? "Unknown";
          const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shot.startFrameDesc);
          const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
          return {
            characterName,
            text: d.text,
            offscreen: !onScreen,
            visualHint,
          };
        });

        const motionContext = shot.videoScript || shot.motionScript || shot.prompt || "";
        const promptRequest = buildRefVideoPromptRequest({
          motionScript: motionContext,
          cameraDirection: shot.cameraDirection || "static",
          duration: effectiveDuration,
          characters: batchCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
        });
        const rawPrompt = await textProvider.generateText(promptRequest, {
          systemPrompt: refVideoSystem,
          images: visionFrames,
        });
        const videoPrompt = `Duration: ${effectiveDuration}s.\n\n${rawPrompt.trim()}`;
        await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shot.id));
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
