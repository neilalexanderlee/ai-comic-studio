import fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots, projects } from "@/lib/db/schema";
import { expandMotionScriptBrackets } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/visual-style-presets";
import { collectVisionFramePaths } from "@/lib/storyboard/shot-video-readiness.server";

type ShotRow = typeof shots.$inferSelect;

export type VideoPromptSyncDeps = {
  stripBgmContent: (text: string, bgmNote?: string | null) => string;
};

/** 当前磁盘上首帧 / AI 尾帧的路径 + mtime 指纹（保留用于兼容旧逻辑） */
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

/**
 * 直出模式：完全跳过 LLM，直接从分镜字段拼接视频提示词。
 *
 * 模板（对齐 Toonflow videoDesc 架构）：
 *   {startFrameDesc}。{expandMotionScriptBrackets(prose)}。{cameraDirection}。{visualStyleTag}。
 *
 * 优点：零幻觉、零动作顺序重排、即时输出、零 API 费用、不依赖帧图。
 */
export function buildDirectVideoPrompt(params: {
  shot: Pick<
    ShotRow,
    | "duration"
    | "startFrameDesc"
    | "endFrameDesc"
    | "motionScript"
    | "prompt"
    | "cameraDirection"
    | "bgmNote"
  >;
  visualStyleTag?: string;
  stripBgmContent: (text: string, bgmNote?: string | null) => string;
}): string {
  const { shot, visualStyleTag, stripBgmContent } = params;

  // 1. 起幅画面描述（首帧静止状态）
  const startFrame = shot.startFrameDesc?.trim() ?? "";

  // 2. 动作脚本展开（bracket 格式 → 纯散文；旧格式直通）
  //    若 motionScript 里已有内联台词（如 [铁狼:说：「...」音色：...]），
  //    expandMotionScriptBrackets 会在正确时间位置展开，无需末尾追加。
  const rawMotion = (shot.motionScript || shot.prompt || "").trim();
  const motionClean = stripBgmContent(rawMotion, shot.bgmNote);
  // prose: true — 去掉时间码前缀，跨段用「，随后」衔接，对齐 Toonflow 散文格式
  const expandedMotion = expandMotionScriptBrackets(motionClean, { prose: true });

  // 3. 运镜意图
  const cameraDir = (shot.cameraDirection || "").trim();

  // 4. 组装
  const parts: string[] = [];
  if (startFrame) parts.push(startFrame);
  if (expandedMotion) parts.push(expandedMotion);
  if (cameraDir) parts.push(cameraDir);
  if (visualStyleTag) parts.push(visualStyleTag);

  const body = parts.join("。");
  const duration = shot.duration ?? 10;
  return `Duration: ${duration}s.\n\n${body}`;
}

/**
 * 直出模式写入 DB。
 */
export async function generateAndPersistDirectVideoPrompt(params: {
  shot: ShotRow;
  userId: string;
  projectId: string;
  deps: VideoPromptSyncDeps;
}): Promise<string> {
  const { shot, deps } = params;

  const [projectRow] = await db
    .select({ visualStyle: projects.visualStyle })
    .from(projects)
    .where(eq(projects.id, params.projectId));
  const visualStyleTag = (() => {
    const style = projectRow?.visualStyle;
    if (!style) return undefined;
    return VISUAL_STYLE_PRESETS[style]?.tag || undefined;
  })();

  const videoPrompt = buildDirectVideoPrompt({
    shot,
    visualStyleTag,
    stripBgmContent: deps.stripBgmContent,
  });

  await db
    .update(shots)
    .set({ videoPrompt, videoPromptFrameFingerprint: null })
    .where(eq(shots.id, shot.id));

  return videoPrompt;
}

/**
 * 确保 videoPrompt 存在（为空时自动直出生成）。
 * 视频生成前调用，保证 prompt 不为空。
 */
export async function syncVideoPromptIfStale(params: {
  shot: ShotRow;
  userId: string;
  projectId: string;
  deps: VideoPromptSyncDeps;
  // 以下参数保留签名兼容性，实际不再使用
  shotCharacters?: unknown;
  shotDialogues?: unknown;
  modelConfig?: unknown;
}): Promise<{ videoPrompt: string | null; refreshed: boolean }> {
  if (params.shot.videoPrompt?.trim()) {
    return { videoPrompt: params.shot.videoPrompt, refreshed: false };
  }
  const videoPrompt = await generateAndPersistDirectVideoPrompt({
    shot: params.shot,
    userId: params.userId,
    projectId: params.projectId,
    deps: params.deps,
  });
  return { videoPrompt, refreshed: true };
}
