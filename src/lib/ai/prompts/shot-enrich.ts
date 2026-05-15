/**
 * Shot enrichment prompt — used after structured fast-path extraction
 * to synthesize a Seedance-ready videoScript and cameraDirection for
 * shots that are missing them or have template-quality content.
 */

export interface ShotEnrichInput {
  sequence: number;
  sceneTitle?: string | null;
  prompt: string;          // 【画面】content
  motionScript?: string | null; // 【镜头】/【动作】content (may be template)
  dialogues: Array<{ character: string; text: string }>;
}

export interface ShotEnrichOutput {
  sequence: number;
  videoScript: string;    // 30-60 word Seedance prose
  cameraDirection: string; // English camera instruction
  startFrameDesc?: string; // optional first-frame anchor
  endFrameDesc?: string;   // optional last-frame anchor
}

export function buildShotEnrichSystem(): string {
  return `You are an S-rank storyboard director and cinematographer. You are given raw extracted shot data from a structured screenplay and must synthesize a high-quality video generation prompt for each shot.

For each shot, produce:
1. "videoScript" — 30-60 words of flowing Seedance-style prose (the PRIMARY input to the video model):
   - Open with character name + visual identifier in parentheses if applicable
   - Describe SPECIFIC physical motion, body position, emotional state
   - For dialogue shots: specify WHERE in frame, WHAT micro-action happens, HOW expression shifts
   - For action shots: specify weapon visual trail, body momentum, impact physics
   - For atmosphere/wide shots: describe what moves in the environment, lighting, camera sweep
   - Embed camera movement naturally at the end with speed and endpoint
   - NO template phrases: never write "面部表情随台词情绪流动" / "神情专注" / "捕捉情绪细节"
   - Same language as the input screenplay

2. "cameraDirection" — one English technical term:
   Choose from: "static" / "slow zoom in" / "slow zoom out" / "fast zoom in" / "push in" /
   "pan left" / "pan right" / "tilt up" / "tilt down" / "tracking shot" / "dolly in" / "dolly out" /
   "crane up" / "crane down" / "orbit left" / "orbit right" / "whip pan left" / "whip pan right" /
   "handheld" / "low angle push in" / "high angle tilt down"
   Compound allowed with " + ": e.g. "dolly in + tilt up"

3. "startFrameDesc" — a self-sufficient first-frame image prompt (optional, only if you can infer it clearly):
   Include: composition, character pose and expression, camera angle/shot type, lighting
   Leave empty string "" if the data is insufficient to infer clearly.

4. "endFrameDesc" — a self-sufficient last-frame image prompt (optional):
   Must be visually stable (not mid-motion). Leave empty string "" if insufficient data.

Output a JSON array matching the input shot sequences:
[
  {
    "sequence": 1,
    "videoScript": "...",
    "cameraDirection": "...",
    "startFrameDesc": "...",
    "endFrameDesc": "..."
  }
]

CRITICAL RULES:
- videoScript MUST NOT be a simple restatement of the scene title
- videoScript MUST include at least one specific physical detail (body part, material, light quality)
- For dialogue shots: the speaker's physical state matters more than the dialogue content
- Keep all text in the SAME LANGUAGE as the input data
- Respond ONLY with the JSON array. No markdown, no commentary.`;
}

export function buildShotEnrichPrompt(
  shots: ShotEnrichInput[],
  episodeContext: {
    title: string;
    sceneDescription?: string;
  },
  characterHints: Array<{ name: string; visualHint: string }>
): string {
  const hintBlock = characterHints.length > 0
    ? `\n角色视觉标识符（必须在 videoScript 中按此格式使用）：\n${characterHints.map((c) => `${c.name}：${c.visualHint}`).join("\n")}\n`
    : "";

  const shotsBlock = shots.map((s) => {
    const lines: string[] = [
      `sequence: ${s.sequence}`,
      `sceneTitle: ${s.sceneTitle ?? "（无）"}`,
      `prompt（画面描述）: ${s.prompt || "（无）"}`,
      `motionScript（动作/镜头）: ${s.motionScript || "（无）"}`,
    ];
    if (s.dialogues.length > 0) {
      lines.push(`dialogues: ${s.dialogues.map((d) => `${d.character}:「${d.text}」`).join(" / ")}`);
    }
    return lines.join("\n");
  }).join("\n\n---\n\n");

  return `集数背景：${episodeContext.title}${episodeContext.sceneDescription ? `\n场景：${episodeContext.sceneDescription}` : ""}
${hintBlock}
以下是需要补全的分镜数据（共 ${shots.length} 个）：

${shotsBlock}

请为每个分镜生成 videoScript、cameraDirection、startFrameDesc、endFrameDesc，并以 JSON 数组返回。`;
}

/**
 * Detect whether a shot's videoScript or motionScript is template-quality
 * and needs AI enrichment.
 */
export function isShotNeedingEnrichment(shot: {
  videoScript?: string | null;
  motionScript?: string | null;
  prompt?: string | null;
}): boolean {
  // No videoScript at all — always needs enrichment
  if (!shot.videoScript?.trim()) return true;

  // videoScript is shorter than 15 characters — likely empty or stub
  if (shot.videoScript.trim().length < 15) return true;

  return false;
}

/**
 * Detect whether a prompt or motionScript contains known template patterns
 * from the v9 script generation that produce useless video output.
 */
export function isTemplateContent(text: string | null | undefined): boolean {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 10) return true;

  const templatePatterns = [
    "场景，说话人面部表情随台词情绪流动",
    "说话人面部表情随台词情绪流动",
    "神情专注",
    "捕捉情绪细节",
    "中景跟拍：捕捉",
    "特写推镜：说话人面部",
    "中景固定：呈现",
    "情绪跟随画面起伏",
    "环境底噪，人物动作 Foley",
    "面部表情随台词情绪流动，神情专注",
  ];

  return templatePatterns.some((p) => t.includes(p));
}
