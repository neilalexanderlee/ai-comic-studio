import type { ExtractedShot } from "./extract-shot-script";
import type { PersistableShot } from "./persist-storyboard-version";
import { extractDialoguesFromMotionScript } from "./extract-dialogues-from-motion-script";

/**
 * 根据台词字数和文本节奏线索计算最低时长（秒）。
 * 移植自 Toonflow storyboard_table_techniques.md 台词时长计算规则。
 * 注：情绪字段已移除，改为从台词文本中推断节奏。
 */
function calcMinDurationForDialogue(dialogues: Array<{ text: string }>): number {
  if (!dialogues.length) return 0;

  const fullText = dialogues.map((d) => d.text).join("");
  const charCount = fullText.length;
  if (!charCount) return 0;

  // 语速：根据台词内容的标点密度推断节奏
  // - 感叹号/问号密集 → 急促 4字/秒
  // - 省略号/破折号密集 → 沉缓 2字/秒
  // - 其他 → 正常 3字/秒
  const exclamationCount = (fullText.match(/[！？]/g) ?? []).length;
  const pauseMarkCount = (fullText.match(/[…—]/g) ?? []).length;
  let charsPerSec = 3;
  if (exclamationCount / charCount > 0.15) charsPerSec = 4;
  else if (pauseMarkCount / charCount > 0.1) charsPerSec = 2;

  const baseSeconds = Math.ceil(charCount / charsPerSec);

  // 停顿余量：每个标点 +0.4s，情绪转折（省略号/破折号）+0.5s
  const punctuation = (fullText.match(/[，。？！、…—；]/g) ?? []).length;
  const ellipsis = (fullText.match(/[…—]/g) ?? []).length;
  const pauseSeconds = punctuation * 0.4 + ellipsis * 0.1;

  // 安全余量 +1s
  return Math.ceil(baseSeconds + pauseSeconds + 1);
}

/** Map markdown-extracted shots to DB rows without LLM rewrite (author wording preserved). */
export function finalizeExtractedShotsForDb(shots: ExtractedShot[]): PersistableShot[] {
  return shots.map((shot) => {
    const startFrameDesc = shot.startFrameDesc ?? shot.prompt ?? null;
    const endFrameDesc = shot.endFrameDesc ?? null;

    let cameraDirection = shot.cameraDirection ?? null;
    if (!cameraDirection && shot.motionScript) {
      const cameraKeywords = /推镜|拉镜|摇镜|移镜|跟拍|航拍|俯拍|仰拍|环绕|旋转|手持|固定|zoom|pan|tilt|crane|dolly/i;
      const match = shot.motionScript.match(cameraKeywords);
      if (match) {
        const idx = shot.motionScript.indexOf(match[0]);
        cameraDirection = shot.motionScript.slice(Math.max(0, idx - 4), idx + 16).trim();
      }
    }

    // 台词处理：从 motionScript bracket 提取台词；
    // 结构化 markdown 路径（【对白】块）的台词暂不注入 motionScript——位置由 LLM 决定。
    // 将台词追加到 prompt 作为「对白参考」，供：
    //   ① banner 检测（promptHasDialogue = /「/.test(prompt)）
    //   ② 批量重写时 LLM 读取并在合适时机嵌入 motionScript bracket
    let duration = shot.duration ?? 10;
    const motionScriptText = shot.motionScript ?? shot.prompt ?? "";
    const parsedDialogues = extractDialoguesFromMotionScript(motionScriptText);
    const structuredDialogues = shot.dialogues ?? [];

    let basePrompt = (shot.prompt?.trim() || shot.motionScript?.trim() || "").trim();
    if (parsedDialogues.length === 0 && structuredDialogues.length > 0) {
      const dialogueRef = structuredDialogues
        .map((d) => `${d.character}：「${d.text}」`)
        .join("　");
      basePrompt = basePrompt
        ? `${basePrompt}\n【对白参考】${dialogueRef}`
        : `【对白参考】${dialogueRef}`;
    }

    // 时长校正：有台词时确保 duration 足够念完
    const dialoguesForDuration =
      parsedDialogues.length > 0
        ? parsedDialogues
        : structuredDialogues.map((d) => ({ text: d.text }));
    if (dialoguesForDuration.length > 0) {
      const minDuration = calcMinDurationForDialogue(dialoguesForDuration);
      if (minDuration > duration) duration = minDuration;
    }

    return {
      sequence: shot.sequence,
      prompt: basePrompt,
      startFrameDesc,
      endFrameDesc,
      motionScript: shot.motionScript ?? shot.prompt ?? null,
      cameraDirection: cameraDirection ?? "static",
      duration,
      bgmNote: shot.bgmNote ?? null,
      soundEffectNote: shot.soundEffectNote ?? null,
    };
  });
}
