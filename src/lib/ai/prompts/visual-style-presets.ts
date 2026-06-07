/**
 * Client-safe visual style presets (no DB / resolver imports).
 *
 * tag: 注入视频提示词的风格锚定词（fallback，帧提示词优先用 art-styles/ 文件）
 * description: 下拉菜单展示的风格说明
 */

export const VISUAL_STYLE_PRESETS: Record<string, { label: string; tag: string; description: string }> = {
  anime_2d: {
    label: "日本2D动漫",
    description: "现代日本2D动漫 · 赛璐璐上色 · 电影级质感",
    tag: "日本现代2D动漫风格，8K高清，赛璐璐渲染，清晰线稿，电影级光影质感",
  },
  anime_2d_retro: {
    label: "复古日系动漫",
    description: "90年代日式动画 · 手绘平涂 · 怀旧治愈",
    tag: "90年代日式动画风格，手绘平涂上色，清晰流畅线条，柔和暖色调，电影感光影层次",
  },
  realistic: {
    label: "写实真人",
    description: "现代都市写实 · 影视级纪实 · 强对比度",
    tag: "真人写实都市风格，影视级摄影质感，强对比度，自然光照，极致细节",
  },
  cg_3d: {
    label: "写实3D CG",
    description: "3D动画渲染 · 赛璐珞质感 · 电影级光影",
    tag: "3D动画渲染风格，赛璐珞质感，电影级光影层次，清晰轮廓线，高细节材质",
  },
  chinese_ink: {
    label: "国风二次元",
    description: "新国潮 · 赛璐璐平涂 · 东方古韵 · 电影构图",
    tag: "国风二次元新国潮，赛璐璐平涂，日式渲染，东方古韵，新国潮美学，电影质感",
  },
  western_cartoon: {
    label: "欧美卡通",
    description: "2D扁平风 · 几何造型 · 纯色色块 · 简约现代",
    tag: "2D扁平设计风格，几何造型，纯色填充，简洁线条，无阴影无渐变，色块对比鲜明",
  },
  auto: {
    label: "AI自动检测",
    description: "根据剧本内容自动推断画风",
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
