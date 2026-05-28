import fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import type { ModelConfigPayload } from "@/lib/provider-secrets";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";
import {
  buildRefVideoPromptRequest,
  getRefVideoPromptSystem,
} from "@/lib/ai/prompts/ref-video-prompt-generate";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { collectVisionFramePaths } from "@/lib/storyboard/shot-video-readiness.server";

type ShotRow = typeof shots.$inferSelect;

type EpisodeCharacter = {
  id: string;
  name: string;
  description?: string | null;
  visualHint?: string | null;
};

type DialogueRow = { text: string; characterId: string; sequence: number };

export type DialoguePromptEntry = {
  characterName: string;
  text: string;
  offscreen?: boolean;
  visualHint?: string;
  voiceHint?: string;
};

export type VideoPromptSyncDeps = {
  stripBgmContent: (text: string, bgmNote?: string | null) => string;
  ensureDialoguesInPrompt: (prompt: string, dialogueList: DialoguePromptEntry[]) => string;
  isCharacterOnScreen: (
    characterName: string,
    videoScript: string,
    startFrameDesc: string | null | undefined
  ) => boolean;
  stripThinkingBlocks?: (text: string) => string;
};

/** 当前磁盘上首帧 / AI 尾帧的路径 + mtime 指纹 */
export function computeVideoPromptFrameFingerprint(shot: {
  anchorFirst?: string | null;
  anchorLastAi?: string | null;
}): string | null {
  const paths = collectVisionFramePaths(shot);
  if (paths.length === 0) return null;

  const parts: string[] = [];
  for (const p of paths) {
    try {
      const stat = fs.statSync(p);
      parts.push(`${p}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${p}:missing`);
    }
  }
  return parts.join("|");
}

export function shouldRefreshVideoPrompt(shot: {
  videoPrompt?: string | null;
  videoPromptFrameFingerprint?: string | null;
  anchorFirst?: string | null;
  anchorLastAi?: string | null;
}): boolean {
  const fingerprint = computeVideoPromptFrameFingerprint(shot);
  if (!fingerprint) return false;
  if (!shot.videoPrompt?.trim()) return true;
  return shot.videoPromptFrameFingerprint !== fingerprint;
}

function defaultStripThinkingBlocks(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, "")
    .trim();
}

/**
 * Vision 精炼视频 prompt（与 single_video_prompt 同源），写入 DB 并更新帧指纹。
 */
export async function generateAndPersistVisionVideoPrompt(params: {
  shot: ShotRow;
  shotCharacters: EpisodeCharacter[];
  shotDialogues: DialogueRow[];
  modelConfig?: ModelConfigPayload;
  deps: VideoPromptSyncDeps;
}): Promise<string> {
  const { shot, shotCharacters, shotDialogues, modelConfig, deps } = params;
  const stripThinking = deps.stripThinkingBlocks ?? defaultStripThinkingBlocks;

  const visionFrames = collectVisionFramePaths(shot);
  if (visionFrames.length === 0) {
    throw new Error("No frame available. Generate frames first.");
  }

  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = getRefVideoPromptSystem(modelConfig?.video?.protocol);

  const videoContextForDialogue = shot.videoScript || shot.motionScript || shot.prompt || "";
  const dialogueList: DialoguePromptEntry[] = shotDialogues.map((d) => {
    const char = shotCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = deps.isCharacterOnScreen(
      characterName,
      videoContextForDialogue,
      shot.startFrameDesc
    );
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  const motionContext = deps.stripBgmContent(
    shot.videoScript || shot.motionScript || shot.prompt || "",
    shot.bgmNote
  );
  const allShotText = [shot.prompt, shot.startFrameDesc, shot.endFrameDesc, shot.videoScript, shot.motionScript]
    .filter(Boolean)
    .join(" ");
  const filteredCharsForPrompt = filterShotCharacters(allShotText, shotCharacters, {
    contextText: shot.startFrameDesc ?? undefined,
  });

  const promptRequest = buildRefVideoPromptRequest({
    motionScript: motionContext,
    cameraDirection: shot.cameraDirection || "static",
    duration: effectiveDuration,
    frameCount: visionFrames.length,
    characters: filteredCharsForPrompt,
    dialogues: dialogueList.length > 0 ? dialogueList : undefined,
  });

  const rawPrompt = await textProvider.generateText(promptRequest, {
    systemPrompt: refVideoSystem,
    images: visionFrames,
  });

  const videoPromptRaw = `Duration: ${effectiveDuration}s.\n\n${stripThinking(rawPrompt)}`;
  const videoPrompt = deps.ensureDialoguesInPrompt(videoPromptRaw, dialogueList);
  const fingerprint = computeVideoPromptFrameFingerprint(shot);

  await db
    .update(shots)
    .set({
      videoPrompt,
      videoPromptFrameFingerprint: fingerprint,
    })
    .where(eq(shots.id, shot.id));

  return videoPrompt;
}

/** B2：帧变更或尚无 videoPrompt 时自动 vision 精炼 */
export async function syncVideoPromptIfStale(params: {
  shot: ShotRow;
  shotCharacters: EpisodeCharacter[];
  shotDialogues: DialogueRow[];
  modelConfig?: ModelConfigPayload;
  deps: VideoPromptSyncDeps;
}): Promise<{ videoPrompt: string | null; refreshed: boolean }> {
  if (!shouldRefreshVideoPrompt(params.shot)) {
    return { videoPrompt: params.shot.videoPrompt, refreshed: false };
  }
  if (!params.modelConfig?.text) {
    return { videoPrompt: params.shot.videoPrompt, refreshed: false };
  }

  const videoPrompt = await generateAndPersistVisionVideoPrompt(params);
  return { videoPrompt, refreshed: true };
}
