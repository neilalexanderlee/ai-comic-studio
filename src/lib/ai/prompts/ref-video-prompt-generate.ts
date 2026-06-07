/**
 * AI video prompt generation for reference image mode.
 *
 * Grounded in official Seedance 1.5 Pro Prompt Guide (Volcano Engine, 2025).
 * System prompts are editable via prompt registry key `ref_video_prompt` (per protocol slot).
 */

import { resolveSlotContents } from "./resolver";
import {
  GENERIC_SYSTEM,
  JIMENG_VIDEO_SYSTEM,
  KLING_SYSTEM,
  REF_VIDEO_PROMPT_DEFAULT_SLOTS,
  SEEDANCE_SYSTEM,
  VEO_SYSTEM,
  type RefVideoPromptSlotKey,
} from "./ref-video-prompt-defaults";

export {
  GENERIC_SYSTEM,
  JIMENG_VIDEO_SYSTEM,
  KLING_SYSTEM,
  REF_VIDEO_PROMPT_DEFAULT_SLOTS,
  SEEDANCE_SYSTEM,
  VEO_SYSTEM,
} from "./ref-video-prompt-defaults";

export type ResolvePromptOptions = {
  userId: string;
  projectId?: string;
};

/** Map video provider protocol → registry slot key */
export function refVideoProtocolToSlotKey(videoProtocol?: string): RefVideoPromptSlotKey {
  switch (videoProtocol) {
    case "kling":
      return "kling_system";
    case "jimeng-video":
      return "jimeng_video_system";
    case "gemini":
      return "veo_system";
    default:
      return "seedance_system";
  }
}

const CODE_FALLBACK_BY_SLOT: Record<RefVideoPromptSlotKey, string> = {
  seedance_system: SEEDANCE_SYSTEM,
  kling_system: KLING_SYSTEM,
  jimeng_video_system: JIMENG_VIDEO_SYSTEM,
  veo_system: VEO_SYSTEM,
  generic_system: GENERIC_SYSTEM,
};

/** Sync fallback when resolvePrompt context is unavailable (tests, scripts). */
export function getRefVideoPromptSystem(videoProtocol?: string): string {
  const slotKey = refVideoProtocolToSlotKey(videoProtocol);
  return CODE_FALLBACK_BY_SLOT[slotKey];
}

/**
 * Resolve vision video-prompt system text: DB slot override → code default.
 * Slot key follows the active video model protocol (Seedance / Kling / …).
 */
export async function resolveRefVideoPromptSystem(
  videoProtocol: string | undefined,
  options: ResolvePromptOptions
): Promise<string> {
  const slotKey = refVideoProtocolToSlotKey(videoProtocol);
  const slots = await resolveSlotContents("ref_video_prompt", options);
  const customized = slots[slotKey]?.trim();
  if (customized) return customized;
  return CODE_FALLBACK_BY_SLOT[slotKey];
}

/** @deprecated Use resolveRefVideoPromptSystem / getRefVideoPromptSystem instead */
export const REF_VIDEO_PROMPT_SYSTEM = SEEDANCE_SYSTEM;

/**
 * Strip character-action / combat narrative sentences from a scene description,
 * keeping only location, environment, and atmospheric context.
 *
 * When the AI sees both real frame images and a motion script, the scene
 * description is purely supplemental background context. Sentences that describe
 * what characters are doing ("对抗魔族", "走到父亲身边") overlap with the motion
 * script and—worse—can push the model to invent environmental elements like
 * fire walls when it sees combat verbs next to an ambiguous light source.
 */
export function pruneSceneDescForVideoPrompt(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // Action verbs that indicate character motion / conflict / narrative beats
  const ACTION_RE =
    /对抗|战斗|攻击|拼杀|冲向|奔向|扑向|冲去|冲上|冲入|追赶|逃跑|搏斗|格挡|抵挡|砍|刺|射击|踢|格斗|举起|挥动|挥舞|走到|走向|站到|坐到|跑向|跳向|转向|面对|应对|拿着|手持|手握|持着|举着|抱着|拉着|推着|指向|看向|望向|朝向|盯着|凝视着/;

  const parts = trimmed.split(/[。；！？\n]+/).map((s) => s.trim()).filter(Boolean);

  // Single sentence: drop it entirely if action-heavy, otherwise keep as-is
  if (parts.length <= 1) {
    return ACTION_RE.test(trimmed) ? undefined : trimmed || undefined;
  }

  const kept = parts.filter((s) => !ACTION_RE.test(s));
  if (!kept.length) return undefined;
  return kept.join("。") + "。";
}

/** Detect if a motion script contains time-coded stage markers like [0-3s] or [0s-5.5s] */
function hasTimeCodes(motionScript: string): boolean {
  return /\[\s*\d+(?:\.\d+)?s?\s*[-–]\s*\d+(?:\.\d+)?s\s*\]/.test(motionScript);
}

/** Count the number of time-coded stages in a motion script */
function countStages(motionScript: string): number {
  return (motionScript.match(/\[\s*\d+(?:\.\d+)?s?\s*[-–]\s*\d+(?:\.\d+)?s\s*\]/g) ?? []).length;
}

/** 分镜字段拆分：动作主文案 vs 场景描述（shots.prompt） */
export function resolveVideoMotionAndScene(shot: {
  prompt?: string | null;
  videoScript?: string | null;
  motionScript?: string | null;
}): { motionText: string; sceneDescription?: string } {
  const sceneRaw = shot.prompt?.trim() ?? "";
  const primary = (shot.videoScript || shot.motionScript || "").trim();
  if (primary) {
    const motionText = primary;
    const sceneDescription =
      sceneRaw && sceneRaw !== primary ? sceneRaw : undefined;
    return { motionText, sceneDescription };
  }
  return { motionText: sceneRaw, sceneDescription: undefined };
}

export function buildRefVideoPromptRequest(params: {
  motionScript: string;
  /** 分镜「场景描述」，仅作补充上下文；不得覆盖首帧/尾帧图像与动作脚本 */
  sceneDescription?: string;
  /** 当前镜头首帧静止描述。视频提示词必须从该起幅/图像开始。 */
  startFrameDesc?: string | null;
  /** 当前镜头尾帧静止描述；仅首尾帧模式下用于约束落幅。 */
  endFrameDesc?: string | null;
  cameraDirection: string;
  duration: number;
  frameCount?: number; // 1 = only first frame; 2 = both frames
  characters?: Array<{ name: string; visualHint?: string | null }>;
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  /** 项目视觉风格标签，锁定生成风格（如"日本现代2D动漫风格，8K高清，赛璐珞渲染，清晰线稿——"）。无此参数时由 LLM 使用系统提示词中的默认值。 */
  visualStyleTag?: string;
}): string {
  const frameCount = params.frameCount ?? 2;
  const frameIntro = frameCount === 1
    ? `ONE image provided: the FIRST FRAME (starting state). No last frame — infer motion from the screenplay action below.`
    : `TWO images provided: FIRST FRAME (starting state) and LAST FRAME (ending state). Describe the motion transition between them.`;

  const lines: string[] = [
    `${frameIntro} Write in the same language as the screenplay action below.`,
    `CRITICAL: The first sentence of the final prompt must start from the provided FIRST FRAME / opening composition. Do not open with later plot beats, previous-shot content, or the closing-frame close-up.`,
    ``,
  ];

  const startFrame = params.startFrameDesc?.trim();
  const endFrame = params.endFrameDesc?.trim();
  if (startFrame || endFrame) {
    lines.push(`FRAME GROUND TRUTH (highest priority):`);
    if (startFrame) {
      lines.push(`  Opening frame at 0s: ${startFrame}`);
    }
    if (frameCount > 1 && endFrame) {
      lines.push(`  Closing frame at ${params.duration}s: ${endFrame}`);
    }
    lines.push(`Use these only as temporal anchors: start from the opening frame, describe the motion transition, and end at the closing frame if provided.`);
    lines.push(``);
  }

  // Compute lip-sync state per character from dialogues
  const onScreenSpeakers = new Set(
    (params.dialogues ?? []).filter((d) => !d.offscreen).map((d) => d.characterName)
  );
  const offscreenSpeakers = new Set(
    (params.dialogues ?? []).filter((d) => d.offscreen).map((d) => d.characterName)
  );

  const withHints = (params.characters ?? []).filter((c) => c.visualHint);
  if (withHints.length) {
    lines.push(`CHARACTER VISUAL IDs (advisory baseline — if frame clearly shows different age/attire, describe the frame instead):`);
    for (const c of withHints) {
      let lipState: string;
      if (onScreenSpeakers.has(c.name)) {
        lipState = " — speaking · lip-sync active";
      } else if (offscreenSpeakers.has(c.name)) {
        lipState = " — OS/VO · silent lips";
      } else {
        lipState = " — silent · silent lips";
      }
      lines.push(`  ${c.name}：${c.visualHint}${lipState}`);
    }
    lines.push(``);
  }

  if (params.sceneDescription?.trim()) {
    lines.push(`Scene description (supplemental only; include only beats compatible with the frame anchors and screenplay action): ${params.sceneDescription.trim()}`);
    lines.push(``);
  }
  lines.push(`Screenplay action: ${params.motionScript}`);
  lines.push(`⚠️ LOCKED Camera direction — translate INTENT into natural prose, NEVER copy field notation verbatim (dissolve any brackets/slashes into sentences): ${params.cameraDirection}`);
  lines.push(`Duration: ${params.duration}s`);

  if (hasTimeCodes(params.motionScript)) {
    const n = countStages(params.motionScript);
    lines.push(`⚠️ MULTI-STAGE SHOT (${n} stages): Write one sentence per stage connected with 随后/接着/最终 (or then/next/finally). Do NOT merge stages. Do NOT include [Xs-Ys] markers in your output.`);
  }

  if (params.dialogues?.length) {
    const dialogueLines = params.dialogues.map((d) => {
      const type = d.offscreen ? "OS/VO · silent lips" : "dialogue · lip-sync active";
      return `${d.characterName}: "${d.text}" (${type})`;
    });
    lines.push(`Dialogue: ${dialogueLines.join("; ")}`);
  }

  if (params.visualStyleTag?.trim()) {
    lines.push(`⚠️ LOCKED STYLE TAG (must appear verbatim at end of prompt, before any constraint lines): ${params.visualStyleTag.trim()}`);
  }

  return lines.join("\n");
}
