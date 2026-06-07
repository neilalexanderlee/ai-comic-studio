import { getArtStylePrompt } from "./art-styles/index";

// ── 景别词库（通用，移植自 Toonflow storyboard_prompt_techniques.md）──
const FRAMING_MAP: Record<string, string> = {
  大远景: "大远景构图，环境全貌，人物渺小于场景",
  大全景: "大远景构图，环境全貌，人物渺小于场景",
  远景: "全身入镜，远景构图，人景比例协调",
  全景: "全身入镜，远景构图，人景比例协调",
  中景: "中景构图，人物膝盖以上入镜",
  近景: "近景构图，上半身入镜，背景虚化",
  半身: "半身构图，腰部以上入镜，浅景深",
  特写: "特写构图，面部或细节局部放大，背景深度虚化",
  大特写: "大特写，极度局部细节，虚化背景",
  过肩: "过肩构图，前景人物后背虚化，远景人物清晰",
};

// ── 首帧识别规则（从分镜描述类型推断首帧处理方式）──
type FrameHandling = "direct" | "freeze_start" | "camera_start";

function detectFrameHandling(desc: string): FrameHandling {
  if (!desc) return "direct";
  // 连续动作过程
  if (/走过|挥剑|转身|奔跑|跳起|扑向|冲向|推开|拉开/.test(desc)) return "freeze_start";
  // 镜头运动
  if (/→|缓推至|推至|拉至|淡入|淡出|溶入/.test(desc)) return "camera_start";
  return "direct";
}

export type AssetRef = {
  id: string;
  name: string;
  type: "role" | "scene" | "prop";
};

export type StoryboardImageParams = {
  /** 分镜主体画面描述（prompt 字段） */
  sceneDescription: string;
  /** 首帧静止构图描述（startFrameDesc） */
  startFrameDesc?: string | null;
  /** 情绪字段 */
  emotion?: string | null;
  /** 光影氛围字段 */
  lightingAtm?: string | null;
  /** 景别字段（决定构图词） */
  framing?: string | null;
  /** 角色动作（含 ｜朝向：标注） */
  motionScript?: string | null;
  /** 关联资产（按 associateAssetsIds 顺序排列，决定 @图N 编号） */
  assets?: AssetRef[];
  /** 项目视觉风格（对应 art-styles/ 目录） */
  visualStyle?: string;
  /**
   * 旧版画风标签（fallback，当 art-styles 文件不存在时使用）
   * 来自 VISUAL_STYLE_PRESETS[style].tag
   */
  visualStyleTag?: string;
  /** 是否为空镜/群演镜（无命名角色，不加 @图N 前缀） */
  isCrowdOrEmpty?: boolean;
};

/**
 * 构建三段式分镜图提示词（Toonflow storyboard_prompt_techniques.md 规范）
 *
 * 输出格式：
 * @图1 为{角色名}角色 @图2 为{场景名}场景,
 *
 * 【画面】{景别词}，{画面描述}，{角色位置/朝向}，{情绪面容词}。
 *
 * 【光影】{光影氛围描述}。
 *
 * 【风格】{风格锚定词}，{画质锁定词}，禁止画外字幕、水印、UI 文字。
 *
 * 保持 @图N 面部特征、发型、服饰与参考图完全一致。
 */
export function buildStoryboardImagePrompt(params: StoryboardImageParams): string {
  const {
    sceneDescription,
    startFrameDesc,
    emotion,
    lightingAtm,
    framing,
    motionScript,
    assets = [],
    visualStyle = "",
    visualStyleTag = "",
    isCrowdOrEmpty = false,
  } = params;

  const parts: string[] = [];

  // ── 1. @图N 资产前缀标注 ──────────────────────────────
  const roleAssets = assets.filter((a) => a.type === "role");
  const hasNamedAssets = !isCrowdOrEmpty && assets.length > 0;

  if (hasNamedAssets) {
    const typeLabel: Record<AssetRef["type"], string> = {
      role: "角色",
      scene: "场景",
      prop: "道具",
    };
    const prefix = assets
      .map((a, i) => `@图${i + 1} 为${a.name}${typeLabel[a.type]}`)
      .join(" ");
    parts.push(prefix + ",");
    parts.push("");
  }

  // ── 2. 景别映射 ──────────────────────────────────────
  let framingWord = "";
  if (framing) {
    // 处理复合景别（"远景→中景" → 取起始端）
    const baseFraming = framing.split(/→|->|至/)[0].trim();
    framingWord = FRAMING_MAP[baseFraming] ?? framing;
  }

  // ── 3. 首帧识别——确定画面描述如何写入【画面】段 ──────
  const mainDesc = startFrameDesc || sceneDescription;
  const handling = detectFrameHandling(mainDesc);

  let paintDesc = mainDesc;
  if (handling === "freeze_start") {
    // 连续动作：提示 LLM 取起始凝固态
    paintDesc = `（取动作起始瞬间静止状态）${mainDesc}`;
  } else if (handling === "camera_start") {
    // 镜头运动：取起始端景别
    paintDesc = `（取镜头起始端构图）${mainDesc}`;
  }

  // ── 4. 朝向信息提取（从 motionScript 中的 ｜朝向：标注） ──
  let orientationNote = "";
  if (motionScript) {
    const match = motionScript.match(/｜朝向：([^，。\n]+)/);
    if (match) {
      orientationNote = match[1].trim();
    }
  }

  // ── 5. 情绪面容词（从 storyboard.md 情绪→面容映射表查找精确词汇）──
  let emotionDesc = "";
  if (emotion) {
    const { faceWord, eyeWord } = lookupEmotionFaceWords(visualStyle, emotion);
    if (faceWord || eyeWord) {
      // 使用映射表里的精确面容/眼神词，替代原始情绪标签
      emotionDesc = `，${[faceWord, eyeWord].filter(Boolean).join("，")}`;
    } else {
      // 映射表未命中，直接用 emotion 字段
      emotionDesc = `，情绪：${emotion}`;
    }
  }

  // ── 5b. lightingAtm 兜底（emotion 有值但 lightingAtm 为空时，从光影词库匹配）──
  let resolvedLightingAtm = lightingAtm;
  if (!resolvedLightingAtm && emotion && visualStyle) {
    resolvedLightingAtm = lookupEmotionLighting(visualStyle, emotion);
  }

  // ── 6. 构建 @图N 替代正文中的角色/场景名（资产模式）──
  let paintBody = paintDesc;
  if (hasNamedAssets) {
    assets.forEach((a, i) => {
      // 在画面描述中用 @图N 替代资产名称（精确匹配名字）
      paintBody = paintBody.replaceAll(a.name, `@图${i + 1}`);
    });
  }

  // ── 7. 组装【画面】段 ──────────────────────────────────
  const paintSection: string[] = ["【画面】"];
  const paintContent: string[] = [];
  if (framingWord) paintContent.push(framingWord);
  paintContent.push(paintBody);
  if (orientationNote) paintContent.push(`朝向：${orientationNote}`);
  paintSection.push(paintContent.join("，") + emotionDesc + "。");
  parts.push(paintSection.join(""));
  parts.push("");

  // ── 8. 组装【光影】段（优先 lightingAtm，其次情绪兜底，最后通用默认）──
  if (resolvedLightingAtm) {
    parts.push(`【光影】${resolvedLightingAtm}。`);
  } else {
    parts.push("【光影】自然光照，光影层次清晰，电影感光效。");
  }
  parts.push("");

  // ── 9. 组装【风格】段（从 art-styles 文件获取风格词）──
  const styleContent = buildStyleSection(visualStyle, visualStyleTag);
  parts.push(`【风格】${styleContent}，禁止画外字幕、水印、UI 文字。`);

  // ── 9b. 负向词（从 storyboard.md 的模式B负向词模板提取）──
  // 注意：Seedream（模式A）不支持负向提示词，此段放在末尾仅在支持 negativePrompt 的模型中生效
  const negativePrompt = extractNegativePrompt(visualStyle);
  if (negativePrompt) {
    parts.push("");
    parts.push(`negative: ${negativePrompt}`);
  }

  // ── 10. 一致性声明（有命名角色时）──────────────────────
  if (hasNamedAssets && roleAssets.length > 0) {
    parts.push("");
    const refs = roleAssets.map((a, i) => `@图${assets.indexOf(a) + 1}`).join("、");
    parts.push(`保持 ${refs} 面部特征、发型、服饰与参考图完全一致。`);
  }

  return parts.join("\n");
}

/**
 * 从 art-styles 文件中提取【风格】段所需的风格锚定词和画质锁定词。
 * 优先读取 storyboard.md 中「固定风格锚定词」和「画质锁定词」段落。
 * 找不到时 fallback 到 visualStyleTag。
 */
function buildStyleSection(visualStyle: string, fallbackTag: string): string {
  if (!visualStyle || visualStyle === "auto") {
    return fallbackTag || "高清画质，线条清晰，上色均匀，色彩柔和，画面无杂色无噪点";
  }

  // 从 storyboard.md 提取画质锁定词（模式A中文版）
  const storyboardContent = getArtStylePrompt(visualStyle, "storyboard");
  if (storyboardContent) {
    // 提取固定风格锚定词
    const anchorMatch = storyboardContent.match(
      /固定风格锚定词[^（]*?[\r\n]+([\s\S]*?)(?=\n##|\n---|\n\*\*线条|\n\*\*上色|\n\*\*光影|\n\*\*氛围|\z)/
    );

    // 提取「模式A（中文）——默认:」后的画质锁定词
    const qualityMatch = storyboardContent.match(
      /模式A（中文）——默认：[\r\n]+(高清[^\r\n]+)/
    );

    const anchorWords = anchorMatch
      ? anchorMatch[1]
          .split("\n")
          .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("|"))
          .map((l) => l.replace(/^\*\*[^*]+\*\*[（(][^)）]+[)）]：/, "").trim())
          .filter(Boolean)
          .slice(0, 3)
          .join("，")
      : "";

    const qualityWords = qualityMatch ? qualityMatch[1].trim() : "";

    if (anchorWords || qualityWords) {
      return [anchorWords, qualityWords].filter(Boolean).join("，");
    }
  }

  // fallback: prefix.md 里的必守规则
  const prefixContent = getArtStylePrompt(visualStyle, "prefix");
  if (prefixContent) {
    const ruleMatch = prefixContent.match(/R1[^|]*\|([^|]+)\|/);
    if (ruleMatch) return ruleMatch[1].trim();
  }

  return fallbackTag || "高清画质，线条清晰，色彩柔和，画面无杂色无噪点";
}

/**
 * 从 art-styles/{style}/storyboard.md 的情绪光影映射表查找对应光影描述。
 * Toonflow 每个风格的 director_storyboard.md 都有「情绪基调 → 光线类型」映射。
 * 找不到时返回空字符串（调用方使用默认光影）。
 */
export function lookupEmotionLighting(visualStyle: string, emotion: string): string {
  if (!emotion || !visualStyle || visualStyle === "auto") return "";

  const content = getArtStylePrompt(visualStyle, "storyboard");
  if (!content) return "";

  // 在「情绪光影」或「光影氛围词库」段落里查找匹配行
  // 格式：| 情绪基调 | 光线类型 | 补充约束 |
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 2 && cols[0].includes(emotion.slice(0, 2))) {
      // 取光线类型列（第2列）
      return cols[1] || "";
    }
  }
  return "";
}

// 通用负向词（所有风格共用）
const BASE_NEGATIVE_PROMPT =
  "no subtitles, no captions, no watermark, no title overlay, no UI text, " +
  "no motion blur, no noise, no blurry, no out of focus, no AI generated look";

/**
 * 从 art-styles/{style}/storyboard.md 提取模式B负向词模板。
 * 合并通用负向词 + 风格专属负向词，返回完整的 negative prompt 字符串。
 * 未找到风格专属时只返回通用词。
 */
export function extractNegativePrompt(visualStyle?: string): string {
  if (!visualStyle || visualStyle === "auto") return BASE_NEGATIVE_PROMPT;

  const content = getArtStylePrompt(visualStyle, "storyboard");
  if (!content) return BASE_NEGATIVE_PROMPT;

  // 提取「模式B（英文）：」行之后的 no... 负向词行
  const match = content.match(/模式B[^：]*：[\r\n]+(no [^\r\n]+)/);
  if (match) {
    const styleNeg = match[1].trim();
    // 合并：风格专属词 + 通用词（去重）
    const styleTerms = styleNeg.split(",").map((t) => t.trim());
    const baseTerms = BASE_NEGATIVE_PROMPT.split(",").map((t) => t.trim());
    const merged = [...new Set([...styleTerms, ...baseTerms])].join(", ");
    return merged;
  }

  return BASE_NEGATIVE_PROMPT;
}

/**
 * 从 art-styles storyboard.md 的情绪→面容映射表中查找对应的面容/眼神词。
 * 找不到映射时返回空字符串（直接使用原始情绪词）。
 */
export function lookupEmotionFaceWords(
  visualStyle: string,
  emotion: string
): { faceWord: string; eyeWord: string } {
  if (!emotion || !visualStyle || visualStyle === "auto") {
    return { faceWord: "", eyeWord: "" };
  }

  const content = getArtStylePrompt(visualStyle, "storyboard");
  if (!content) return { faceWord: "", eyeWord: "" };

  // 在情绪→面容/眼神映射表中查找匹配行
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(emotion)) {
      // 格式：| 情绪 / 同义词 | 面容词 | 眼神词 | ...
      const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 3) {
        return { faceWord: cols[1] ?? "", eyeWord: cols[2] ?? "" };
      }
    }
  }
  return { faceWord: "", eyeWord: "" };
}
