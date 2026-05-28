/**
 * Client-safe visual style presets (no DB / resolver imports).
 */

export const VISUAL_STYLE_PRESETS: Record<string, { label: string; tag: string }> = {
  anime_2d: {
    label: "日本2D动漫",
    tag: "日本现代2D动漫风格，8K高清，赛璐珞渲染，清晰线稿——",
  },
  realistic: {
    label: "写实真人",
    tag: "电影级写实真人风格，85mm镜头，无滤镜特写——",
  },
  cg_3d: {
    label: "写实3D CG",
    tag: "写实3D CG风格，电影级渲染，Pixar质感——",
  },
  chinese_ink: {
    label: "中国水墨国风",
    tag: "中国传统水墨国风插画风格，工笔与写意融合——",
  },
  western_cartoon: {
    label: "欧美卡通",
    tag: "欧美2D卡通风格，扁平插画，粗线描边——",
  },
  auto: {
    label: "AI自动检测",
    tag: "",
  },
};

export function buildStyleInstruction(visualStyle: string): string {
  const preset = VISUAL_STYLE_PRESETS[visualStyle];
  if (!preset || !preset.tag) {
    return `═══ STEP 1 — DETECT VISUAL STYLE ═══
Identify the style declared or implied by the screenplay:
- "真人" / "realistic" / "live-action" / "photorealistic" → describe as if writing for a real-world photo shoot or high-end CG film. NO anime aesthetics whatsoever.
- "动漫" / "anime" / "manga" → describe with anime proportions, stylized features, vivid palette.
- "3D CG" / "Pixar" → describe for 3D rendering pipeline.
- "2D cartoon" → describe for cartoon illustration.
This style MUST appear in every description. A 真人 screenplay must NEVER produce anime-sounding output.`;
  }

  return `═══ STEP 1 — VISUAL STYLE (PROJECT SETTING — DO NOT OVERRIDE) ═══
The project owner has explicitly set the visual style. You MUST use this style for every character, regardless of what the screenplay says:

STYLE TAG (copy verbatim as the first words of every description field):
"${preset.tag}"

Do NOT infer or change the style. Do NOT use cinematic/photorealistic language if the style is anime. Do NOT use anime language if the style is realistic. The style tag above is absolute.`;
}
