import type { ExtractedShot } from "./extract-shot-script";
import type { PersistableShot } from "./persist-storyboard-version";

/**
 * 根据台词字数和情绪语速计算最低时长（秒）。
 * 移植自 Toonflow storyboard_table_techniques.md 台词时长计算规则。
 */
function calcMinDurationForDialogue(dialogues: Array<{ text: string }>, emotion?: string | null): number {
  if (!dialogues.length) return 0;

  const fullText = dialogues.map((d) => d.text).join("");
  const charCount = fullText.length;
  if (!charCount) return 0;

  // 语速：愤怒/急促 4字/秒，正常 3字/秒，悲伤/深情 2字/秒
  let charsPerSec = 3;
  if (emotion && /愤怒|急促|争吵|惊慌|激动/.test(emotion)) charsPerSec = 4;
  if (emotion && /悲伤|深情|沉思|哀悼|回忆|低语|虚弱|临终/.test(emotion)) charsPerSec = 2;

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

    // 台词时长校正：有台词时确保 duration 足够念完
    let duration = shot.duration ?? 10;
    if (shot.dialogues.length > 0) {
      const minDuration = calcMinDurationForDialogue(shot.dialogues, shot.emotion);
      if (minDuration > duration) {
        duration = minDuration;
      }
    }

    return {
      sequence: shot.sequence,
      prompt: (shot.prompt?.trim() || shot.motionScript?.trim() || "").trim(),
      startFrameDesc,
      endFrameDesc,
      motionScript: shot.motionScript ?? shot.prompt ?? null,
      videoScript: shot.videoScript ?? null,
      cameraDirection: cameraDirection ?? "static",
      duration,
      bgmNote: shot.bgmNote ?? null,
      soundEffectNote: shot.soundEffectNote ?? null,
      emotion: shot.emotion ?? null,
      lightingAtm: shot.lightingAtm ?? null,
      framing: shot.framing ?? null,
      dialogues: shot.dialogues.map((d, i) => ({
        character: d.character,
        text: d.text,
        sequence: i,
      })),
    };
  });
}
