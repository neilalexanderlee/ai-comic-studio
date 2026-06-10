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

/**
 * 从 startFrameDesc 中提取光影关键词（如"月光""火光""侧逆光""逆光""顺光"等）。
 * 规范要求 startFrameDesc 写"主光（颜色+方向+来源）"，此函数把它抠出来复用到【光影】段，
 * 避免重复写、确保光影信息单一来源（startFrameDesc）。
 * 找不到时返回空字符串，调用方 fallback 到通用默认光影。
 */
function extractLightingHintFromDesc(desc: string): string {
  if (!desc) return "";
  // 匹配常见光影关键词片段（保持简短，不整句提取）
  const patterns = [
    /[^\s，。]{1,4}(侧逆光|逆光|顺光|侧光|背光|漫射光|环境光|轮廓光)[^\s，。]{0,6}/,
    /(月光|火光|烛光|灯光|晨光|夕光|阳光|霓虹|闪光)[^\s，。]{0,10}/,
    /(冷调|暖调|高调|低调)[^\s，。]{0,10}(光|打光|照射)?/,
  ];
  for (const p of patterns) {
    const m = desc.match(p);
    if (m) return m[0].trim();
  }
  return "";
}

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

/**
 * 三段式分镜图提示词参数。
 *
 * 设计原则（对齐 Toonflow，2026-06-08 重构）：
 * startFrameDesc 是唯一视觉事实来源，必须自包含：
 *   景别 + 所有具名角色位置/姿态 + 主光（颜色+方向） + 情绪的身体解剖表现
 *
 * 原先的 emotion / framing / lightingAtm 三个字段已从数据库完全移除（migration 0042/0043）：
 * - framing    → 景别写进 startFrameDesc 开头（四要素之①）
 * - emotion    → 情绪改用解剖学面容词写进 startFrameDesc（四要素之④）
 * - lightingAtm → 光影信息写进 startFrameDesc 主光描述（四要素之③），不再单独维护
 * 光影线索从 startFrameDesc 里自动提取作为【光影】段。
 */
export type StoryboardImageParams = {
  /** 分镜主体画面描述（fallback，startFrameDesc 为空时使用） */
  sceneDescription: string;
  /**
   * 首帧静止构图描述——单一视觉事实来源。
   * 必须包含：景别/视角 + 具名角色精确位置与静止姿态 + 主光（颜色+方向+来源）
   *           + 情绪的身体解剖表现（禁用情绪形容词）。
   * 光影信息（四要素之③）包含在此字段内，提示词组装时自动提取。
   */
  startFrameDesc?: string | null;
  /** 角色动作（仅用于提取 ｜朝向：标注，补充人物面朝方向） */
  motionScript?: string | null;
  /** 关联资产（按 associateAssetsIds 顺序排列，决定 @图N 编号） */
  assets?: AssetRef[];
  /** 项目视觉风格（对应 art-styles/ 目录） */
  visualStyle?: string;
  /** 旧版画风标签 fallback（当 art-styles 文件不存在时使用） */
  visualStyleTag?: string;
  /** 是否为空镜/群演镜（无命名角色，不加 @图N 前缀） */
  isCrowdOrEmpty?: boolean;
};

/**
 * 构建三段式分镜图提示词（Toonflow 对齐，2026-06-08 重构）
 *
 * 输出格式：
 *   @图1 为{角色名}角色 @图2 为{场景名}场景,
 *
 *   【画面】{startFrameDesc}，朝向：{from motionScript}。
 *
 *   【光影】{从 startFrameDesc 提取光影关键词，否则通用默认}。
 *
 *   【风格】{风格约束词}，禁止画外字幕、水印、UI 文字。
 *
 *   保持 @图N 面部特征、发型、服饰与参考图完全一致。
 *
 * startFrameDesc 是单一视觉事实来源，必须自包含所有视觉信息。
 * startFrameDesc 是单一视觉事实来源，包含所有视觉信息（景别/姿态/主光/情绪解剖）。
 */
export function buildStoryboardImagePrompt(params: StoryboardImageParams): string {
  const {
    sceneDescription,
    startFrameDesc,
    motionScript,
    assets = [],
    visualStyle = "",
    visualStyleTag = "",
    isCrowdOrEmpty = false,
  } = params;

  const parts: string[] = [];

  // ── 1. @图N 资产前缀标注 ──────────────────────────────────────────────────
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

    // 有场景参考图时，明确告知模型场景图是环境风格参考，需重新渲染而非直接复用背景
    const hasSceneAsset = assets.some((a) => a.type === "scene");
    if (hasSceneAsset) {
      const sceneRefs = assets
        .filter((a) => a.type === "scene")
        .map((a) => `@图${assets.indexOf(a) + 1}`)
        .join("、");
      parts.push(
        `【场景参考说明】${sceneRefs} 仅定义该场景的环境风格、氛围与光照基调，` +
        `须重新渲染整体画面，使角色与场景在透视、光照方向、色温上自然融合。` +
        `严禁将场景参考图直接作为背景底板使用，严禁将角色贴合/叠加到参考图上。`
      );
      parts.push("");
    }
  }

  // ── 2. 主画面文字（startFrameDesc 优先，fallback 到 sceneDescription）────
  const mainDesc = startFrameDesc || sceneDescription;
  const handling = detectFrameHandling(mainDesc);

  let paintDesc = mainDesc;
  if (handling === "freeze_start") {
    paintDesc = `（取动作起始瞬间静止状态）${mainDesc}`;
  } else if (handling === "camera_start") {
    paintDesc = `（取镜头起始端构图）${mainDesc}`;
  }

  // ── 3. 朝向补充（从 motionScript ｜朝向：标注提取，补充人物面朝信息）────
  // 朝向是结构性标注（不在 startFrameDesc 里），单独提取追加到【画面】末尾
  let orientationNote = "";
  if (motionScript) {
    const match = motionScript.match(/｜朝向：([^，。\n]+)/);
    if (match) orientationNote = match[1].trim();
  }

  // ── 4. @图N 替换（资产名 → @图N 编号）────────────────────────────────────
  let paintBody = paintDesc;
  if (hasNamedAssets) {
    assets.forEach((a, i) => {
      paintBody = paintBody.replaceAll(a.name, `@图${i + 1}`);
    });
  }

  // ── 5. 组装【画面】段 ─────────────────────────────────────────────────────
  // startFrameDesc 必须自包含景别/位置/光影/情绪身体表现，直接写入，不额外注入
  const paintLine = orientationNote
    ? `【画面】${paintBody}，朝向：${orientationNote}。`
    : `【画面】${paintBody}。`;
  parts.push(paintLine);
  parts.push("");

  // ── 6. 组装【光影】段（从 startFrameDesc 提取光影关键词，否则通用默认）──
  // 光影信息完全来自 startFrameDesc，不依赖任何外部字段
  const lightingHint = extractLightingHintFromDesc(mainDesc);
  parts.push(lightingHint
    ? `【光影】${lightingHint}。`
    : "【光影】自然光照，光影层次清晰，电影感光效。"
  );
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

