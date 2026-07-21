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
/**
 * 场景描述轻剪枝：保留所有事件/声音/环境/因果节拍，只剥离
 * "纯外观定格描述"句（以人物外形定语开头、无动词的句子），
 * 这类句子与帧图矛盾风险高但叙事价值低。
 *
 * ⚠️ 不再剥离含动作动词的句子——"停下/往上看/砸落/扑向" 等
 * 正是 LLM 需要的因果时序节拍，剥除它们会导致 LLM 自己重排顺序。
 */
export function pruneSceneDescForVideoPrompt(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // 仅剥离：句首是人物外形标注（括号包裹的外形描述）、句尾无动词的纯外观定格句。
  // 例：「角色甲（矮小瘦弱黑碎发琥珀眼）」→ 这类句子若没有谓语动词则剥除。
  // 保留：一切含事件动词、环境变化、声音描述的句子。
  const APPEARANCE_ONLY_RE = /^[^\s，。]{1,6}（[^）]{1,40}）\s*$/;

  const parts = trimmed.split(/[。；！？\n]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return APPEARANCE_ONLY_RE.test(trimmed) ? undefined : trimmed || undefined;
  }

  const kept = parts.filter((s) => !APPEARANCE_ONLY_RE.test(s));
  if (!kept.length) return trimmed; // 全是外观句时保底返回原文
  return kept.join("。") + "。";
}

/**
 * Expand bracket-format motionScript into natural prose.
 *
 * Format stored in DB:
 *   `0-3s: [单角色/共同动作] 3-7s: [角色A:动作1→动作2] [角色B:动作3→动作4] | 朝向：xxx`
 *
 * Expansion rules:
 * - `[content]` (no colon prefix) → content as-is, `→` replaced with `、`
 * - `[角色名:动作1→动作2]` → `角色名动作1、动作2`
 * - Multiple `[]` in same stage → joined with `；随后`
 * - Old format without `[]` passes through unchanged (backward compatibility)
 *
 * opts.prose = true（直出模式）：去除时间码前缀，跨段用「，随后」衔接，输出纯散文。
 *   示例："角色甲回头望向角色乙、迈步走近，随后角色乙嘴唇微颤无声"
 *
 * opts.prose = false / 默认：保留时间码，供 LLM 精炼时理解分段意图。
 *   示例："0-3s: 角色甲回头望向角色乙 3-7s: 角色乙嘴唇微颤无声"
 */
export function expandMotionScriptBrackets(motionScript: string, opts?: { prose?: boolean }): string {
  const trimmed = motionScript.trim();
  if (!trimmed.includes('[')) return trimmed; // old format — pass through

  // Separate camera direction suffix  `| 朝向：xxx`
  const dirMatch = trimmed.match(/\s*[|｜]\s*朝向\s*[:：]\s*(.+)$/);
  const dirSuffix = dirMatch ? dirMatch[1].trim() : undefined;
  const body = dirSuffix ? trimmed.slice(0, dirMatch!.index!).trim() : trimmed;

  /** 展开单个时间段里的 bracket 内容为文字列表 */
  function expandBracketSection(bracketSection: string): string[] {
    return [...bracketSection.matchAll(/\[([^\]]*)\]/g)]
      .map((m) => m[1].trim())
      .filter(Boolean)
      .map((content) => {
        const colonIdx = content.search(/[:：]/);
        if (colonIdx > 0) {
          const potentialName = content.slice(0, colonIdx).trim();
          // Character names are short (≤8 chars) and contain no punctuation
          if (potentialName.length <= 8 && !/[，。、\s]/.test(potentialName)) {
            const actions = content.slice(colonIdx + 1).trim().replace(/→/g, '、');
            return `${potentialName}${actions}`;
          }
        }
        return content.replace(/→/g, '、');
      });
  }

  // Match each time stage: `Xs-Ys:` followed by one or more `[...]` blocks
  const stageRe = /(\d+(?:\.\d+)?s?\s*[-–]\s*\d+(?:\.\d+)?s\s*[:：]\s*)((?:\[[^\]]*\]\s*)*)/g;

  if (opts?.prose) {
    // 散文直出模式：去掉时间码，跨段用「，随后」衔接
    const stageTexts: string[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(stageRe.source, 'g');
    while ((match = re.exec(body)) !== null) {
      const parts = expandBracketSection(match[2]);
      if (parts.length) stageTexts.push(parts.join('；随后'));
    }
    if (!stageTexts.length) {
      // 没有匹配到时间段，原文直通
      return dirSuffix ? `${body}，朝向${dirSuffix}` : body;
    }
    const proseBody = stageTexts.join('，随后');
    return dirSuffix ? `${proseBody}，朝向${dirSuffix}` : proseBody;
  }

  // 默认模式：保留时间码（给 LLM 看的结构化输入）
  const expanded = body.replace(stageRe, (_match, timeCode: string, bracketSection: string) => {
    const parts = expandBracketSection(bracketSection);
    if (!parts.length) return timeCode;
    return `${timeCode}${parts.join('；随后')}`;
  });

  const result = expanded.replace(/\s{2,}/g, ' ').trim();
  return dirSuffix ? `${result} | 朝向：${dirSuffix}` : result;
}

/** Detect if a motion script contains time-coded stage markers.
 *  Supports both old `[0-3s]` format and new `0-3s:` format. */
function hasTimeCodes(motionScript: string): boolean {
  return /\d+(?:\.\d+)?s?\s*[-–]\s*\d+(?:\.\d+)?s\s*[:：\]]/.test(motionScript);
}

/** Count the number of time-coded stages in a motion script */
function countStages(motionScript: string): number {
  return (motionScript.match(/\d+(?:\.\d+)?s?\s*[-–]\s*\d+(?:\.\d+)?s\s*[:：\]]/g) ?? []).length;
}

/**
 * 分镜字段拆分：动作主文案 vs 场景描述（shots.prompt）
 *
 * motionScript = 详细时间线，用户可编辑，唯一生成输入来源。
 *                对应 Toonflow 里"每个 shot 只有一条动作描述"的设计原则。
 */
export function resolveVideoMotionAndScene(shot: {
  prompt?: string | null;
  motionScript?: string | null;
}): { motionText: string; sceneDescription?: string } {
  const sceneRaw = shot.prompt?.trim() ?? "";
  const primary = (shot.motionScript || "").trim();
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
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string; voiceHint?: string }>;
  /** 项目视觉风格标签，锁定生成风格（如"日本现代2D动漫风格，8K高清，赛璐珞渲染，清晰线稿——"）。无此参数时由 LLM 使用系统提示词中的默认值。 */
  visualStyleTag?: string;
}): string {
  // Expand bracket-format motionScript → ordered natural prose before LLM sees it
  const motionScript = expandMotionScriptBrackets(params.motionScript);

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
    lines.push(`叙事事件序列（因果时序骨架——事件必须严格按此顺序发生，禁止跳过或重排任何节拍）: ${params.sceneDescription.trim()}`);
    lines.push(``);
  }
  lines.push(`Screenplay action: ${motionScript}`);
  lines.push(`⚠️ LOCKED Camera direction — translate INTENT into natural prose, NEVER copy field notation verbatim (dissolve any brackets/slashes into sentences): ${params.cameraDirection}`);
  lines.push(`Duration: ${params.duration}s`);

  if (hasTimeCodes(motionScript)) {
    const n = countStages(motionScript);
    lines.push(`⚠️ MULTI-STAGE SHOT (${n} stages): Write one sentence per stage connected with 随后/接着/最终 (or then/next/finally). Do NOT merge stages. Do NOT include [Xs-Ys] markers in your output.`);
  }

  if (params.dialogues?.length) {
    lines.push(`台词（在动作叙事中台词自然发生的时机处内嵌，勿独立成行）:`);
    for (const d of params.dialogues) {
      if (d.offscreen) {
        const voicePart = d.voiceHint ? `音色：${d.voiceHint}，` : "";
        lines.push(`  ${d.characterName} 画外音VO：「${d.text}」${voicePart}（画面外，角色嘴型静止）`);
      } else {
        const voicePart = d.voiceHint ? `音色：${d.voiceHint}，` : "";
        lines.push(`  ${d.characterName} 说：「${d.text}」${voicePart}（嘴型口型同步）`);
      }
    }
  }

  if (params.visualStyleTag?.trim()) {
    lines.push(`⚠️ LOCKED STYLE TAG (must appear verbatim at end of prompt, before any constraint lines): ${params.visualStyleTag.trim()}`);
  }

  return lines.join("\n");
}
