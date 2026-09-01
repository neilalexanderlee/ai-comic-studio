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

import { VISUAL_STYLE_PRESETS } from "./visual-style-presets";

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
  /**
   * 素材指代编号方式，来自能力表 `VIDEO_CAPABILITIES[].refNumbering`：
   *   - "global"（默认，Seedance 2.0 系列）：全局连续 @参考1 / @参考2 / ...
   *   - "per-type"（Seedance 2.5）：按类型分别编号 @图片1 / @音频1 / @视频1
   *
   * 2.5 提示词指南明确要求按类型编号。这其实更不容易出错：API content 数组本来就按
   * 「先全部图片、再全部音频」分组，per-type 编号与该分组天然对齐，
   * 消除了 CLAUDE.md 里记过两次的「@参考N 与 refs 数组系统性偏移」陷阱。
   */
  refNumbering?: "global" | "per-type";
};

// ── 编号系统 ──────────────────────────────────────────────

/** `label` 是渲染进提示词的完整指代串（"@参考1" 或 "@图片1"），由编号方式决定。 */
type RefEntry =
  | { kind: "asset_image"; refNum: number; label: string; asset: SeedanceAsset }
  | { kind: "asset_angle_image"; refNum: number; label: string; asset: SeedanceAsset; angle: string }
  | { kind: "asset_audio"; refNum: number; label: string; asset: SeedanceAsset }
  | { kind: "storyboard_image"; refNum: number; label: string; shotIndex: number };

function refLabel(
  numbering: "global" | "per-type",
  kind: "image" | "audio" | "video",
  n: number
): string {
  if (numbering === "global") return `@参考${n}`;
  return kind === "image" ? `@图片${n}` : kind === "audio" ? `@音频${n}` : `@视频${n}`;
}

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
function buildRefEntries(
  assets: SeedanceAsset[],
  shots: SeedanceShot[],
  numbering: "global" | "per-type" = "global"
): RefEntry[] {
  const entries: RefEntry[] = [];
  // global 模式下图片和音频共用一个计数器（沿用 @参考N 的全局连续语义）；
  // per-type 模式下音频从 1 独立起编。
  let imageCounter = 1;
  let audioCounter = 1;
  const nextImage = () => imageCounter++;
  const nextAudio = () => (numbering === "global" ? imageCounter++ : audioCounter++);

  // 第一轮：所有资产图片（主图 + 紧跟其角度变体：3q → profile → back）
  for (const asset of assets) {
    const n = nextImage();
    entries.push({ kind: "asset_image", refNum: n, label: refLabel(numbering, "image", n), asset });
    for (const ai of asset.angleImages ?? []) {
      const an = nextImage();
      entries.push({
        kind: "asset_angle_image",
        refNum: an,
        label: refLabel(numbering, "image", an),
        asset,
        angle: ai.angle,
      });
    }
  }

  // 第二轮：所有分镜首帧图
  for (let i = 0; i < shots.length; i++) {
    if (shots[i].hasStoryboardImage) {
      const n = nextImage();
      entries.push({
        kind: "storyboard_image",
        refNum: n,
        label: refLabel(numbering, "image", n),
        shotIndex: i,
      });
    }
  }

  // 第三轮：所有资产音频（顺序与图片轮相同，以保持音色绑定的角色对应关系）
  for (const asset of assets) {
    if (asset.hasAudio) {
      const n = nextAudio();
      entries.push({
        kind: "asset_audio",
        refNum: n,
        label: refLabel(numbering, "audio", n),
        asset,
      });
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
  audioRefLabel: string | undefined,
): string | null {
  // 情况1：有文字音色描述，直接照搬
  if (asset.voiceHint?.trim()) {
    return asset.voiceHint.trim();
  }
  // 情况2：有参考音频，用 @参考N 绑定
  if (asset.hasAudio && audioRefLabel !== undefined) {
    return audioRefLabel;
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

  // 1. 风格标签（来自 VISUAL_STYLE_PRESETS，与全项目其他生成路径共用同一数据源）
  const styleTag = resolveStyleTag(visualStyle);

  // 2. 分配素材指代编号（@参考N 或 @图片N/@音频N，取决于 refNumbering）
  const refEntries = buildRefEntries(assets, shots, input.refNumbering ?? "global");

  // 建立查找 map（存完整指代串，避免各处再拼一次前缀）
  const assetImageRefMap = new Map<string, string>(); // asset.id → label（主图）
  const assetAudioRefMap = new Map<string, string>(); // asset.id → label
  const shotRefMap = new Map<number, string>();       // shotIndex → label

  for (const entry of refEntries) {
    if (entry.kind === "asset_image") assetImageRefMap.set(entry.asset.id, entry.label);
    if (entry.kind === "asset_audio") assetAudioRefMap.set(entry.asset.id, entry.label);
    if (entry.kind === "storyboard_image") shotRefMap.set(entry.shotIndex, entry.label);
  }

  const lines: string[] = [];

  // 3. 第一行：风格（auto 风格无强制标签时省略该行，交给 AI 从剧本/参考图推断）
  if (styleTag) {
    lines.push(`画面风格和类型: ${styleTag}`);
    lines.push("");
  }

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
        lines.push(`${entry.label}: ${asset.name}，${mainLabel}，参考音频为：${audioRef}`);
      } else {
        lines.push(`${entry.label}: ${asset.name}，${mainLabel}`);
      }
    } else if (entry.kind === "asset_angle_image") {
      const asset = entry.asset;
      const mainRef = assetImageRefMap.get(asset.id);
      const label = ANGLE_LABEL[entry.angle] ?? entry.angle;
      lines.push(`${entry.label}: ${asset.name}${label}视图（与${mainRef}同一角色，${label}外貌补充）`);
    } else if (entry.kind === "storyboard_image") {
      const shot = shots[entry.shotIndex];
      lines.push(`${entry.label}: 分镜${entry.shotIndex + 1}，${shot.sceneName || shot.sceneDescription.slice(0, 20)}`);
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
  // 唯一数据源：VISUAL_STYLE_PRESETS（与 buildStyleInstruction / 帧生成路径共用）。
  // "auto"（AI自动检测）的 tag 本就是空字符串，代表不强制风格，交给 AI 从剧本推断。
  return VISUAL_STYLE_PRESETS[visualStyle ?? ""]?.tag ?? "";
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
  assetAudioRefMap: Map<string, string>
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
