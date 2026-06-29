/**
 * Seedance 2.0 多参模式视频提示词生成器
 *
 * 移植自 Toonflow seedance2Multi-parameterMode.md 规范：
 * - @参考N 编号系统（资产图 → 音频 → 分镜图，按输入顺序连续）
 * - 参考定义段（集中声明所有 @参考N）
 * - 台词三种类型（对白/内心OS/画外音VO）
 * - 9维度音色描述
 * - 分镜正文用角色名，禁止写 @参考N
 */

import { getArtStylePrompt } from "./art-styles/index";

// ── 类型定义 ─────────────────────────────────────────────

export type SeedanceAsset = {
  id: string;
  name: string;
  type: "role" | "scene" | "prop";
  /** 角色音色描述（9维度文字）— 有值时使用情况1 */
  voiceHint?: string | null;
  /** 是否有参考音频文件 — true 时使用情况2，自动插入一个音频 @参考 编号 */
  hasAudio?: boolean;
  /**
   * 角度变体图（3q / profile / back），与主图同一服装状态，文件已确认存在。
   * 顺序固定：3q → profile → back（由 character-router 保证）。
   * buildRefEntries Round 1 会在主图之后为每个变体分配连续 @参考N。
   */
  angleImages?: { angle: string; path: string }[];
};

export type SeedanceDialogue = {
  characterName: string;
  text: string;
  type: "dialogue" | "os" | "vo";
};

export type SeedanceShot = {
  /** 分镜图文件是否已生成（shouldGenerateImage） */
  hasStoryboardImage: boolean;
  /** 时长（秒） */
  duration: number;
  /** 画面描述 */
  sceneDescription: string;
  /** 场景名 */
  sceneName?: string | null;
  /** 运镜（含景别信息，如"起幅[中景]→推镜→落幅[近景]"） */
  cameraDirection?: string | null;
  /** 角色动作（含 ｜朝向：标注） */
  motionScript?: string | null;
  /** 音效 */
  soundEffect?: string | null;
  /** 台词列表 */
  dialogues?: SeedanceDialogue[];
  /** 分镜图本地路径（用于上传后得到参考编号） */
  storyboardImagePath?: string | null;
};

export type SeedanceMultiParamInput = {
  /** 项目视觉风格（用于加载 video.md 风格标签） */
  visualStyle?: string;
  /** 资产列表（按输入顺序分配 @参考N 编号） */
  assets: SeedanceAsset[];
  /** 分镜列表（一个 track 组内的所有分镜） */
  shots: SeedanceShot[];
};

// ── 编号系统 ──────────────────────────────────────────────

type RefEntry =
  | { kind: "asset_image"; refNum: number; asset: SeedanceAsset }
  | { kind: "asset_angle_image"; refNum: number; asset: SeedanceAsset; angle: string }
  | { kind: "asset_audio"; refNum: number; asset: SeedanceAsset }
  | { kind: "storyboard_image"; refNum: number; shotIndex: number };

/**
 * 按 Toonflow API adapter 规范分配 @参考N 编号：
 *
 * Seedance 多模态参考 API 的 content 数组顺序：先全部图片（reference_image），再全部音频（reference_audio）。
 * 因此编号也必须遵循"图片先行、音频殿后"的原则，不可交错。
 *
 * 分配顺序：
 *   1. 所有资产图片（按输入顺序：角色 → 场景 → 道具）
 *   2. 所有分镜首帧图（按分镜序号，跳过无首帧的分镜）
 *   3. 所有资产音频（仅 hasAudio=true 的角色，保持与图片相同的角色顺序）
 */
function buildRefEntries(assets: SeedanceAsset[], shots: SeedanceShot[]): RefEntry[] {
  const entries: RefEntry[] = [];
  let counter = 1;

  // 第一轮：所有资产图片（主图 + 紧跟其角度变体：3q → profile → back）
  for (const asset of assets) {
    entries.push({ kind: "asset_image", refNum: counter++, asset });
    for (const ai of asset.angleImages ?? []) {
      entries.push({ kind: "asset_angle_image", refNum: counter++, asset, angle: ai.angle });
    }
  }

  // 第二轮：所有分镜首帧图
  for (let i = 0; i < shots.length; i++) {
    if (shots[i].hasStoryboardImage) {
      entries.push({ kind: "storyboard_image", refNum: counter++, shotIndex: i });
    }
  }

  // 第三轮：所有资产音频（顺序与图片轮相同，以保持音色绑定的角色对应关系）
  for (const asset of assets) {
    if (asset.hasAudio) {
      entries.push({ kind: "asset_audio", refNum: counter++, asset });
    }
  }

  return entries;
}

// ── 音色处理 ──────────────────────────────────────────────

/**
 * 三级优先：
 * 1. voiceHint 文字描述（角色页手动填写或提取时 LLM 生成）
 * 2. hasAudio 参考音频（@参考N 克隆）
 * 3. 都没有 → 返回 null，省略音色行，由 Seedance 根据定妆图 @参考N 自行推断
 *    （定妆图已通过 @参考N 传给 Seedance，不需要我们猜测性别再硬编码）
 */
function resolveVoiceDescription(
  asset: SeedanceAsset,
  audioRefNum: number | undefined,
): string | null {
  // 情况1：有文字音色描述，直接照搬
  if (asset.voiceHint?.trim()) {
    return asset.voiceHint.trim();
  }
  // 情况2：有参考音频，用 @参考N 绑定
  if (asset.hasAudio && audioRefNum !== undefined) {
    return `@参考${audioRefNum}`;
  }
  // 情况3：无音色无音频 → 省略，Seedance 从定妆图推断
  return null;
}

// ── 对白类型 → 格式 + 嘴型状态 ────────────────────────────

const DIALOGUE_FORMAT: Record<SeedanceDialogue["type"], { prefix: string; lipSync: string }> = {
  dialogue: { prefix: "说：", lipSync: "嘴部开合说话" },
  os: { prefix: "内心OS：", lipSync: "嘴部紧闭不动" },
  vo: { prefix: "画外音VO：", lipSync: "嘴部紧闭不动（或不在画面中）" },
};

// ── 主函数 ────────────────────────────────────────────────

/**
 * 生成 Seedance 2.0 多参模式完整视频提示词。
 *
 * 输出格式：
 * ```
 * 画面风格和类型: {风格标签}
 *
 * 参考定义:
 * @参考1: {资产名}，{简述}
 * @参考2: {资产名}，{简述}，参考音频为：@参考3
 * @参考4: {分镜图1}
 * ...
 *
 * 生成一个由以下 N 个分镜组成的视频:
 *
 * 场景:
 * 分镜过渡: {描述}
 *
 * 分镜1 Xs: 时间：{...}，场景：{...}，镜头：{...}，{角色名} {...}。...
 * 分镜2 Xs: ...
 * ```
 */
export function buildSeedanceMultiParamVideoPrompt(input: SeedanceMultiParamInput): string {
  const { visualStyle, assets, shots } = input;

  // 1. 风格标签（从 art-styles/video.md 读取 Seedance 中文版风格词）
  const styleTag = resolveStyleTag(visualStyle);

  // 2. 分配 @参考N 编号
  const refEntries = buildRefEntries(assets, shots);

  // 建立查找 map
  const assetImageRefMap = new Map<string, number>(); // asset.id → refNum（主图）
  const assetAudioRefMap = new Map<string, number>(); // asset.id → refNum
  const shotRefMap = new Map<number, number>();        // shotIndex → refNum

  for (const entry of refEntries) {
    if (entry.kind === "asset_image") assetImageRefMap.set(entry.asset.id, entry.refNum);
    if (entry.kind === "asset_audio") assetAudioRefMap.set(entry.asset.id, entry.refNum);
    if (entry.kind === "storyboard_image") shotRefMap.set(entry.shotIndex, entry.refNum);
  }

  const lines: string[] = [];

  // 3. 第一行：风格
  lines.push(`画面风格和类型: ${styleTag}`);
  lines.push("");

  // 4. 参考定义段
  const ANGLE_LABEL: Record<string, string> = {
    "3q": "四分之三侧面",
    "profile": "正侧面",
    "back": "背面",
  };
  lines.push("参考定义:");
  for (const entry of refEntries) {
    if (entry.kind === "asset_image") {
      const asset = entry.asset;
      const desc = buildAssetDesc(asset);
      const audioRef = assetAudioRefMap.get(asset.id);
      // 仅当角色资产且存在角度变体时，标注"正面（外貌主参考）"以区别于角度变体行
      const hasAngles = asset.type === "role" && (asset.angleImages ?? []).length > 0;
      const mainLabel = hasAngles ? `${desc}正面（外貌主参考）` : desc;
      if (audioRef !== undefined) {
        lines.push(`@参考${entry.refNum}: ${asset.name}，${mainLabel}，参考音频为：@参考${audioRef}`);
      } else {
        lines.push(`@参考${entry.refNum}: ${asset.name}，${mainLabel}`);
      }
    } else if (entry.kind === "asset_angle_image") {
      const asset = entry.asset;
      const mainRef = assetImageRefMap.get(asset.id);
      const label = ANGLE_LABEL[entry.angle] ?? entry.angle;
      lines.push(`@参考${entry.refNum}: ${asset.name}${label}视图（与@参考${mainRef}同一角色，${label}外貌补充）`);
    } else if (entry.kind === "storyboard_image") {
      const shot = shots[entry.shotIndex];
      lines.push(`@参考${entry.refNum}: 分镜${entry.shotIndex + 1}，${shot.sceneName || shot.sceneDescription.slice(0, 20)}`);
    }
    // asset_audio 不另起行（已追加在资产行尾）
  }
  lines.push("");

  // 5. 分镜数量声明
  lines.push(`生成一个由以下 ${shots.length} 个分镜组成的视频:`);
  lines.push("");

  // 6. 过渡描述（多镜时生成，单镜时写"无"）
  lines.push("场景:");
  if (shots.length > 1) {
    lines.push(`分镜过渡: 镜头平滑切换，保持同一场景的视觉连贯性，情绪随动作自然流动。`);
  } else {
    lines.push("分镜过渡: 无");
  }
  lines.push("");

  // 7. 各分镜正文
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    lines.push(buildShotLine(i + 1, shot, assets, assetAudioRefMap));
  }

  return lines.join("\n");
}

// ── 辅助：风格标签 ─────────────────────────────────────────

function resolveStyleTag(visualStyle?: string): string {
  if (!visualStyle || visualStyle === "auto") {
    return "动画风格, 电影质感";
  }
  const videoContent = getArtStylePrompt(visualStyle, "video");
  if (videoContent) {
    // 从 video.md 提取 Seedance 2.0 中文版风格标签
    const match = videoContent.match(/Seedance 2\.0[（(][^）)]*[）)].*[\r\n]+[`|]?([^\r\n`|]+)/);
    if (match) return match[1].trim();
    // 备选：直接查找「中文」关键词附近的标签行
    const lines = videoContent.split("\n");
    for (const line of lines) {
      if (line.includes("Seedance") && line.includes("：")) {
        const after = line.split("：")[1]?.trim();
        if (after) return after.replace(/[`*]/g, "");
      }
    }
  }
  // fallback：按风格返回基本标签
  const fallbacks: Record<string, string> = {
    anime_2d: "90年代日式动画，手绘赛璐璐，柔和暖调，电影风格，清晰线条，怀旧质感",
    realistic: "真人写实，电影风格，冷调，现代都市",
    cg_3d: "3D动画渲染，电影质感，精细建模，体积光",
    chinese_ink: "国风二次元，赛璐璐平涂，东方古韵，新国潮美学",
    western_cartoon: "2D扁平设计，简洁线条，鲜艳色彩，卡通风格",
  };
  return fallbacks[visualStyle] || "动画风格, 电影质感";
}

// ── 辅助：资产简述 ─────────────────────────────────────────

function buildAssetDesc(asset: SeedanceAsset): string {
  const typeDesc: Record<SeedanceAsset["type"], string> = {
    role: "角色",
    scene: "场景",
    prop: "道具",
  };
  return typeDesc[asset.type];
}

// ── 辅助：单条分镜正文 ────────────────────────────────────

function buildShotLine(
  shotNum: number,
  shot: SeedanceShot,
  assets: SeedanceAsset[],
  assetAudioRefMap: Map<string, number>
): string {
  const parts: string[] = [];

  // 时间/场景/镜头基本信息
  const timeOfDay = extractTimeOfDay(shot.sceneDescription);
  parts.push(`时间：${timeOfDay}`);
  parts.push(`场景：${shot.sceneName || "当前场景"}`);
  if (shot.cameraDirection) parts.push(`运镜：${shot.cameraDirection}`);

  // 角色动作（分镜正文用角色名，不写 @参考N）
  const motionDesc = shot.motionScript
    ? shot.motionScript.replace(/｜朝向：[^\n]+/, "").trim()
    : shot.sceneDescription;
  if (motionDesc) parts.push(motionDesc);

  // 台词（按类型格式化，有音色则附带，无则省略音色段）
  const dialogueParts: string[] = [];
  for (const d of shot.dialogues ?? []) {
    const fmt = DIALOGUE_FORMAT[d.type];
    const matchedAsset = assets.find((a) => a.name === d.characterName);
    const audioRef = matchedAsset ? assetAudioRefMap.get(matchedAsset.id) : undefined;
    const voiceDesc = matchedAsset ? resolveVoiceDescription(matchedAsset, audioRef) : null;
    // 有音色描述时附带，无则省略（Seedance 从定妆图 @参考N 自行推断）
    dialogueParts.push(
      voiceDesc
        ? `${d.characterName} ${fmt.prefix}「${d.text}」音色：${voiceDesc}（${fmt.lipSync}）`
        : `${d.characterName} ${fmt.prefix}「${d.text}」（${fmt.lipSync}）`
    );
  }
  if (dialogueParts.length === 0) {
    dialogueParts.push("无台词");
  }

  // 音效
  if (shot.soundEffect) parts.push(shot.soundEffect);

  // 拼合
  const bodyText = parts.join("，") + "。" + dialogueParts.join("；");
  return `分镜${shotNum} ${shot.duration}s: ${bodyText}`;
}

// ── 辅助：从场景描述推断时间段 ─────────────────────────────

function extractTimeOfDay(desc: string): string {
  if (/黄昏|傍晚|日落|夕阳/.test(desc)) return "黄昏";
  if (/夜|深夜|午夜|月光/.test(desc)) return "夜晚";
  if (/清晨|早晨|旭日|朝阳/.test(desc)) return "清晨";
  if (/午后|正午|下午/.test(desc)) return "午后";
  if (/白天|日间|晴天/.test(desc)) return "白天";
  return "日间";
}
