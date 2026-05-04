export interface StructuredStoryboardDetection {
  matched: boolean;
  score: number;
  reasons: string[];
}

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

  return {
    matched: score >= 5,
    score,
    reasons,
  };
}
