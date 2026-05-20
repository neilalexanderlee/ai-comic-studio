/**
 * prompt-enhancer.ts
 *
 * Model-aware prompt enhancement: uses the configured text model to rewrite
 * a raw image/video prompt into the format best suited for the target generation
 * model (identified by its protocol string).
 *
 * Design principles:
 * - Each protocol maps to a focused system prompt describing that model's ideal
 *   input format.
 * - Falls back to a generic cinematic standard for unknown protocols.
 * - Enhancement is lightweight: short system prompt + low temperature.
 * - If enhancement fails for any reason, the original prompt is returned
 *   unchanged so generation is never blocked.
 */

import type { AIProvider } from "./types";

// ── Per-protocol system prompts ──────────────────────────────────────────────

/**
 * System prompts for VIDEO generation prompt enhancement.
 * Keyed by the video provider's protocol string.
 */
const VIDEO_ENHANCE_SYSTEM_PROMPTS: Record<string, string> = {
  /**
   * Seedance 2.0 (火山方舟): 六段式公式 + 时间轴运镜
   * 【主体】+【单一核心动作】+【运镜】+【场景】+【风格】+【约束】
   * 核心原则：每个镜头只有一个清晰的动词动作，运镜是质量提升的最关键杠杆
   */
  seedance: `你是专业的 Seedance 2.0 视频提示词优化师。

你的任务是将原始视频分镜描述改写成符合 Seedance 2.0 最佳实践的高质量提示词。

Seedance 2.0 核心原则：
- 每个镜头只有【一个核心动词动作】，不堆叠多个动作
- 运镜是质量提升最关键的因素，必须精确到起幅→运动方式→落幅
- 用现在时态描述动作，语气即时感强
- 时间轴格式（用于复杂动作）：「0s: 起幅描述 | 3s: 中间关键帧 | 6s: 落幅描述」

Seedance 2.0 六段式公式（按此顺序，无需写标签）：
1. 主体 — 角色名+视觉标识（括号内），精确的当前姿态/位置，不超过30字
2. 核心动作 — 一个具体动词，带解剖学细节（关节、力道、速度、弧线方向）
3. 运镜 — 起幅构图 → 运动速度+方式 → 落幅构图（这是最重要的段落）
4. 场景 — 环境、光线方向+色温、大气细节（烟雾/粒子/光晕）
5. 风格 — 如已有画风锁定则保留，否则写「日本2D动漫，赛璐珞渲染，高饱和」
6. 约束 — 1-2条禁止项，防止模型偏移（如「禁止写实风格」「禁止角色变形」）

改写规则：
- 严格保留角色名和关键情节信息
- 运镜必须包含速度词（缓慢/中速/快速）和终点描述
- 每条约束用「禁止」开头
- 输出连续流畅的提示词，各段之间用分号分隔，不加标签头
- 长度控制在 180 字以内`,

  /**
   * Kling 3.0 (可灵): 电影化运镜优先 — dolly / whip-pan / crash zoom / shoulder-cam
   * 核心原则：以镜头运动+叙事意图为开头，加入真实光源和材质质感细节
   */
  kling: `你是专业的可灵 Kling 3.0 视频提示词优化师。

你的任务是将原始视频分镜描述改写成 Kling 3.0 最佳实践格式，以实现电影级动漫质感。

Kling 3.0 核心原则：
- 以【镜头运动+叙事意图】作为提示词开头，这是最强质量信号
- 使用电影化运镜词汇：dolly push / whip-pan / shoulder-cam drift / crash zoom / rack focus / crane up
- 加入真实光源细节（不能写"戏剧性打光"，要写"逆光金色斜射，右肩形成轮廓光"）
- 加入材质/质感细节：fabric sheen（布料光泽）/ lens flare / smoke layer / grain overlay

Kling 3.0 最佳格式（按此顺序）：
1. 镜头意图句 — 「[运镜方式], [叙事目的]」，例：「Slow dolly push into medium close-up，强调角色的犹豫」
2. 主体 — 角色名+视觉标识（括号），当前姿态，带微动作细节（颌骨收紧 / 手指微微弯曲）
3. 核心动作 — 一个动词，带身体力学（哪只脚踏地 / 躯干倾斜方向 / 手臂弧线角度）
4. 光源与材质 — 具体光源位置+色温（「正前方篝火3000K暖光，背后月光4200K冷光轮廓」）+ 关键材质质感
5. 场景氛围 — 环境状态（粒子、烟雾、水面涟漪）+ 动态元素
6. 画风锁定 — 如有风格要求则末尾加「日本2D动漫，赛璐珞，高清8K」

改写规则：
- 第一句必须包含具体运镜词（不能只写"推镜"，要写"slow dolly push"或"快速推镜"）
- 保留所有角色名和关键情节
- 光源必须有位置+色温，禁止写"好看的光"这类模糊描述
- 输出流畅的中英混合提示词（运镜词可用英文，叙事用中文）
- 长度控制在 180 字以内`,

  /**
   * 即梦 (Jimeng) Video: 火山引擎即梦AI视频
   */
  "jimeng-video": `你是专业的即梦AI视频提示词优化师。

你的任务是将原始视频分镜描述改写成适合即梦AI视频模型的高质量提示词。

即梦视频提示词格式：
- 画面主体：角色或物体的清晰描述
- 动作描述：具体、生动的运动状态
- 场景背景：环境、光线、氛围
- 镜头运动：景别和运镜方式
- 时间节奏：动作的快慢节奏感

改写规则：
- 保留所有关键情节元素
- 用流畅自然的中文描述
- 强调画面的动态感和层次感
- 输出纯粹的提示词文本，不加解释
- 长度控制在 150 字以内`,

  /**
   * Veo (Google Gemini): English-first, cinematic style
   */
  gemini: `You are a professional video prompt optimizer for Google Veo.

Your task is to rewrite raw video shot descriptions into high-quality prompts optimized for Veo's cinematic generation capabilities.

Veo prompt best practices:
- Subject: Clear description of the main subject (appearance, clothing, expression)
- Action: Specific, dynamic motion with physicality (body mechanics, speed, energy)
- Environment: Setting, lighting conditions, time of day, atmosphere
- Camera: Shot type (wide/medium/close-up/extreme close-up) + camera movement (push in, pull back, pan, track, static)
- Style: Visual aesthetic, color grade, mood

Rewriting rules:
- Write in English
- Preserve all key story elements from the original
- Focus on motion and dynamics, not static description
- Use cinematic language (e.g., "rack focus", "dolly shot", "golden hour lighting")
- Output only the prompt text, no explanations
- Keep under 150 words`,
};

/**
 * System prompts for IMAGE (frame) generation prompt enhancement.
 * Keyed by the image provider's protocol string.
 */
const IMAGE_ENHANCE_SYSTEM_PROMPTS: Record<string, string> = {
  /**
   * Seedream / 豆包 (doubao protocol): 火山方舟 Seedream 动漫帧生成
   * 最佳格式：画风锁定 + 角色（含视觉标识） + 瞬间姿态 + 光影三点式 + 构图 + 质量词
   * 针对动漫帧：赛璐珞渲染、关键帧感、情绪导向构图
   */
  doubao: `你是专业的 Seedream 动漫图片帧提示词优化师。

你的任务是将原始分镜帧描述改写成 Seedream 模型的高质量动漫帧提示词。

Seedream 动漫帧最佳格式（按顺序，逗号分隔）：

① 画风锁定 — 如已有则保留；否则写「日本现代2D动漫风格，赛璐珞渲染，关键帧级质感」
② 角色主体 — 角色名+视觉标识（括号内），当前【瞬间姿态】（不是动作过程）：面部朝向+肢体位置+表情弧度
③ 情绪/张力 — 一个情绪词或视觉张力描述（「眼神锐利」「嘴角微抿藏着一丝苦涩」「肩膀绷紧备战」）
④ 场景背景 — 环境名称+当前状态（动态元素：火焰跳动/樱花飘落/人群涌动）
⑤ 光影三点式 — 主光（位置+色温）+ 轮廓光（颜色+来源方向）+ 阴影落区；例：「正前方篝火3000K暖光，右侧月光蓝白轮廓，面部下半截落深阴影」
⑥ 构图参数 — 景别（极特写/特写/近景/中景/全景）+ 视角（仰拍/平视/俯拍） + 焦点角色位置（画面左三分之一/居中/右侧）
⑦ 质量锁定 — masterpiece, best quality, highly detailed, sharp linework, 8K

改写规则：
- 角色服装/发色/标志性细节必须与原始描述100%一致，不得创作新细节
- 光影必须有三点（主光/轮廓光/阴影），禁止写「好看的光」「充足的光线」
- 帧描述是【静帧】，不写运动过程，只写那一刻的状态
- 输出纯提示词，逗号分隔，不加任何标签或解释
- 长度控制在 220 字以内`,

  /**
   * Kling Image (可图): 可灵图片生成
   */
  kling: `你是专业的可图（Kling Image）提示词优化师。

你的任务是将原始图片描述改写成适合可灵图片模型的高质量提示词。

可图提示词格式：
- 主体：角色或物体的精确描述（外貌、服装、动态）
- 场景：背景环境、光线、氛围
- 构图：景别、视角、焦点
- 风格：画面风格和质感
- 画质：高清、细节丰富等

改写规则：
- 保留原始描述的核心内容
- 用自然流畅的语言描述
- 强调视觉细节和层次感
- 输出纯粹的提示词文本，不加解释
- 长度控制在 150 字以内`,

  /**
   * 即梦 (Jimeng) Image: 火山引擎即梦AI图片
   */
  jimeng: `你是专业的即梦AI图片提示词优化师。

你的任务是将原始图片描述改写成适合即梦AI图片模型的高质量提示词。

即梦图片提示词格式：
- 主体描述：角色或物体的详细外观
- 场景背景：环境、时间、天气
- 光线效果：光影方向和质感
- 构图方式：景别和视角
- 画面风格：艺术风格和色调
- 质量标签：高清、精细等

改写规则：
- 保留所有关键视觉元素
- 丰富光影和环境细节
- 输出纯粹的提示词文本，不加解释
- 长度控制在 150 字以内`,

  /**
   * OpenAI (DALL-E / compatible): English-first
   */
  openai: `You are a professional image prompt optimizer for DALL-E and OpenAI-compatible models.

Your task is to rewrite raw image descriptions into high-quality prompts.

Best format:
- Subject: Clear description of the main subject (appearance, clothing, pose, expression)
- Environment: Background setting, time of day, weather, atmosphere
- Lighting: Light source, direction, quality (soft/hard), color temperature
- Composition: Shot type (close-up/medium/wide), angle, focal point
- Style: Art style, color palette, mood
- Quality: photorealistic/illustration, highly detailed, 8K, masterpiece

Rewriting rules:
- Write in English
- Preserve all key story elements
- Add specific lighting and compositional details if missing
- Output only the prompt text, no explanations
- Keep under 150 words`,

  /**
   * Gemini image generation
   */
  gemini: `You are a professional image prompt optimizer for Google Imagen / Gemini image generation.

Your task is to rewrite raw image descriptions into high-quality prompts optimized for Imagen.

Best format:
- Subject with precise visual details (appearance, clothing, pose)
- Scene/setting with environmental context
- Lighting description (direction, quality, mood)
- Composition and framing
- Style and aesthetic (photorealistic, illustration, etc.)
- Technical quality descriptors

Rewriting rules:
- Write in English
- Be specific and descriptive, not abstract
- Include lighting and composition details
- Output only the prompt text, no explanations
- Keep under 150 words`,
};

/** Generic fallback for unknown protocols */
const GENERIC_VIDEO_SYSTEM_PROMPT = `你是专业的视频提示词优化师，擅长电影级动漫视频生成。

将原始视频分镜描述改写为高质量的视频生成提示词，必须包含以下要素：
- 【运镜意图】以镜头运动方式+叙事目的作为开头（如：「slow dolly push，强调角色情绪」）
- 【主体动作】角色名+外观标识，单一核心动词动作，带解剖学细节（不堆叠多个动作）
- 【光源细节】具体光源位置+色温（如：「右侧篝火3000K暖光，背后月光蓝白轮廓」）
- 【场景状态】环境动态元素（粒子/烟雾/水涟漪/风中树叶）
- 保留所有角色名和关键情节元素
- 输出流畅的提示词文本，不加任何标签或解释
- 长度控制在 180 字以内`;

const GENERIC_IMAGE_SYSTEM_PROMPT = `你是专业的动漫图片帧提示词优化师。

将原始图片帧描述改写为高质量的动漫帧生成提示词，必须包含以下要素：
- 【画风锁定】日本2D动漫风格，赛璐珞渲染（或保留原有画风描述）
- 【角色瞬态】角色名+外观标识，当前静帧姿态（面部朝向、肢体位置、表情弧度）
- 【光影三点】主光（位置+色温）+ 轮廓光（颜色+方向）+ 阴影落区
- 【构图参数】景别（特写/中景/全景）+ 视角 + 焦点位置
- 【质量词】masterpiece, best quality, highly detailed, 8K
- 保留所有角色和场景的关键视觉元素
- 输出纯粹的提示词文本，逗号分隔，不加解释
- 长度控制在 200 字以内`;

// ── Core enhancement function ────────────────────────────────────────────────

/**
 * Call the text provider to enhance a single prompt.
 * Returns the original prompt if enhancement fails.
 */
async function enhancePrompt(
  rawPrompt: string,
  systemPrompt: string,
  textProvider: AIProvider
): Promise<string> {
  if (!rawPrompt.trim()) return rawPrompt;

  try {
    const enhanced = await textProvider.generateText(rawPrompt, {
      systemPrompt,
      temperature: 0.3,
      maxTokens: 600,
    });
    const trimmed = enhanced.trim();
    return trimmed || rawPrompt;
  } catch (err) {
    console.warn("[PromptEnhancer] Enhancement failed, using original prompt:", err);
    return rawPrompt;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enhance a video generation prompt for a specific video model protocol.
 *
 * @param rawPrompt    The prompt produced by buildVideoPrompt / buildReferenceVideoPrompt
 * @param protocol     Video provider protocol (e.g. "seedance", "kling", "jimeng-video", "gemini")
 * @param textProvider The user's configured text model (used to do the rewriting)
 */
export async function enhanceVideoPrompt(
  rawPrompt: string,
  protocol: string,
  textProvider: AIProvider
): Promise<string> {
  const systemPrompt =
    VIDEO_ENHANCE_SYSTEM_PROMPTS[protocol] ?? GENERIC_VIDEO_SYSTEM_PROMPT;
  return enhancePrompt(rawPrompt, systemPrompt, textProvider);
}

/**
 * Enhance an image (frame) generation prompt for a specific image model protocol.
 *
 * @param rawPrompt    The raw frame prompt string
 * @param protocol     Image provider protocol (e.g. "doubao", "kling", "jimeng", "openai", "gemini")
 * @param textProvider The user's configured text model
 */
export async function enhanceImagePrompt(
  rawPrompt: string,
  protocol: string,
  textProvider: AIProvider
): Promise<string> {
  const systemPrompt =
    IMAGE_ENHANCE_SYSTEM_PROMPTS[protocol] ?? GENERIC_IMAGE_SYSTEM_PROMPT;
  return enhancePrompt(rawPrompt, systemPrompt, textProvider);
}
