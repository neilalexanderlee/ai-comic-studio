/**
 * Client-safe visual style presets (no DB / resolver imports).
 *
 * tag: 注入视频提示词的风格锚定词（唯一数据源，所有生成路径统一从这里取）
 * description: 下拉菜单展示的风格说明
 * negativePrompt: 图片生成模式B（英文，支持负向提示词的模型）专属负向词，
 *                  与 storyboard-image.ts 的 BASE_NEGATIVE_PROMPT 合并后使用
 *
 * 每新增一个风格，必须同时补全这三项，并在 art-styles/ 下建对应目录——
 * src/__tests__/unit/lib/ai/art-style-consistency.test.ts 会校验两边一一对应。
 */

export const VISUAL_STYLE_PRESETS: Record<
  string,
  { label: string; tag: string; description: string; negativePrompt?: string }
> = {
  anime_2d: {
    label: "日本2D动漫",
    description: "现代日本2D动漫 · 赛璐璐上色 · 电影级质感",
    tag: "日本现代2D动漫风格，赛璐璐上色，清晰线条，电影级构图，戏剧化低调光影",
    negativePrompt:
      "no plastic skin, no beauty filter, no studio lighting, no centered composition, no oversaturation, no AI generated look",
  },
  anime_2d_retro: {
    label: "复古日系动漫",
    description: "90年代日式动画 · 手绘平涂 · 怀旧治愈",
    tag: "90年代日式动画风格，手绘平涂上色，清晰流畅线条，柔和暖色调，电影感光影层次",
    negativePrompt:
      "no modern anime style, no digital 3D rendering, no CG animation, no cel-shading, no heavy shading, no gradient fills, no plastic look, no oversaturated colors, no neon colors, no cyberpunk, no sci-fi elements, no futuristic design",
  },
  realistic: {
    label: "写实真人（现代都市）",
    description: "真人实拍电影摄影 · 摄影机语法 · 自然光与城市色谱",
    tag: "真人实拍摄影，真人电影剧照，当代中国都市，电影级摄影，自然光与人造光调度，真实色彩科学",
    negativePrompt:
      "no 3D render, no CGI, no Unreal Engine, no Blender, no PBR material, no game engine, no 2D cartoon, no anime, no illustration, no hand drawn, no painting, no plastic skin, no wax face, no airbrushed, no poreless skin, no silicone face, no ancient Chinese style, no traditional costume, no cyberpunk, no sci-fi, no western fantasy, no medieval, no non-Chinese urban, no plastic mannequin, no symmetrical model pose, no branded new clothes, no showroom, no wrong anatomy, no deformed face, no broken limbs, no distorted body",
  },
  realistic_ancient: {
    label: "写实真人（古风）",
    description: "古风写实纪实 · 影视级质感 · 东方古典气韵",
    tag: "真人写实摄影，古风写实纪实，影视级摄影质感，强对比度，极致细节，东方古典气韵",
    negativePrompt:
      "no plastic skin, no beauty filter, no studio lighting, no centered composition, no oversaturation, no AI generated look, no modern clothing, no modern architecture, no cars, no phones",
  },
  cg_3d: {
    label: "写实3D CG",
    description: "3D动画渲染 · 赛璐珞质感 · 电影级光影",
    tag: "3D动画渲染风格，赛璐珞质感，电影级打光，柔和光影层次，清晰轮廓线，高细节材质",
    negativePrompt:
      "no photorealism, no realistic rendering, no CG realism, no dark tones, no heavy shading, no oversaturated colors, no neon colors, no cyberpunk, no sci-fi elements, no futuristic design, no plastic look, no cartoon flat coloring without depth",
  },
  chinese_ink: {
    label: "国风二次元",
    description: "新国潮 · 赛璐璐平涂 · 东方古韵 · 电影构图",
    tag: "国风二次元新国潮，赛璐璐平涂，日式渲染，细腻笔触，东方古韵，新国潮美学，电影质感",
    negativePrompt:
      "no photorealistic, no realistic photography, no 3D render, no low-poly, no rough modeling, no plastic texture, no harsh lines, no western fantasy, no cyberpunk, no sci-fi, no modern elements, no cartoon style without anime quality",
  },
  western_cartoon: {
    label: "欧美卡通",
    description: "2D扁平风 · 几何造型 · 纯色色块 · 简约现代",
    tag: "2D扁平风格，Flat Design，几何造型，纯色填充，简洁线条，无阴影无渐变，色块对比鲜明",
    negativePrompt:
      "no 3D rendering, no photorealism, no shadows, no gradients, no textures, no realistic lighting, no realistic materials, no complex details, no detailed backgrounds, no realistic faces, no realistic hair, no realistic clothing",
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
