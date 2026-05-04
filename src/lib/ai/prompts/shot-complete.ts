interface ShotCompletePromptParams {
  script: string;
  prompt: string;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
  cameraDirection?: string | null;
  duration?: number | null;
  dialogues: Array<{ character: string; text: string }>;
  characterDescriptions: string;
  characterVisualHints?: Array<{ name: string; visualHint: string }>;
}

export function buildShotCompletePrompt(
  params: ShotCompletePromptParams
): string {
  const hintBlock = params.characterVisualHints?.length
    ? `\n角色视觉标识（如果人物出现在补全字段里，优先沿用这些描述）：\n${params.characterVisualHints
        .map((c) => `${c.name}：${c.visualHint}`)
        .join("\n")}`
    : "";

  return `你是一位分镜导演。请在不改写已有镜头意图的前提下，只补全这个镜头缺失的字段，让它更适合后续 AI 画面和视频生成。

要求：
1. 不要改写已经提供的字段内容，除非该字段为空。
2. 优先保留原剧本中的措辞、人物关系和动作设计。
3. 如果剧本已经包含明确的镜头语言，就按原文延展，不要另起炉灶。
4. 所有中文输入都用中文输出；只有 cameraDirection 使用英文技术词。
5. 如果某字段已经有值，请原样返回。

全剧上下文：
${params.script}

角色参考：
${params.characterDescriptions || "无"}
${hintBlock}

当前镜头：
- 场景描述: ${params.prompt || ""}
- 首帧: ${params.startFrameDesc || ""}
- 尾帧: ${params.endFrameDesc || ""}
- 动作脚本: ${params.motionScript || ""}
- 运镜: ${params.cameraDirection || ""}
- 时长: ${params.duration ?? ""}
- 台词: ${params.dialogues.map((d) => `${d.character}: ${d.text}`).join(" | ")}

请返回一个 JSON 对象，不要加 markdown，不要解释：
{
  "startFrameDesc": "如果原值非空则原样返回，否则补全",
  "endFrameDesc": "如果原值非空则原样返回，否则补全",
  "motionScript": "如果原值非空则原样返回，否则补全",
  "videoScript": "补一条 1-2 句的视频动态描述，30-60 字左右",
  "cameraDirection": "如果原值非空则原样返回，否则补一个最合适的英文运镜词",
  "duration": ${params.duration ?? 10}
}`;
}
