export interface CharacterImageStyleContext {
  /** projects.visualStyle 原始 key，用于区分 realistic / realistic_ancient 的真人文案 */
  visualStyle?: string;
  /** VISUAL_STYLE_PRESETS[project.visualStyle].tag，用于画风硬锁行 */
  visualStyleTag?: string;
  /** project.visualStyle 是否属于 "realistic" / "realistic_ancient" 真人写实家族 */
  isRealisticStyle?: boolean;
}

// 真实感锚点：自然语言而非关键词堆叠（对齐火山方舟官方指南——Seedream 5.0/4.5/4.0
// 对自然语言理解能力更强，简洁精确的描述优于重复堆叠的华丽词汇）。
const REALISTIC_ANCHOR = `=== 真实质感锚点 ===
这是一张真实摄影机拍摄的真人定妆照。皮肤保留真实的毛孔、细纹与自然肤色不均，是有呼吸感的活皮肤；头发是有重量感的真实发丝，带自然碎发与发缕聚散；五官与身体比例遵循真实人体解剖结构，眼睛、下巴、鼻梁、肩颈和手部都保持真人演员尺度。`;

const REALISTIC_URBAN_STYLE_MATCHING = `=== 关键：真人摄影媒介锁定 ===
画面必须像真实现代都市剧组拍摄的定妆照：真实演员、真实服装面料、真实发丝、真实皮肤和真实摄影布光。角色必须落在当代真人影视语境中，服装、发型、妆容、道具和空间都像可以实际拍摄的都市人物造型。`;

const REALISTIC_ANCIENT_STYLE_MATCHING = `=== 关键：真人摄影媒介锁定 ===
画面必须像真实古装剧组拍摄的定妆照：真实演员、真实服装面料、真实发丝、真实皮肤和真实摄影布光。即使角色来自仙侠/古风题材，也表现为真人演员穿戴可拍摄的服装与道具，所有超现实元素都落到真实服化道工艺与现场摄影质感上。`;

const REALISTIC_URBAN_BEAUTY_RULES = `=== 真人日常定妆规则 ===
- 生成一张现代都市真人剧定妆照，人物自然站立、轻微侧身或坐姿，姿态像剧组造型照而不是建模参考图。
- 画面重点展示真实面孔、自然表情、发型质感、服装面料和人物气质。
- 全身构图，从头顶到脚尖完整不缺失；允许摄影棚无缝背景、办公室、街角、室内生活空间等低调都市棚景，但不能出现空白角色设计板感。
- 不出现文字、水印、UI、标签或设定图排版。`;

const REALISTIC_ANCIENT_BEAUTY_RULES = `=== 真人日常定妆规则 ===
- 生成一张真人古装剧定妆照，人物自然站立或轻微侧身，姿态像剧组造型照而不是建模参考图。
- 画面重点展示真实面孔、自然表情、发型质感、衣料纹理和服装层次。
- 全身构图，从头顶到脚尖完整不缺失；允许摄影棚无缝背景或低调古风棚景，但不能出现空白角色设计板感。
- 不出现文字、水印、UI、标签或设定图排版。`;

const REALISTIC_URBAN_COMBAT_RULES = `=== 真人动作/职业造型规则 ===
- 生成一张现代都市真人剧动作或职业造型摄影照，像动作戏、职场戏、悬疑戏开拍前的定妆/剧照测试。
- 可展示奔跑前、回身、持包、持手机、持文件、持伞、持工具等可拍姿态；动作必须真实可拍、重心可信、关节自然，避免夸张二次元战斗姿势。
- 道具只保留真实材质、使用痕迹和现场灯光反射，让物品像真实摄影棚或实景中能被灯光照亮的实体。
- 全身构图，从头顶到脚尖完整不缺失；背景可为摄影棚无缝背景或低调都市场景，不能出现空白角色设计板感。
- 不出现文字、水印、UI、标签或设定图排版。`;

const REALISTIC_ANCIENT_COMBAT_RULES = `=== 真人武装定妆规则 ===
- 生成一张真人古装剧武装造型摄影照，像动作戏开拍前的定妆/剧照测试。
- 可展示持剑、持笛、持刀、拉弓等武装姿态，但动作必须真实可拍、重心可信、关节自然，避免夸张二次元战斗姿势。
- 道具只保留克制的现场光感、材质反光或玉石通透感，让笛子、剑刃、发饰像真实摄影棚中能被灯光照亮的实体。
- 全身构图，从头顶到脚尖完整不缺失；背景可为摄影棚无缝背景或低调古风棚景，不能出现空白角色设计板感。
- 不出现文字、水印、UI、标签或设定图排版。`;

const REALISTIC_URBAN_WARDROBE_PROPS = `=== 真人服装与道具 ===
- 所有服装、配饰和道具都必须像真实剧组服装与生活道具：有材料厚度、缝线、褶皱、磨损、反光和可使用结构。
- 都市元素以真实服装、妆发和生活物件呈现：西装、衬衫、外套、裙装、制服、包、手机、文件、饰品、鞋履各有可触摸的材质差异。`;

const REALISTIC_ANCIENT_WARDROBE_PROPS = `=== 真人服装与道具 ===
- 所有服装、武器、发饰和装备都必须像真实剧组道具与服装：有材料厚度、缝线、褶皱、磨损、反光和可穿戴结构。
- 仙侠元素以真实道具和服装工艺呈现：玉、金属、丝绸、棉麻、皮革各有可触摸的材质差异。`;

const REALISTIC_LIGHTING_PHOTOGRAPHY = `=== 真人摄影布光 ===
使用真实摄影棚或影视剧照布光：主光方向明确，补光保留皮肤细节，轮廓光克制，只用于分离发丝和衣料边缘。保留真实镜头质感、自然景深、细微颗粒、皮肤纹理和织物纹理；脸部有真人皮肤的细微瑕疵与自然血色，材质反光符合真实灯光。`;

function styleLockLine(visualStyleTag?: string): string | null {
  if (!visualStyleTag) return null;
  return `【画风硬锁】${visualStyleTag}——以下所有描述必须严格服从此画风，统一为同一种视觉媒介和摄影质感。`;
}

function realisticFlavor(styleContext?: CharacterImageStyleContext): "ancient" | "urban" {
  return styleContext?.visualStyle === "realistic_ancient" ? "ancient" : "urban";
}

function realisticStyleMatching(styleContext?: CharacterImageStyleContext): string {
  return realisticFlavor(styleContext) === "ancient"
    ? REALISTIC_ANCIENT_STYLE_MATCHING
    : REALISTIC_URBAN_STYLE_MATCHING;
}

function realisticBeautyRules(styleContext?: CharacterImageStyleContext): string {
  return realisticFlavor(styleContext) === "ancient"
    ? REALISTIC_ANCIENT_BEAUTY_RULES
    : REALISTIC_URBAN_BEAUTY_RULES;
}

function realisticCombatRules(styleContext?: CharacterImageStyleContext): string {
  return realisticFlavor(styleContext) === "ancient"
    ? REALISTIC_ANCIENT_COMBAT_RULES
    : REALISTIC_URBAN_COMBAT_RULES;
}

function realisticWardrobeProps(styleContext?: CharacterImageStyleContext): string {
  return realisticFlavor(styleContext) === "ancient"
    ? REALISTIC_ANCIENT_WARDROBE_PROPS
    : REALISTIC_URBAN_WARDROBE_PROPS;
}

function realisticBeautyRole(styleContext?: CharacterImageStyleContext): string {
  return realisticFlavor(styleContext) === "ancient"
    ? `你是一位顶级的真人人像摄影师与选角指导。你的任务是根据角色描述，为一场古装文戏完成一张高质量的真人摄影棚拍定妆照——全程按真实摄影成像。`
    : `你是一位顶级的真人人像摄影师与选角指导。你的任务是根据角色描述，为一场现代都市文戏完成一张高质量的真人摄影棚拍定妆照——全程按真实摄影成像。`;
}

function realisticCombatRole(styleContext?: CharacterImageStyleContext): string {
  return realisticFlavor(styleContext) === "ancient"
    ? `你是一位顶级的真人剧组动作指导与人像摄影师。你的任务是根据角色描述，为一场古装动作戏完成一张高质量的真人武装造型摄影定妆照——全程按真实摄影成像。`
    : `你是一位顶级的真人剧组造型指导与人像摄影师。你的任务是根据角色描述，为一场现代都市动作戏、职场戏或悬疑戏完成一张高质量的真人造型摄影定妆照——全程按真实摄影成像。`;
}

export function buildCharacterTurnaroundPrompt(
  slotContents: Record<string, string>,
  characterName: string,
  description: string,
  styleContext?: CharacterImageStyleContext
): string {
  // Use the registry definition to assemble the prompt
  // But we have to replicate the buildFullPrompt logic here because we need to pass dynamic params
  const r = (k: string) => slotContents[k] || "";
  const isRealistic = !!styleContext?.isRealisticStyle;
  const lock = styleLockLine(styleContext?.visualStyleTag);

  let nameLabelText: string;
  if (characterName) {
    nameLabelText = `=== 角色名标签 ===\n在四视图布局下方居中显示角色名"${characterName}"。使用现代无衬线字体，白色背景上的深色文字，居中对齐。名字清晰可读，呈现专业设定集风格。`;
  } else {
    nameLabelText = `=== 角色名标签 ===\n无需角色名标签。`;
  }

  const lines: string[] = [
    isRealistic
      ? `角色四视图参考设定图——一场专业真人摄影棚拍摄的人物参考板（选角照/造型参考板），全程按真实摄影成像。`
      : `角色四视图参考设定图——专业角色设计文档。`,
  ];
  if (lock) lines.push(lock);
  lines.push("", isRealistic ? realisticStyleMatching(styleContext) : r("style_matching"), "");
  if (isRealistic) lines.push(REALISTIC_ANCHOR, "");
  lines.push(
    `=== 角色描述 ===`,
    `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
    "",
    r("face_detail"),
    "",
    isRealistic ? realisticWardrobeProps(styleContext) : r("weapons_equipment"),
    "",
    r("four_view_layout"),
    "",
    isRealistic ? REALISTIC_LIGHTING_PHOTOGRAPHY : r("lighting_rendering"),
    "",
    r("consistency_rules"),
    "",
    nameLabelText,
    "",
    r("final_output_standard")
  );
  return lines.join("\n");
}

export function buildBeautyImagePrompt(
  slotContents: Record<string, string>,
  characterName: string,
  description: string,
  styleContext?: CharacterImageStyleContext
): string {
  const r = (k: string) => slotContents[k] || "";
  const isRealistic = !!styleContext?.isRealisticStyle;
  const lock = styleLockLine(styleContext?.visualStyleTag);
  const roleText = isRealistic
    ? realisticBeautyRole(styleContext)
    : r("role_definition");

  const lines: string[] = [roleText];
  if (lock) lines.push(lock);
  lines.push("", isRealistic ? realisticStyleMatching(styleContext) : r("style_matching"), "");
  if (isRealistic) lines.push(REALISTIC_ANCHOR, "");
  lines.push(
    `=== 角色描述 ===`,
    `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
    "",
    isRealistic ? realisticBeautyRules(styleContext) : r("beauty_rules"),
    "",
    r("face_detail"),
    "",
    isRealistic ? REALISTIC_LIGHTING_PHOTOGRAPHY : r("lighting_rendering")
  );
  return lines.join("\n");
}

export function buildCombatImagePrompt(
  slotContents: Record<string, string>,
  characterName: string,
  description: string,
  styleContext?: CharacterImageStyleContext
): string {
  const r = (k: string) => slotContents[k] || "";
  const isRealistic = !!styleContext?.isRealisticStyle;
  const lock = styleLockLine(styleContext?.visualStyleTag);
  const roleText = isRealistic
    ? realisticCombatRole(styleContext)
    : r("role_definition");

  const lines: string[] = [roleText];
  if (lock) lines.push(lock);
  lines.push("", isRealistic ? realisticStyleMatching(styleContext) : r("style_matching"), "");
  if (isRealistic) lines.push(REALISTIC_ANCHOR, "");
  lines.push(
    `=== 角色描述 ===`,
    `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
    "",
    isRealistic ? realisticCombatRules(styleContext) : r("combat_rules"),
    "",
    isRealistic ? realisticWardrobeProps(styleContext) : r("weapons_equipment"),
    "",
    isRealistic ? REALISTIC_LIGHTING_PHOTOGRAPHY : r("lighting_rendering")
  );
  return lines.join("\n");
}
