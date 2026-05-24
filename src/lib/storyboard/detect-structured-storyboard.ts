export interface StructuredStoryboardDetection {
  matched: boolean;
  score: number;
  reasons: string[];
}

/**
 * Detect whether the script uses a structured markdown storyboard that
 * `extractShotsFromScript` can parse deterministically (no LLM shot_split).
 */
export function detectStructuredStoryboard(
  script: string
): StructuredStoryboardDetection {
  const reasons: string[] = [];
  let score = 0;

  const shotMarkers = script.match(/(?:镜头|shot)\s*\d+/gi) ?? [];
  if (shotMarkers.length >= 2) {
    score += 4;
    reasons.push(`found ${shotMarkers.length} shot markers`);
  }

  const labeledFields = script.match(
    /(?:画面|动作|运镜|台词|对白|时长|首帧|尾帧)\s*[：:]/g
  ) ?? [];
  if (labeledFields.length >= 3) {
    score += 3;
    reasons.push(`found ${labeledFields.length} labeled storyboard fields`);
  }

  const sceneMarkers = script.match(
    /(?:SCENE\s*\d+|场景\s*\d+|第\s*\d+\s*场)/gi
  ) ?? [];
  if (sceneMarkers.length >= 2) {
    score += 2;
    reasons.push(`found ${sceneMarkers.length} scene markers`);
  }

  const durationMarkers = script.match(
    /(?:时长)\s*[：:]\s*\d+\s*(?:秒|s)?/gi
  ) ?? [];
  if (durationMarkers.length >= 1) {
    score += 1;
    reasons.push(`found ${durationMarkers.length} duration markers`);
  }

  const dialogueMarkers = script.match(/^[^\n：:]{1,20}[：:][^\n]+$/gm) ?? [];
  if (dialogueMarkers.length >= 3) {
    score += 1;
    reasons.push(`found ${dialogueMarkers.length} dialogue-like lines`);
  }

  // ── Markdown boards: 【分镜详情】 + 【镜头】/【运镜】/【画面】 + timecode headers ──
  const hasDetailBlock = script.includes("【分镜详情】");
  // 【镜头】 = legacy format, 【运镜】 = S-grade format
  const lensBlocks = (script.match(/【镜头】/g) ?? []).length +
    (script.match(/【运镜】/g) ?? []).length;
  const frameBlocks = (script.match(/【画面】/g) ?? []).length;
  const timecodeBlocks =
    script.match(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*\|/g) ?? [];
  const tc = timecodeBlocks.length;

  // S-grade markers: 【videoScript】 + 【首帧】/【尾帧】 → strong signal for S-grade storyboard
  const videoScriptBlocks = (script.match(/【videoScript】/g) ?? []).length;
  const keyframeBlocks = (script.match(/【首帧】/g) ?? []).length +
    (script.match(/【尾帧】/g) ?? []).length;
  if (videoScriptBlocks >= 2) {
    score += 6;
    reasons.push(`S-grade: ${videoScriptBlocks} 【videoScript】 blocks`);
  }
  if (keyframeBlocks >= 4) {
    score += 4;
    reasons.push(`S-grade: ${keyframeBlocks} 【首帧】/【尾帧】 blocks`);
  }

  if (hasDetailBlock && lensBlocks + frameBlocks >= 4) {
    score += 8;
    reasons.push(
      `markdown board: 分镜详情 + ${lensBlocks}【镜头】/【运镜】 + ${frameBlocks}【画面】`
    );
  }
  if (tc >= 3) {
    score += 4;
    reasons.push(`${tc} timecode shot headers (M:SS-M:SS|)`);
  }
  if (hasDetailBlock && tc >= 1 && lensBlocks + frameBlocks >= 2) {
    score += 3;
    reasons.push("分镜详情 + timecode + bracket lens/frame");
  }

  const legacyMatch = score >= 5;
  const markdownBoardMatch =
    hasDetailBlock &&
    tc >= 1 &&
    lensBlocks + frameBlocks >= 3;
  // S-grade format: no 【分镜详情】 but has dense timecodes + S-grade fields
  const sGradeMatch = !hasDetailBlock && tc >= 6 &&
    (videoScriptBlocks >= 3 || keyframeBlocks >= 6);
  const denseBracketMatch =
    !hasDetailBlock && lensBlocks + frameBlocks >= 12 && tc >= 3;

  const matched = legacyMatch || markdownBoardMatch || sGradeMatch || denseBracketMatch;

  return {
    matched,
    score,
    reasons,
  };
}
