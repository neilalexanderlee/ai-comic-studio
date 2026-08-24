// ─────────────────────────────────────────────────────────
// Prompt Registry — Slot Decomposition
// Decomposes all prompt templates into editable slots.
// ─────────────────────────────────────────────────────────

import {
  CHARACTER_EXTRACT_DEFAULT_SLOTS,
  assembleCharacterExtractPrompt,
} from "./character-extract-defaults";
import {
  IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS,
  assembleImportCharacterExtractPrompt,
} from "./import-character-extract-defaults";
import { OUTLINE_EXPAND_SYSTEM_DEFAULT } from "./outline-expand-defaults";
import {
  STORYBOARD_REWRITE_SYSTEM,
  PLOT_OPTIMIZE_SYSTEM,
} from "./storyboard-supervision";

// ── Types ────────────────────────────────────────────────

export interface PromptSlot {
  /** Unique key within a prompt definition */
  key: string;
  /** i18n key for the human-readable slot name */
  nameKey: string;
  /** i18n key for the slot description */
  descriptionKey: string;
  /** The original text content of this slot */
  defaultContent: string;
  /** Whether users can customise this slot */
  editable: boolean;
}

export type PromptCategory =
  | "script"
  | "character"
  | "shot"
  | "frame"
  | "video";

export interface PromptDefinition {
  /** Machine-readable key, e.g. "script_generate" */
  key: string;
  /** i18n key for the prompt name */
  nameKey: string;
  /** i18n key for the prompt description */
  descriptionKey: string;
  /** Grouping category */
  category: PromptCategory;
  /** Ordered list of slots that compose this prompt */
  slots: PromptSlot[];
  /**
   * Reassemble the full system prompt from (possibly customised) slot contents.
   * @param slotContents  Map of slot key → text content. Missing keys fall back to defaults.
   * @param params        Dynamic parameters required by some prompts (e.g. maxDuration for shot_split).
   */
  buildFullPrompt: (
    slotContents: Record<string, string>,
    params?: Record<string, unknown>
  ) => string;
}

// ── Helpers ──────────────────────────────────────────────

function slot(
  key: string,
  defaultContent: string,
  editable: boolean
): PromptSlot {
  return {
    key,
    nameKey: `promptTemplates.slots.${camel(key)}`,
    descriptionKey: `promptTemplates.slots.${camel(key)}Desc`,
    defaultContent,
    editable,
  };
}

function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function resolve(
  slotContents: Record<string, string>,
  slots: PromptSlot[],
  key: string
): string {
  if (key in slotContents) return slotContents[key];
  const s = slots.find((sl) => sl.key === key);
  return s?.defaultContent ?? "";
}

// ── Prompt Definitions ──────────────────────────────────

// ─── 1. script_generate ─────────────────────────────────

const SCRIPT_GENERATE_ROLE_DEFINITION = `你是一位屡获殊荣的编剧，擅长视觉叙事和短片动画内容创作。你的剧本以电影级的节奏感、生动的画面描写和情感共鸣的对白著称。

你的任务：将一段简短的创意构想转化为一部精致的、可直接投入制作的剧本，专为AI动画生成优化（每个场景 = 一个5-15秒的动画镜头）。`;

const SCRIPT_GENERATE_LANGUAGE_RULES = `【关键语言规则】你必须使用与用户输入相同的语言撰写整部剧本。如果用户用中文写作，则全部用中文输出；如果用英文，则全部用英文输出。此规则适用于以下所有章节。`;

const SCRIPT_GENERATE_OUTPUT_FORMAT = `输出格式——剧本必须按以下顺序包含这些章节：`;

const SCRIPT_GENERATE_VISUAL_STYLE_SECTION = `=== 1. 视觉风格 ===
在剧本最顶部声明整体美术方向，定义整个项目的视觉身份。包含：
- 画风：写实真人 / 写实CG / 动漫 / 2D卡通 / 水彩 / 像素风 等（尊重用户偏好，如"真人" = 写实真人风格）
- 色彩基调：整体色调（暖色、冷色、低饱和度、鲜艳），主色
- 时代与美学：现代、复古、未来科幻、奇幻中世纪 等
- 氛围与情绪：电影黑色、轻松喜剧、史诗冒险 等

【示例】
视觉风格：写实真人电影风格，暖色调为主，以琥珀色和深棕为主色，1960年代老上海美学，弄堂烟火气与霓虹灯光交织，怀旧温情中带有一丝哀伤。`;

const SCRIPT_GENERATE_CHARACTER_SECTION = `=== 2. 角色描述 ===
为每个有名字的角色提供详细的视觉描述：
  角色名
  - 外貌：性别、年龄、身高/体型、面部特征、肤色、发型（颜色、样式、长度）
  - 服装：具体的衣物描述，包含材质和颜色（如"磨旧的棕色皮夹克，褪色靛蓝牛仔裤，白色运动鞋"）
  - 标志性特征：伤疤、眼镜、纹身、饰品等
  - 动态性格：他们的体态语言（姿态、步态、习惯性动作）

【示例】
林晓月
- 外貌：女，25岁，身高165cm，纤瘦身材，鹅蛋脸，柳叶眉，一双清澈的杏眼，浅蜜色肌肤，黑色齐腰长直发
- 服装：米白色棉麻衬衫，袖口挽至手肘；高腰深蓝色阔腿裤；棕色牛皮编织凉鞋；左手腕一串檀木佛珠手链
- 标志性特征：右耳后一颗小痣，笑起来有浅浅酒窝
- 动态性格：走路轻盈有节奏感，说话时喜欢微微歪头，紧张时会无意识地拨弄手链

赵东明
- 外貌：男，35岁，身高182cm，宽肩厚背的壮硕体型，国字脸，浓眉大眼，古铜色皮肤，利落板寸短发微有灰丝
- 服装：深灰色工装夹克，内搭黑色圆领T恤；卡其色工装裤多口袋；黑色厚底马丁靴；右手无名指银色宽面戒指
- 标志性特征：左眉上一道3厘米的旧疤，下巴留有精心修剪的短茬胡须
- 动态性格：站姿如松，习惯双手环胸，说话声音低沉有力，思考时会用拇指摩挲戒指`;

const SCRIPT_GENERATE_SCENE_SECTION = `=== 3. 场景 ===
专业剧本格式：
- 场景标题："场景 [N] — [内景/外景]. [地点] — [时间]"
- 每个场景的括号内舞台提示：
  • 镜头构图（特写、全景、过肩镜头 等）
  • 角色走位和动作
  • 关键环境细节（光线、天气、道具、建筑、色彩）
  • 场景的情感节拍
- 角色对白：
  角色名
  （表演提示）
  "对白内容"

【示例】
场景 1 — 外景. 老城区弄堂 — 黄昏

（全景缓缓推进）夕阳将弄堂的青石板路染成暖橘色，两旁晾衣竿上挂满了花花绿绿的被单，在晚风中轻轻摇摆。远处传来收音机播放的老歌。

（中景）林晓月骑着一辆旧自行车从巷口拐进来，车篮里放着一袋刚买的菜，几根葱探出袋口。她单手扶把，另一只手拨开垂落的晾衣被单。

林晓月
（自言自语，微微喘气）
"又差点迟到……"

（近景切换）弄堂深处，赵东明倚在自家门框上，手里夹着一根没点燃的烟，眯眼看着晓月骑车过来，嘴角不易察觉地微微上扬。`;

const SCRIPT_GENERATE_SCREENWRITING_PRINCIPLES = `编剧原则：
- 以"钩子"开场——一个引人注目的视觉画面或令人好奇的瞬间
- 每个场景都必须服务于故事：推进情节、揭示角色或制造张力
- "展示，而非讲述"——优先用视觉叙事取代旁白说明
- 对白应自然生动；潜台词优于直白表达
- 构建清晰的三幕结构：铺垫 → 冲突 → 解决
- 以情感收束结尾——意外、宣泄或一个有力的画面
- 根据目标时长调整场景数量。如创意中指定了目标时长（如"目标时长：10分钟"），按此计算场景数：约每30-60秒一个场景。10分钟的短片需要10-20个场景，而不是4-8个。
- 每个场景描述必须足够具体，让AI图像生成器能据此生成画面（描述颜色、空间关系、光照质量）
- 场景描述应与声明的视觉风格一致（如"写实"则描述摄影细节；如"动漫"则描述动漫美学）

不要输出JSON。不要使用markdown代码块。仅输出纯文本剧本。`;

const scriptGenerateDef: PromptDefinition = {
  key: "script_generate",
  nameKey: "promptTemplates.prompts.scriptGenerate",
  descriptionKey: "promptTemplates.prompts.scriptGenerateDesc",
  category: "script",
  slots: [
    slot("role_definition", SCRIPT_GENERATE_ROLE_DEFINITION, true),
    slot("language_rules", SCRIPT_GENERATE_LANGUAGE_RULES, false),
    slot("output_format", SCRIPT_GENERATE_OUTPUT_FORMAT, false),
    slot("visual_style_section", SCRIPT_GENERATE_VISUAL_STYLE_SECTION, true),
    slot("character_section", SCRIPT_GENERATE_CHARACTER_SECTION, true),
    slot("scene_section", SCRIPT_GENERATE_SCENE_SECTION, true),
    slot(
      "screenwriting_principles",
      SCRIPT_GENERATE_SCREENWRITING_PRINCIPLES,
      true
    ),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("language_rules"),
      "",
      r("output_format"),
      "",
      r("visual_style_section"),
      "",
      r("character_section"),
      "",
      r("scene_section"),
      "",
      r("screenwriting_principles"),
    ].join("\n");
  },
};

// ─── 2. script_parse ────────────────────────────────────

const SCRIPT_PARSE_ROLE_DEFINITION = `你是一位资深剧本监制和故事编辑，擅长将叙事文本改编为适合动画短片的结构化剧本。

你的任务：分析用户的原始故事、散文或非结构化文本，将其重构为格式精确的剧本JSON，为下游AI动画流水线（图像生成 → 视频生成）优化。`;

const SCRIPT_PARSE_OUTPUT_FORMAT = `输出单个JSON对象：
{
  "title": "引人入胜的标题",
  "synopsis": "1-2句话的故事梗概，捕捉核心冲突和利害关系",
  "scenes": [
    {
      "sceneNumber": 1,
      "setting": "具体地点 + 时间（如'灯光昏暗的地下工作室——深夜'）",
      "description": "详细的视觉描写：角色位置、动作、关键道具、光照质量（暖/冷/戏剧性）、氛围、色彩基调。以镜头指导的方式书写，让动画师可以直接执行。",
      "mood": "精确的情感基调（如'紧张的期待中带有潜在的温暖'）",
      "dialogues": [
        {
          "character": "角色名（必须与其他地方使用的名字完全一致）",
          "text": "自然的对白内容",
          "emotion": "具体的表演提示（如'压低声音急促地说，眼神游移不定'）"
        }
      ]
    }
  ]
}`;

const SCRIPT_PARSE_PARSING_RULES = `故事编辑原则：
- 保留原作者的创作意图、基调和风格
- 识别并强化叙事弧线：起因 → 发展 → 高潮 → 结局
- 每个场景 = 一个连续的5-15秒动画镜头；长段落应拆分为多个场景
- 场景描写必须具有视觉具体性：指定空间关系、角色姿态、光线方向、主色调
- 对白情绪应描述肢体表达，而不只是情感名称
- 在所有场景中保持角色名称的严格一致性
- 如果原文含糊，推断合理的视觉细节以服务故事

【示例——原文到场景的转化】
原文："他走进房间，看到了她。"
转化后：
{
  "sceneNumber": 1,
  "setting": "老旧公寓客厅——傍晚",
  "description": "逆光剪影构图，橙红色夕阳从落地窗倾泻而入。男人推开半掩的木门，门轴发出轻微的吱呀声。女人背对门口站在窗前，纤细的身影被夕阳勾出金色轮廓，手中端着一杯已经凉透的茶。空气中悬浮着细小的灰尘颗粒，在光束中缓缓旋转。",
  "mood": "重逢的忐忑，夹杂着岁月沉淀的苦涩与温柔",
  "dialogues": []
}`;

const SCRIPT_PARSE_LANGUAGE_RULES = `【关键语言规则】JSON中的所有文本内容（title、synopsis、setting、description、mood、对白text、emotion）必须使用与原文相同的语言。中文原文 → 中文输出。不要翻译成英文。

仅返回有效JSON。不要使用markdown代码块。不要添加任何评论。`;

const scriptParseDef: PromptDefinition = {
  key: "script_parse",
  nameKey: "promptTemplates.prompts.scriptParse",
  descriptionKey: "promptTemplates.prompts.scriptParseDesc",
  category: "script",
  slots: [
    slot("role_definition", SCRIPT_PARSE_ROLE_DEFINITION, true),
    slot("output_format", SCRIPT_PARSE_OUTPUT_FORMAT, false),
    slot("parsing_rules", SCRIPT_PARSE_PARSING_RULES, true),
    slot("language_rules", SCRIPT_PARSE_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("output_format"),
      "",
      r("parsing_rules"),
      "",
      r("language_rules"),
    ].join("\n");
  },
};

// ─── 3. script_split ────────────────────────────────────

const SCRIPT_SPLIT_ROLE_DEFINITION = `你是一位屡获殊荣的编剧，擅长分集式动画内容创作。你的任务是将原始素材（可能是小说、文章、报告、故事或任何文本）改编为分集剧本格式，按目标时长拆分。`;

const SCRIPT_SPLIT_SPLITTING_RULES = `规则：
1. 每一集必须是独立的叙事单元，有清晰的开头、发展和悬念/结局。
2. 在自然的故事分界点拆分——场景转换、时间跳跃、视角切换或戏剧性转折点。
3. 为每一集生成简洁的标题、1-2句描述和3-5个逗号分隔的关键词。
4. 如果原始素材是非叙事性的（如报告、手册、文章），创造性地改编为故事——使用角色、戏剧化和视觉隐喻使内容引人入胜。`;

const SCRIPT_SPLIT_IDEA_REQUIREMENTS = `5. "idea"字段将作为独立AI剧本生成器的唯一输入。它必须极其详细：
   - 以出场角色列表及其角色定位开头
   - 逐字复制原文中属于本集的最重要段落、对白和描写——不要概括，保留原文措辞
   - 添加结构性注释：场景过渡、情感节拍、视觉亮点
   - 下游AI完全无法访问原始素材——它需要的一切都必须在此字段中
   - 每集最少1000字。越长越好。包含原文直接引用。`;

const SCRIPT_SPLIT_LANGUAGE_RULES = `【关键语言规则】所有输出字段（title、description、keywords、script）必须使用与原始素材相同的语言。中文输入 → 中文输出。英文输入 → 英文输出。`;

const SCRIPT_SPLIT_OUTPUT_FORMAT = `输出格式——仅JSON数组，不要markdown代码块，不要评论：
[
  {
    "title": "集标题",
    "description": "本集简要剧情概述",
    "keywords": "关键词1, 关键词2, 关键词3",
    "idea": "1) 列出本集所有角色及其定位。2) 逐字复制原文中的关键段落和对白——保留原文措辞，不要概括。3) 添加场景过渡注释和情感节拍标记。最少1000字。下游剧本生成器无法访问原文——此字段是它的唯一参考。",
    "characters": ["角色名1", "角色名2"]
  }
]

═══ 分集角色 ═══
你将获得完整的角色列表。为每一集列出所有实际出场的角色名（主角和配角）。使用提供的原名。不要在每一集都包含所有角色——只包含真正出场、有台词或直接参与剧情的角色。`;

const scriptSplitDef: PromptDefinition = {
  key: "script_split",
  nameKey: "promptTemplates.prompts.scriptSplit",
  descriptionKey: "promptTemplates.prompts.scriptSplitDesc",
  category: "script",
  slots: [
    slot("role_definition", SCRIPT_SPLIT_ROLE_DEFINITION, true),
    slot("splitting_rules", SCRIPT_SPLIT_SPLITTING_RULES, true),
    slot("idea_requirements", SCRIPT_SPLIT_IDEA_REQUIREMENTS, true),
    slot("language_rules", SCRIPT_SPLIT_LANGUAGE_RULES, false),
    slot("output_format", SCRIPT_SPLIT_OUTPUT_FORMAT, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("splitting_rules"),
      r("idea_requirements"),
      "",
      r("language_rules"),
      "",
      r("output_format"),
    ].join("\n");
  },
};

// ─── 4. character_extract ───────────────────────────────
// Runtime: resolveCharacterExtractSystemPrompt — injects {STYLE_INSTRUCTION} from project visualStyle.

const characterExtractDef: PromptDefinition = {
  key: "character_extract",
  nameKey: "promptTemplates.prompts.characterExtract",
  descriptionKey: "promptTemplates.prompts.characterExtractDesc",
  category: "character",
  slots: [
    slot("role_definition", CHARACTER_EXTRACT_DEFAULT_SLOTS.role_definition, true),
    slot("scope_rules", CHARACTER_EXTRACT_DEFAULT_SLOTS.scope_rules, true),
    slot("style_detection", CHARACTER_EXTRACT_DEFAULT_SLOTS.style_detection, true),
    slot("deduplication", CHARACTER_EXTRACT_DEFAULT_SLOTS.deduplication, true),
    slot("coverage_check", CHARACTER_EXTRACT_DEFAULT_SLOTS.coverage_check, true),
    slot("output_format", CHARACTER_EXTRACT_DEFAULT_SLOTS.output_format, false),
    slot(
      "description_requirements",
      CHARACTER_EXTRACT_DEFAULT_SLOTS.description_requirements,
      true
    ),
    slot("writing_rules", CHARACTER_EXTRACT_DEFAULT_SLOTS.writing_rules, true),
    slot("language_rules", CHARACTER_EXTRACT_DEFAULT_SLOTS.language_rules, false),
  ],
  buildFullPrompt(sc) {
    return assembleCharacterExtractPrompt(sc);
  },
};

// ─── 5. import_character_extract ────────────────────────
// Runtime: resolveImportCharacterExtractSystem — injects {STYLE_INSTRUCTION} from project visualStyle.

const importCharacterExtractDef: PromptDefinition = {
  key: "import_character_extract",
  nameKey: "promptTemplates.prompts.importCharacterExtract",
  descriptionKey: "promptTemplates.prompts.importCharacterExtractDesc",
  category: "character",
  slots: [
    slot("role_definition", IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS.role_definition, true),
    slot("extraction_rules", IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS.extraction_rules, true),
    slot("style_instruction", IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS.style_instruction, true),
    slot(
      "description_requirements",
      IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS.description_requirements,
      true
    ),
    slot("visual_hint_rules", IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS.visual_hint_rules, true),
    slot("language_rules", IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS.language_rules, false),
    slot("output_format", IMPORT_CHARACTER_EXTRACT_DEFAULT_SLOTS.output_format, false),
  ],
  buildFullPrompt(sc) {
    return assembleImportCharacterExtractPrompt(sc);
  },
};

// ─── 6. character_image ─────────────────────────────────

const CHAR_IMAGE_STYLE_MATCHING = `=== 关键：画风匹配 ===
仔细阅读下方的角色描述。描述中指定或暗示了画风（如 动漫、漫画、写实照片级、卡通、水彩、像素风、油画 等）。
你必须精确匹配该画风。不要默认使用写实风格。不要覆盖描述中的风格。
如果描述中提到 "动漫"/"漫画"/"anime"/"manga" → 生成动漫 / 漫画风格插画
如果描述中提到 "写实"/"真人"/"photorealistic" → 生成写实渲染
如果描述暗示其他风格 → 忠实遵循该风格
如果完全未提及风格 → 根据角色的背景和类型推断最合适的风格`;

const CHAR_IMAGE_FACE_DETAIL = `=== 面部 —— 高精度 ===
以适合所选画风的高精度渲染面部：
清晰一致的面部特征：骨骼结构、眼型、鼻型、嘴型 —— 全部匹配描述中的外貌，全视角五官完全统一无偏差
眼睛：富有表现力、细节丰富、有高光反射和深度感 —— 根据画风调整（动漫用动漫风格眼睛，写实用精细虹膜细节）
头发：清晰的发量、颜色和动态感，发型结构、发束分区全视角统一，使用适合画风的渲染方式（写实用单根发丝，动漫用大块发束配高光条）
皮肤：符合画风的渲染 —— 动漫用平滑赛璐珞着色，写实用毛孔级细节
整体：面部应具有辨识度和记忆点，有强烈的视觉特征`;

const CHAR_IMAGE_FOUR_VIEW_LAYOUT = `=== 四视图布局 ===
四个视角从左到右横向等距排列在纯白画布上，独立分镜互不干扰，人物全程笔直站立、头部端正、无歪头、无扭头、无倾斜，同一视角内比例与构图严格锁定：

正面 —— 完全 0 度正对观众，【全身像，从头顶到脚尖完整不缺失，严禁截断腰部以下】，标准正面站姿，双臂自然放松垂于两侧，展示完整服装、鞋履和手持武器
四分之三侧面 —— 固定向右精准 45°，严格限定角度，禁止偏大/偏小，【上半身半身像，从头顶到腰部】，重点展示面部立体感、发型侧面造型与上身服装细节
侧面轮廓 —— 固定向右标准 90° 纯正侧面，角度锁死无偏移，【全身像，从头顶到脚尖完整不缺失】，清晰展示整体轮廓线、鼻子侧面、头发厚度和武器侧面剪影
背面 —— 完全 180° 背对镜头，【全身像，从头顶到脚尖完整不缺失，严禁截断腰部以下】，展示后脑发型、服装背部所有细节、背部装备与鞋履后跟`;

const CHAR_IMAGE_LIGHTING_RENDERING = `=== 光线与渲染 ===
干净的专业布光：主光从前上方，补光从对侧，轮廓光用于分离角色
纯白纯色背景，无杂物、无文字、无水印，确保角色清晰分离
在所选画风内达到最高渲染质量
四个视角保持完全统一的光线方向、明暗、阴影强度`;

const CHAR_IMAGE_CONSISTENCY_RULES = `=== 四视角一致性 ===
每个视角中角色身份必须完全一致 —— 相同的面孔、相同的体型比例、相同的精确配色
服装、配饰、武器位置、发色和发型完全一致，无变形、无错位、无细节改动
四个视角严格头顶对齐、腰部水平线对齐，人物等高等比例
所有视角保持一致的表情、神态和性格气质
禁止 AI 自动修改视角、混合角度、扭曲透视、更改动作`;

const CHAR_IMAGE_WEAPONS_EQUIPMENT = `=== 武器与装备（如有）===
- 以与角色相同的画风渲染所有武器、铠甲和装备
- 展示适合画风的材质细节：写实风要有使用痕迹，动漫/卡通风要有干净的风格化线条
- 所有装备必须与角色身体比例协调`;

const CHAR_IMAGE_FINAL_OUTPUT_STANDARD = `=== 最终输出标准 ===
专业角色设计参考设定图。在所选画风内达到最高质量。零AI瑕疵，视图之间零不一致。这是唯一的权威参考——所有后续生成的画面必须精确再现此角色的此风格。`;

// The name_label slot is locked because it is dynamically generated from the character name
const CHAR_IMAGE_NAME_LABEL = `=== 角色名标签 ===
{{NAME_LABEL_PLACEHOLDER}}`;

const characterImageDef: PromptDefinition = {
  key: "character_image",
  nameKey: "promptTemplates.prompts.characterImage",
  descriptionKey: "promptTemplates.prompts.characterImageDesc",
  category: "character",
  slots: [
    slot("style_matching", CHAR_IMAGE_STYLE_MATCHING, true),
    slot("face_detail", CHAR_IMAGE_FACE_DETAIL, true),
    slot("weapons_equipment", CHAR_IMAGE_WEAPONS_EQUIPMENT, true),
    slot("four_view_layout", CHAR_IMAGE_FOUR_VIEW_LAYOUT, true),
    slot("lighting_rendering", CHAR_IMAGE_LIGHTING_RENDERING, true),
    slot("consistency_rules", CHAR_IMAGE_CONSISTENCY_RULES, true),
    slot("name_label", CHAR_IMAGE_NAME_LABEL, false),
    slot("final_output_standard", CHAR_IMAGE_FINAL_OUTPUT_STANDARD, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const characterName = (params?.characterName as string) ?? undefined;
    const description = (params?.description as string) ?? "";

    // Resolve name label dynamically
    let nameLabelText: string;
    if (characterName) {
      nameLabelText = `=== 角色名标签 ===\n在四视图布局下方居中显示角色名"${characterName}"。使用现代无衬线字体，白色背景上的深色文字，居中对齐。名字清晰可读，呈现专业设定集风格。`;
    } else {
      nameLabelText = `=== 角色名标签 ===\n无需角色名标签。`;
    }

    return [
      `角色四视图参考设定图——专业角色设计文档。`,
      "",
      r("style_matching"),
      "",
      `=== 角色描述 ===`,
      `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
      "",
      r("face_detail"),
      "",
      r("weapons_equipment"),
      "",
      r("four_view_layout"),
      "",
      r("lighting_rendering"),
      "",
      r("consistency_rules"),
      "",
      nameLabelText,
      "",
      r("final_output_standard"),
    ].join("\n");
  },
};

// ─── 7. shot_split ──────────────────────────────────────
// Single source of truth for shot_split system prompt.
// All slots default to the S-grade content — identical to what the code used to
// keep in shot-split.ts/buildShotSplitSystem(). Users can override individual
// slots via the UI without losing the rest of the S-grade requirements.

const SHOT_SPLIT_ROLE_DEFINITION = `You are an S-rank storyboard director, cinematographer, and visual storyteller specializing in theatrical-quality animated short films. Your shot lists power an AI video pipeline where each shot becomes a {{MIN_DURATION}}–{{MAX_DURATION}} second clip generated by Seedance 2.0. The quality of your descriptions DIRECTLY determines whether the output is film-grade or amateur.

🔑 DIRECTOR'S CREATIVE AUTHORITY — FULL OVERRIDE POWER
═══════════════════════════════════════════════════════
The screenplay is STORY INPUT — a rough outline, NOT a sacred script to transcribe. You are the director adapting it for film. The screenplay was written for reading, not for AI video generation — it often contains physically impossible descriptions, jarring transitions, or generic placeholders that would produce poor output if copied literally.

YOU MUST SILENTLY OVERRIDE the screenplay whenever it contains:

① PHYSICAL IMPOSSIBILITIES → rewrite with physically correct equivalents that preserve mood
   BAD screenplay input: "金色灯笼链从画面四角延伸" (lanterns defy gravity, point outward)
   CORRECT output: "金色灯笼链沿屋檐垂落，前景灯笼从画面下方入画" (they hang down, frame naturally)

② CINEMATICALLY BROKEN TRANSITIONS → insert bridging shots or rewrite endFrame/startFrame
   BAD: crowd scene cuts directly to extreme close-up of two characters with no spatial lead-in
   CORRECT: endFrame of crowd shot already drifts camera toward the sub-location

③ GENERIC/TEMPLATE DESCRIPTIONS → rewrite with specific, filmable prose that Seedance can use
   BAD: "人群在篝火旁欢呼庆祝" → rewrite with specific crowd dynamics, movement, lighting
   BAD: "镜头扫过小镇夜景" → rewrite with exact camera path, what reveals in sequence

④ STORY/VISUAL CONTINUITY BREAKS → fix silently to make the whole episode feel coherent
   Insert bridging shots for hard cuts that don't work cinematically.
   Insert reaction shots for missing emotional beats.

OVERRIDE EXECUTION RULE: Fix problems silently — output the corrected S-grade version as if it was always correct. Goal: COHERENT, PHYSICALLY CORRECT, CINEMATICALLY FLUID — not a faithful transcription of imperfect source material.`;

const SHOT_SPLIT_OUTPUT_FORMAT_TEMPLATE = `Output a JSON array. Each shot object MUST contain all of the following fields:
[
  {
    "sequence": 1,
    "sceneDescription": "【视觉核心：[single visual concept] | 反差：[contrast pair A vs B] | 排除：[what is actively excluded from frame]】 + scene/environment: setting, architecture, props, weather, time of day, lighting setup, color palette, atmospheric mood. MUST start with the 【视觉核心 | 反差 | 排除】 line derived from your director's concept step.",
    "startFrame": "Detailed FIRST FRAME description for AI image generation (see requirements below)",
    "endFrame": "Detailed LAST FRAME description for AI image generation (see requirements below)",
    "motionScript": "Complete time-segmented action script ending with ｜朝向：[face direction] annotation (see requirements below)",
    "duration": {{MIN_DURATION}}-{{MAX_DURATION}},
    "soundEffect": "Diegetic sound events only (no music/BGM), e.g. 风声衣袂声/脚步声金属碰撞/火焰噼啪声",
    "cameraDirection": "Specific camera movement instruction"
  }
]

FIELD RULES:
- soundEffect: REQUIRED. Diegetic/environmental sounds only. Write "无音效" if truly silent. NEVER include music or BGM here.

ORIENTATION RULE (｜朝向：annotation in motionScript):
Every motionScript for a shot containing named characters MUST end with: ｜朝向：[direction]
Direction must be one of: 正面面朝镜头 / 3/4侧面朝右 / 3/4侧面朝左 / 正侧面朝右 / 正侧面朝左 / 背对镜头 / 3/4背面朝右 / 3/4背面朝左
For dialogue scenes with two characters: specify both, e.g. ｜朝向：角色甲3/4侧面朝右，角色乙3/4侧面朝左
For environment/crowd shots without named characters: omit the ｜朝向：annotation.`;

const SHOT_SPLIT_DIRECTOR_CONCEPT_RULES = `═══════════════════════════════════════════════════
  DIRECTOR'S VISUAL CONCEPT — MANDATORY FIRST STEP (before writing ANY shot fields)
═══════════════════════════════════════════════════
You are not transcribing plot action into visuals. You are a director choosing HOW to show a story beat.

For EVERY shot, before writing startFrame/endFrame/motionScript, you MUST silently ask THREE questions:

  Q1 — SINGLE VISUAL CONCEPT: "In one phrase, what is this shot VISUALLY ABOUT?"
       Not the plot action ("李明走进房间") — the visual IDEA ("门口空间作为情感分界线，李明在门槛停住不进去")
       A shot with no single visual concept = a shot with no reason to exist.

  Q2 — CONTRAST PAIR: "What two things are in tension or opposition in this frame?"
       The most powerful shots are built on contrast. Examples:
       - 静止主体 vs 动态背景（角色纹丝不动，身后战场爆炸）
       - 荒诞处境 vs 平静反应（奇观红光包围，角色淡定打电话）
       - 前景秘密 vs 中景无知（前景虚焦的危险物，中景角色毫无察觉）
       - 极近景局部 vs 极远景全貌（眼睛特写 vs 拉远揭示空旷环境）
       No contrast = flat shot. Force a contrast even where the screenplay doesn't have one.

  Q3 — ACTIVE EXCLUSION: "What am I deliberately NOT showing, and why?"
       Exclusion is a directorial decision, not a technical constraint.
       Examples:
       - "整段不拍脸，只拍腿部——保持悬念，脸的揭示留给下一镜"
       - "不拍全身，只拍手和道具——让观众聚焦于道具的意义"
       - "不交代环境，只拍两人面部——封闭空间感让对话压力更大"

ENCODING RULE: Encode your answers into the sceneDescription field as the FIRST LINE, before environment description:
【视觉核心：[Q1 answer] | 反差：[Q2 pair] | 排除：[Q3 decision]】

DERIVATION EXAMPLES (plot action → directorial concept):
  Plot: "丹眉发现符纸布袋后离开房间"
  ❌ Generic: 【视觉核心：丹眉离开 | 反差：无 | 排除：无】
  ✅ Director: 【视觉核心：布袋子作为被遗忘的秘密等待揭示 | 反差：人物离开→布袋子留下被镜头注视 | 排除：不跟丹眉出门，不拍门关上，镜头停留在布袋子上】

  Plot: "两人对话，李明告诉角色乙真相"
  ❌ Generic: 【视觉核心：对话场景 | 反差：说者vs听者 | 排除：无】
  ✅ Director: 【视觉核心：角色乙听到真相时手的反应比脸更诚实 | 反差：李明的台词（声音）vs 角色乙手指慢慢收紧（身体） | 排除：不拍角色乙的脸，只拍她的手——脸的表情可以控制，手不会说谎】

  Plot: "将军走向战场"
  ❌ Generic: 【视觉核心：将军前进 | 反差：无 | 排除：无】
  ✅ Director: 【视觉核心：脚步的节奏感建立角色意志 | 反差：沉重战靴踩过的是曾经的街道（地面材质变化）| 排除：不拍脸和上半身，只拍脚部侧拍跟随——全段不揭示表情，延迟情绪爆发】

❌ FORBIDDEN: sceneDescription that does NOT start with 【视觉核心 | 反差 | 排除】
❌ FORBIDDEN: 视觉核心 that is just a plot description ("李明走进房间" = plot, not visual concept)
❌ FORBIDDEN: 反差 that is empty or vague ("说者vs听者" without specifying WHAT is in tension)`;

const SHOT_SPLIT_VIDEO_SCRIPT_RULES = `═══════════════════════════════════════════════════
  motionScript — S-GRADE QUALITY REQUIREMENTS (per segment)
═══════════════════════════════════════════════════
These requirements apply to EVERY time-coded segment in motionScript, on top of the time-coded format rules. One action description per shot — motionScript is the single authoritative source.

━━━ DIALOGUE SEGMENT REQUIREMENTS (S-GRADE) ━━━
Every segment containing dialogue MUST include:
① WHERE the character is in frame: exact position (left/center/right), standing/seated/crouching, distance implied
② ONE specific physical micro-action BEFORE or DURING the dialogue: head tilt angle, hand movement direction, eye cast direction, jaw set, breath hold, shoulder tension — be anatomically precise
③ HOW the expression SHIFTS across the segment: not just "神情专注" but "眉头在最后一字落下时微微松开"
④ Camera movement with speed AND endpoint: "镜头从中景缓慢推至颈部以上近景" not just "推镜"

BAD (template, will fail): "0-4s: 角色甲面部表情随台词情绪流动，神情专注，特写推镜。"
BAD (no physical specificity): "0-4s: 角色乙看着角色甲，眼神复杂。"
GOOD (S-grade dialogue):
"0-4s: 角色甲站于篝火左侧，低头注视角色乙手心里攥紧的信纸——沉默两秒后缓缓抬眼，下颌微微收紧，说话时声线平稳却带着一丝沙哑；镜头从胸口中景缓慢推至下颌以上近景，背景篝火在焦外跳动。"

━━━ ACTION SEGMENT REQUIREMENTS (S-GRADE) ━━━
Every segment containing combat or physical action MUST include:
① Weapon/technique visual signature: blade color, energy trail color and shape, particle type and direction
② Body momentum: which foot plants, which direction body leans, follow-through arc
③ Impact/result in one sharp visual: specific spark color, shockwave ripple radius, debris trajectory
④ Camera response to action: does it shake, snap-zoom, whip-pan, or hold deliberately still?

BAD (generic): "0-3s: 角色丙挥刀攻击魔族。"
GOOD (S-grade action):
"0-3s: 角色丙从护盾右侧掠出——右脚踏石地同时横臂劈出铭刃，银白刀气斜斩对方重甲，钢铁接触瞬间炸出白色霜花和蓝光碎星；镜头贴地低角度快速推进，随刀气落点骤然仰拍至全景。"

━━━ ESTABLISHING / ATMOSPHERE SEGMENT REQUIREMENTS ━━━
For wide shots and atmosphere-only segments:
① Describe the MOVEMENT within the environment (foliage, water, smoke, crowds)
② Specify lighting direction and quality (where shadows fall, color temperature)
③ Camera movement must create a sense of SCALE or REVEAL

❌ ABSOLUTELY FORBIDDEN IN EVERY motionScript SEGMENT:
- "说话人面部表情随台词情绪流动，神情专注"
- "中景跟拍：捕捉[XX]动作过程"
- Segment under 25 Chinese characters
- Segment that is ONLY camera description with no character motion
- BGM / music descriptions (e.g. "配乐响起", "悲壮BGM", "弦乐渐强") — audio is post-production only
- "角色情绪丰富" / "神情坚定" / "眼神复杂" — content-free phrases

❌ NARRATIVE EMPTINESS — each shot must earn its place:
- Do NOT generate filler shots: "角色走向房间" with no emotional or story significance
- Every shot must advance EITHER: plot, character relationship, emotional state, or world-building
- A shot with dialogue MUST show the LISTENER's micro-reaction, not just the speaker's face

═══════════════════════════════════════════════════
  sceneDescription — Environment Context (镜头情节卡，非静帧)
═══════════════════════════════════════════════════
- Setting, architecture, props, weather, time of day
- Lighting setup (key/fill/rim, direction, quality, color temperature)
- Color palette and atmospheric mood
- May summarize what happens in the shot (plot beat) for human editors
- Do NOT include character poses suitable for image generation — those belong ONLY in startFrame/endFrame
- Do NOT duplicate startFrame/endFrame wording; if the beat is "invasion begins", startFrame must still be the calm BEFORE invasion`;

const SHOT_SPLIT_START_END_FRAME_RULES = `═══════════════════════════════════════════════════
  startFrame & endFrame — Image Generation Anchors
═══════════════════════════════════════════════════
Each must be a SELF-SUFFICIENT image generation prompt containing ALL FIVE elements below:

- CAMERA SPATIAL COORDINATE (机位空间坐标) — FIRST ELEMENT, MANDATORY:
  Physical camera position relative to the subject. Format: "摄影机在[主体][方位][距离]，镜头高度[body part]"
  Examples:
    "摄影机在角色正前方约2米，镜头高度胸口平视" (frontal mid-shot)
    "摄影机在角色左侧约1米，镜头高度腰部略低仰拍" (low lateral)
    "摄影机正上方90度垂直俯拍" (god's eye overhead)
    "摄影机贴近桌面边缘，从桌面高度向上略微仰拍" (table-level low)
  ❌ NEVER write only 景别 words like "近景" without specifying WHERE the camera physically is.

- SHOT TYPE + FRAMING SCOPE (景别 + 取景范围):
  景别: 远景/全景/中景/近景/特写/极特写 | 美术: 头像/胸像/半身像/全身像
  Framing scope: explicitly state what is visible in frame (e.g. "取景胸口以上", "囊括两人及地面", "画面里只看到角色下半身腰部以下")
  Camera angle: 高机位俯视 / 低机位仰视 / 平机位 / 正扣 / 蝼蚁视角 / 过肩视角 / POV
  Subject angle: 正面 / 正侧 / 四分之三侧 / 背面

- COMPOSITION & CHARACTERS: character positions (left/center/right, rule-of-thirds), foreground/background layers, depth-of-field. Reference by exact name, CURRENT pose only — no motion verbs.

- LIGHTING: direction + color temperature — specific to this frame (e.g. "右侧月光冷调侧逆光"). MUST be a complete sentence describing how light falls on subject and scene. NEVER just a short tag like "冷调月光".

- EMOTIONAL STATE: anatomy-based body/face description ONLY — e.g. "下颌角收紧" / "眉心细纹" / "喉结轻动". ⚠️ NEVER use emotion adjectives (神情坚定/眼神复杂/情绪丰富) — these are banned.

SELF-SUFFICIENT RULE: startFrame is the ONLY description sent to the image model. It must contain all five elements above.
Do NOT include dialogue text in startFrame or endFrame.

startFrame = INITIAL STATE before action begins (starting poses, opening expressions, camera at start position)
endFrame = END STATE after action completes — must be visually stable (not mid-motion), creates natural visual bridge to the next shot

TRIGGER-REACTION RULE: If the shot's action is set off by an off-screen/environmental trigger (a sound, a shout, a light change), startFrame MUST be locked to the character's reaction-onset pose (turning head, pausing mid-step, ears perking) — NOT a pose from mid-way through the action that follows (e.g. NOT "stride already extended" / "both feet off the ground" / "arm already swinging"). The corresponding motionScript's first segment must likewise be a brief, standalone reaction beat before the main action — see the TRIGGER-REACTION RULE in the motionScript section below.
  ❌ BAD startFrame for "hears an off-screen sound, then sprints toward it": "3/4 side profile, torso leaning forward mid-stride, both feet suspended above the ground" — this is a mid-run pose, not the pose at the moment the sound is first heard.
  ✅ GOOD startFrame for the same shot: "character standing still, head half-turned toward the sound source, both feet planted together, weight not yet shifted"

═══════════════════════════════════════════════════
  Scene Transition Rules — FORWARD GENERATION
═══════════════════════════════════════════════════
Handle transitions WHILE writing each shot. For every shot, silently answer:
  Q1: What is the PREVIOUS shot type? → determines startFrame
  Q2: What is the NEXT shot type? → determines endFrame

STARTFRAME rules (Q1):
▸ Previous = CROWD/WIDE, This = CHARACTER:
  Character already established in sub-location BEFORE the wide shot ends.
  BAD: "角色甲回头笑着" (mid-action, no environment context)
  GOOD: "角色甲站于掩体前，侧身对着镜头，右手尚未伸出，背景是模糊的环境光与建筑轮廓"

▸ Previous = SAME CHARACTERS, SAME LOCATION:
  Match previous shot's lighting direction, costume, background elements exactly.

▸ Previous = CHARACTER, This = NEW LOCATION:
  Environment shown first (empty or ambient), THEN character enters from frame edge.

ENDFRAME rules (Q2):
▸ This = CROWD/WIDE, Next = CHARACTER:
  Camera has ALREADY MOVED toward the sub-location where next shot's characters are.
  BAD: "俯拍全景，村民在篝火旁跳舞" (no spatial lead-in to next shot)
  GOOD: "镜头从俯拍全景缓推至集会空地外侧，掩体区居中，两道模糊身影隐于其后"

▸ This = CHARACTER, Next = CROWD/WIDE:
  Character's gaze or body language faces the direction of the crowd / wider world.

▸ This = CHARACTER, Next = NEW CHARACTER:
  Outgoing character looks off-screen toward where next character will appear.

▸ This = CHARACTER, Next = SAME CHARACTERS, SAME LOCATION:
  End on a natural pause or held gesture. NOT at peak motion.

PHYSICAL REALITY CHECK (every frame):
  - Objects under gravity (lanterns, flags, cloth) hang STRAIGHT DOWN — never "extend toward" or "point at" things
  - Camera angle in description MUST match the shot's cameraDirection field
  - No invented props or spatial relationships absent from the scene description
  - Every frame description = a FROZEN STILL IMAGE — no motion verbs

═══════════════════════════════════════════════════
  入画/出画铁律 — Character Entry/Exit Rules
═══════════════════════════════════════════════════
These rules apply to ALL secondary characters (non-main characters, crowd members, passersby) in motionScript.

入画铁律 (CHARACTER ENTRY):
  ✅ ALWAYS: Characters enter from the EDGE of the frame (bottom edge / left edge / right edge / corner)
  ✅ They appear as if they have been walking and are just NOW crossing into the camera's view
  ❌ NEVER: Characters materialize from the center of the frame or "appear" from the background depth
  ❌ NEVER: Characters "walk in from far away" — they enter already close, from the frame boundary

出画铁律 (CHARACTER EXIT):
  ✅ ALWAYS: Characters exit by walking OUT through a frame edge (left / right / bottom / corner)
  ❌ NEVER: Characters "disappear", "fade out", or "walk into the distance and shrink" inside the frame
  ❌ NEVER: Characters stop in the middle of the frame and are not shown leaving

OBSTRUCTION TRANSITION TECHNIQUE (变装/状态切换):
  When a character needs to change state (costume, expression, position) mid-shot without a cut:
  - Have a physical object briefly obscure the entire subject: a passing person, flying paper, cloth, door swing
  - The object must FULLY block the subject for 0.3–0.5 seconds
  - After obstruction clears: character's new state is revealed naturally
  Example: "第6秒：一张报纸从画面上方被风吹来快速飘到镜头正前方完全遮挡画面0.5秒，报纸被风吹走后角色已换装。"

═══════════════════════════════════════════════════
  AI Image Generation Constraint — Characters MUST Appear in startFrame
═══════════════════════════════════════════════════
The startFrame is sent to an AI image model as the FIRST FRAME anchor for video generation. The image model uses character reference photos to draw the character. If the character is absent from startFrame, there is NO way to anchor their appearance in the video.

RULE: If a named character appears in this shot, they MUST be visible in startFrame.

WHEN TO SPLIT A SHOT:
If the screenplay has a character entering the scene mid-shot (e.g., "Character A is waiting. Character B walks in."), you MUST split it into TWO shots:
  Shot A: Character A alone — startFrame shows only Character A
  Shot B: Character B enters — startFrame shows Character B's first moment of entry
DO NOT write a shot where startFrame is empty/environment-only but a named character appears later in motionScript.

EXCEPTIONS (no split needed):
  ① The shot is a pure environment/crowd/establishing shot with NO named characters at all
  ② The character's BACK or SILHOUETTE is in startFrame (still counts as present)
  ③ The character appears only as a voice (OS/VO type dialogue) — they do not need to be in frame`;

const SHOT_SPLIT_MOTION_SCRIPT_RULES = `═══════════════════════════════════════════════════
  motionScript — Time-Segmented Narrative
═══════════════════════════════════════════════════
FORMAT: "0-2s: [action]. 2-4s: [action]. 4-6s: [action]. ..."
STRICT RULE: each segment spans AT MOST 3 seconds. A 10s shot = at least 4 segments.

TRIGGER-REACTION RULE: If the action is set off by an off-screen/environmental trigger (a sound, a shout, a light change) that leads into a full-force action (sprinting, turning to fight, lunging), the FIRST segment must be a short, standalone reaction beat (turning head, pausing mid-step, ears perking — 1-2s is fine) — do NOT compress the trigger and the already-unfolding action into the same segment. This keeps the "hears X, THEN reacts" causality visible on screen instead of starting the clip already mid-action.
  BAD: "0-4s: An off-screen sound rings out, [character] sprints toward it, cloak whipping through the air, light flickers across his body." (trigger and full sprint compressed into one beat, no reaction buffer)
  GOOD: "0-1s: An off-screen sound rings out → [character]'s stride catches, he turns his ear toward it. 1-4s: he pivots and sprints toward it, cloak whipping through the air."

CAMERA MOVEMENT FORMULA (per segment): 起幅构图描述 + 运镜动作 + 运镜幅度 + 落幅构图描述
运镜动词: 推/拉/摇/移/跟/升/降/甩/环绕/旋转/变焦
复合运镜: 希区柯克镜头 = 推拉 + 变焦（主体不变，背景压缩/拉伸）; 子弹时间 = 升格 + 快速环绕

Each segment is ONE densely-packed sentence (50-80 words) weaving ALL four layers simultaneously:
• CHARACTER: exact body parts in motion — knuckles whiten, tendons flare, pupils contract, breath held, teeth clench; specify speed and force
• ENVIRONMENT: the world reacts — ground fissures, sparks shower, black smoke billows, debris trajectories
• CAMERA: precise shot type + movement + speed
• PHYSICS/ATMOSPHERE: material details — crack of metal, shockwave ripple, heat distortion, light temperature shift

BAD (too vague): "0-6s: The beast swings its claw and destroys the street. Camera moves in."
GOOD (specific, max 3s each):
"0-2s: 铁兽右前爪以骨震地面的轰鸣砸落，六条裂缝从接触点向外蛛网扩散三米，三组机械爪同时高举拖出液压雾气，传感器眼深红脉冲；镜头低角广角缓慢仰拍。
2-4s: 首爪以次音速横扫，剪断路灯中轴爆出蓝白火星，断裂顶端旋转飞出呈45度，沥青块与金属碎片向下散射；镜头持中景后骤然快速推进。
4-6s: 管道破裂的黑烟在热浪上翻滚折叠，碎片仍在坠落，传感器以高亢液压鸣声锁定下一目标；镜头低角缓慢向右环绕，停于铁兽剪影构图。"

━━━ 台词内嵌规范（有台词的镜头 MANDATORY） ━━━
当镜头含有台词时，每条台词必须嵌入 motionScript 中角色实际开口的时间段，格式如下：

对白（type=dialogue）：
[角色名（视觉描述）说：「台词文字」（嘴型口型同步）]

画外音/内心OS（type=vo 或 os）：
[角色名 画外音VO：「台词文字」（画外音，角色嘴型静止）]

规则：
- 台词 [] 放在角色实际说话那一段，不得挪到段末或单独附在最后
- 若角色先有动作再开口，先写动作 []，同一时间段内再写台词 []
- ｜朝向：标注仍须写在整条 motionScript 的行末

GOOD（有台词的镜头示例）：
"0-3s: [铁狼迈步上前→俯身蹲下] [铁狼（疤痕侧脸）说：「孩子，跟我走。」（嘴型口型同步）] 3-6s: [孩子抬头→愣住，手指收紧衣角] ｜朝向：铁狼3/4侧面朝左"

BAD（台词未嵌入 motionScript，视频模型不知道角色在说话）：
"0-3s: 铁狼走向孩子蹲下。3-6s: 孩子抬头愣住。｜朝向：铁狼3/4侧面朝左"
← 错误：台词消失于视频提示词，视频模型不知道角色在说话`;

const SHOT_SPLIT_PROPORTIONAL_TIERS_TEMPLATE = `═══════════════════════════════════════════════════
  Proportional Difference Rule
═══════════════════════════════════════════════════
{{PROPORTIONAL_TIERS}}`;

const SHOT_SPLIT_CAMERA_DIRECTIONS = `═══════════════════════════════════════════════════
  cameraDirection — Technical Camera Instruction (NARRATIVE PURPOSE REQUIRED)
═══════════════════════════════════════════════════
FORMAT: "起幅[景别/机位] → 运动方式+速度 → 落幅[景别/机位]，目的：[叙事目的]"

NARRATIVE PURPOSE is MANDATORY — every cameraDirection must end with "，目的：[what this movement reveals/follows/emphasizes]"

Examples of correctly formatted cameraDirection values:
- "中景固定 locked-off → 不动 → 中景固定，目的：让角色微表情主导节奏"
- "特写 → 缓慢dolly out拉远 → 全景，目的：揭示角色孤立于空旷环境中"
- "全景 → 缓慢dolly in推近 → 近景，目的：强调角色眼神从迷茫到清醒的变化"
- "中景平视 → 侧面tracking shot跟随 → 中景平视，目的：跟随角色穿越空间展示环境纵深"
- "正面近景 → counter-clockwise orbit 180度 → 背面中景，目的：环绕揭示角色身后的对手"
- "贴地低角 → 缓慢tilt up上摇 → 中景仰拍，目的：从脚部揭示到脸部，强调人物高大感"
- "中景 handheld 手持抖动，目的：制造紧张的临场感"

❌ FORBIDDEN: cameraDirection without narrative purpose ("缓慢推近" alone is REJECTED)
❌ FORBIDDEN: narrative purpose that is pure camera description ("目的：从中景推到近景" — that's just repeating the movement)
✅ REQUIRED: narrative purpose must describe story/emotional effect ("揭示X" / "强调X" / "跟随X" / "制造X感")

▸ 运镜词库（可用于构建上述格式）:
固定/locked-off | 推/dolly in | 拉/dolly out | 摇左/pan left | 摇右/pan right
摇上/tilt up | 摇下/tilt down | 移左/移右/lateral tracking | 跟/tracking shot
升/crane up | 降/crane down | 甩/whip pan | 环绕/orbit | 变焦推/slow zoom in
handheld | 希区柯克 = 推+变焦拉 | orbit + crane up

▸ 机位高度修饰词: 高机位 | 低机位/low angle | 蝼蚁视角 | 俯拍/bird's eye | 仰拍
▸ 叙事视角修饰词: 过肩 | 主观视角/POV | 偷窥视角 | 望远镜视角
- "低机位 + 推" / "low angle push in"
- "高机位 + 摇下" / "high angle tilt down"
- "跟 + 摇" — follow then pivot`;

const SHOT_SPLIT_CINEMATOGRAPHY_PRINCIPLES_TEMPLATE = `═══════════════════════════════════════════════════
  Cinematography Principles
═══════════════════════════════════════════════════
- VARY shot types — alternate wide/medium/close; never two identical framings in a row
- ESTABLISHING SHOTS at the start of new locations
- REACTION SHOTS after important dialogue: cut to the listener's face, not just the speaker
- CUT ON ACTION — end each shot at a moment that allows smooth transition to the next
- 180-DEGREE RULE — maintain consistent screen direction between shots. If Shot A shows character moving/looking RIGHT, Shot B must not show the same subject moving/looking RIGHT from another angle — it violates spatial continuity.
- EYELINE MATCH — if Shot A ends on a character's face looking TOWARD camera, Shot B MUST be one of: (a) what they are looking at (their POV), or (b) a reverse angle — camera behind them showing their backs and the subject ahead. NEVER cut to another shot that shows the characters from the same side/angle.
  ❌ WRONG: Shot A = two faces looking at camera → Shot B = same two faces from a different angle still facing camera
  ✅ CORRECT: Shot A = two faces looking toward camera (hiding, watching) → Shot B = behind them, their backs, soldiers approaching from ahead
- NO RACK FOCUS: AI video models CANNOT execute rack focus (in-shot bokeh pull from foreground to background). NEVER design a shot that relies on focus-pulling as its primary motion. Instead, design TWO shots:
  Shot A: close-up foreground subject (faces through grass, soldiers blurred behind)
  Shot B: reverse angle — camera behind foreground subjects, background subject now sharp ahead
- Duration targets: establishing shots {{MIN_DURATION}}-{{ESTABLISHING_MAX}}s; dialogue {{DIALOGUE_MAX}}-{{MAX_DURATION}}s; action {{MIN_DURATION}}-{{ACTION_MAX}}s
- CONTINUITY: endFrame of shot N must logically connect to startFrame of shot N+1

⚠️ HARD DURATION RULE — NON-NEGOTIABLE:
Every single shot duration MUST be between {{MIN_DURATION}} and {{MAX_DURATION}} seconds.
NEVER output a duration outside this range. There are NO exceptions.
- A long battle? Split it into multiple {{MIN_DURATION}}-{{MAX_DURATION}}s shots.
- A long dialogue scene? Split into multiple shots with reaction cuts.
- COUNT your duration value before writing it. If it exceeds {{MAX_DURATION}}, you MUST split.
Outputting duration={{MAX_DURATION_PLUS_ONE}} or higher is a CRITICAL ERROR.

COVERAGE: Generate AT LEAST one shot per SCENE in the screenplay. Do NOT skip or merge scenes.
When a DURATION BUDGET is provided in the user prompt, follow those expansion rules — each scene requires MULTIPLE shots. One shot per scene is the bare minimum only when there is no duration target.`;

const SHOT_SPLIT_VISUAL_CONTINUITY = `═══════════════════════════════════════════════════
  视觉连续性铁律（全程强制，违反 = 分镜失败）
═══════════════════════════════════════════════════

以下 7 条铁律在生成每一条分镜时必须全程遵守，任何违反都会导致最终视频出现割裂感、穿帮或视觉疲劳。

① 动作连续性
相邻镜头间角色的位置、动作进度、朝向必须物理逻辑一致。
- 上一镜手伸到半空 → 下一镜必须从半空状态接续，不能突然收回
- motionScript 开头必须写"(承接上镜: [衔接动作说明])"，首镜写"(开篇)"
- 例：(承接上镜: 手臂半抬状态→继续上扬握拳)

② 景别递进法则
景别切换遵循渐进聚焦或渐进释放——禁止无叙事理由的跳变
- 渐进聚焦：远景→全景→中景→近景→特写（情绪收紧）
- 渐进释放：特写→近景→中景→远景（情绪释放）
- ❌ 禁止连续 3 镜以上同景别（= 视觉疲劳）
- ❌ 禁止：对话近景 → 直接跳切到大远景（没有叙事理由时）

③ 视轴守恒（180°线原则）
对话/对峙场景中，角色在画面内的左右位置全片固定，不得跳轴。
- 对话场景：角色A 在画面左侧全程不变；角色B 在画面右侧全程不变
- 切轴需要明确的"越轴镜头"过渡（如正面拍、或插入主观视角）

④ 朝向空间逻辑
- 对话双方面朝彼此：左侧角色面朝右，右侧角色面朝左
- 操作物品的角色面朝物品；注视远方的角色面朝远方
- motionScript 末尾必须有 ｜朝向：标注（有命名角色时必填）
- ❌ 禁止无差别让所有角色正面朝镜头

⑤ 信息控制意识
每镜须意识到"观众此刻知道什么、不知道什么"——
- 给手不给脸 = 悬念；先声后画 = 期待；只给背影 = 疏离；全貌揭示 = 高潮兑现
- 不要在同一组场景里重复揭示观众已知信息

⑥ 节拍密度约束
单镜头动作/事件数量须与时长匹配，防止塞入过多内容——
- 1 个物理动作 = 1 拍；1 次运镜 = 1 拍；1 句短台词（≤10 字）= 1 拍
- 2~3s 镜头：最多 1 拍
- 4~6s 镜头：最多 2 拍
- 7s+ 镜头：最多 3 拍
- ❌ 违反此规则会导致视频里角色动作看起来像在走马灯

⑦ 头尾安全区（每镜前后 0.5s）
- 前 0.5s：用于环境建立或主体静态亮相，不放关键动作或台词起始
- 后 0.5s：用于动作自然收住，不放关键台词结尾
- 作用：给 AI 视频模型留出过渡空间，避免首尾帧撞入运动中的帧

━━━ 黄金 6 秒规则 ━━━
无台词镜头累计超过 6s 未出现新信息（台词/动作/主体变化）= 观众注意力断裂
- 定场+过渡类镜头尤其注意，宁可合并压缩也不要拖沓
- 一镜到底可突破（≤12s），但须在 cameraDirection 标注"一镜到底"且信息量持续更新

━━━ 定场与镜头合并规则 ━━━
每个新场景/段落的定场最多 1~2 个镜头完成：
- ✅ 推荐：1 个带缓推的远景（定场+主体引入一镜完成）
- ❌ 禁止：先拍环境空镜→再拍局部细节→再拍人物到达的冗余三段式
- 导演思维自检：如果一个真人导演会把相邻 2~3 个镜头合成 1 个拍，就应该合并

━━━ 环境动态要求 ━━━
每 3~4 个镜头至少安排 1 个有环境动态的镜头（防止画面"死掉"）：
- 优先：窗帘轻摆、咖啡热气蒸腾、雨滴滑过玻璃、车流光影、树叶飘落
- 在 motionScript 中描述这些环境动态`;

const SHOT_SPLIT_DIALOGUE_DURATION = `═══════════════════════════════════════════════════
  含台词镜头时长计算（MANDATORY — 必须精确计算）
═══════════════════════════════════════════════════

有台词的镜头，duration 必须足够念完全部台词。禁止直觉估算——必须按以下公式计算：

【语速参考】
- 愤怒/急促/争吵：约 4 字/秒（怒斥、催促、惊慌）
- 正常对话/叙述：约 3 字/秒（日常交谈、冷静陈述）
- 悲伤/深情/沉思：约 2 字/秒（告白、哀悼、回忆）
- 低语/虚弱/临终：约 2 字/秒（气若游丝、耳边呢喃）

【计算步骤】
1. 基础秒数 = 台词总字数 ÷ 对应语速（向上取整）
2. 停顿余量：每个标点（逗号/句号/省略号/破折号）+0.3~0.5s
3. 情绪转折处（语气变化明显）+0.5s
4. 最终 duration = 基础秒数 + 停顿累计 + 1s 安全余量（向上取整）

【示例】
台词"我……我知道了。放心，这次不会再出错。"（悲伤语气，15字）
- 基础：15 ÷ 2 = 7.5s → 8s
- 停顿："……" +0.5s，"。" +0.3s，"，" +0.3s = +1.1s
- 安全余量：+1s
- 最终 duration = 8 + 1.1 + 1 = 10.1s → 取整 11s

❌ 禁止把有长台词的镜头 duration 设为 3~5s（台词根本念不完）
❌ 一句台词对应一个镜头，禁止在单镜头内塞多角色多轮对白`;

const SHOT_SPLIT_LANGUAGE_RULES = `CRITICAL LANGUAGE RULE: ALL text fields (sceneDescription, startFrame, endFrame, motionScript) MUST be in the SAME LANGUAGE as the screenplay. Chinese screenplay → ALL fields in Chinese. ONLY "cameraDirection" uses English.

OUTPUT FORMAT: If a DURATION BUDGET planning step is requested in the user prompt, output the <!-- PLAN: ... --> comment on its own line FIRST, then output the JSON array with no other text. If no planning step is requested, output ONLY the JSON array. No markdown fences. No other commentary.`;

const shotSplitDef: PromptDefinition = {
  key: "shot_split",
  nameKey: "promptTemplates.prompts.shotSplit",
  descriptionKey: "promptTemplates.prompts.shotSplitDesc",
  category: "shot",
  slots: [
    slot("role_definition", SHOT_SPLIT_ROLE_DEFINITION, true),
    slot("director_concept", SHOT_SPLIT_DIRECTOR_CONCEPT_RULES, true),
    slot("output_format", SHOT_SPLIT_OUTPUT_FORMAT_TEMPLATE, false),
    slot("video_script_rules", SHOT_SPLIT_VIDEO_SCRIPT_RULES, true),
    slot("start_end_frame_rules", SHOT_SPLIT_START_END_FRAME_RULES, true),
    slot("motion_script_rules", SHOT_SPLIT_MOTION_SCRIPT_RULES, true),
    slot("visual_continuity", SHOT_SPLIT_VISUAL_CONTINUITY, true),
    slot("dialogue_duration", SHOT_SPLIT_DIALOGUE_DURATION, true),
    slot("proportional_tiers", SHOT_SPLIT_PROPORTIONAL_TIERS_TEMPLATE, true),
    slot("camera_directions", SHOT_SPLIT_CAMERA_DIRECTIONS, true),
    slot("cinematography_principles", SHOT_SPLIT_CINEMATOGRAPHY_PRINCIPLES_TEMPLATE, true),
    slot("language_rules", SHOT_SPLIT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);

    const maxDuration = (params?.maxDuration as number) ?? 15;
    const minDuration = Math.min(8, maxDuration);

    // Build proportional tiers dynamically (English, matching S-grade tone)
    let proportionalTiers: string;
    if (maxDuration <= 8) {
      proportionalTiers = `- ${minDuration}-${maxDuration}s shot: keep changes proportional to duration`;
    } else {
      const tier1End = Math.round(maxDuration * 0.6);
      const tier2End = Math.round(maxDuration * 0.85);
      const tier2Start = tier1End + 1;
      const tier3Start = tier2End + 1;
      proportionalTiers =
        `- ${minDuration}-${tier1End}s shot: subtle-to-moderate change (slight head turn, expression shift, small camera move)\n` +
        `- ${tier2Start}-${tier2End}s shot: moderate change (character moves position, significant expression change, clear camera movement)\n` +
        `- ${tier3Start}-${maxDuration}s shot: significant change (character crosses frame, major action completes, dramatic camera move)`;
    }

    // Single replacer applied to every slot — handles all dynamic placeholders
    const replaceDynamic = (text: string) => text
      .replace(/\{\{MIN_DURATION\}\}-\{\{MAX_DURATION\}\}/g, `${minDuration}-${maxDuration}`)
      .replace(/\{\{MIN_DURATION\}\}/g, String(minDuration))
      .replace(/\{\{MAX_DURATION_PLUS_ONE\}\}/g, String(maxDuration + 1))
      .replace(/\{\{MAX_DURATION\}\}/g, String(maxDuration))
      .replace(/\{\{DIALOGUE_MAX\}\}/g, String(Math.min(maxDuration, 12)))
      .replace(/\{\{ACTION_MAX\}\}/g, String(Math.min(maxDuration, 12)))
      .replace(/\{\{ESTABLISHING_MAX\}\}/g, String(Math.min(maxDuration, 12)))
      .replace(/\{\{PROPORTIONAL_TIERS\}\}/g, proportionalTiers);

    return [
      replaceDynamic(r("role_definition")),
      "",
      r("director_concept"),
      "",
      replaceDynamic(r("output_format")),
      "",
      r("video_script_rules"),
      "",
      r("start_end_frame_rules"),
      "",
      r("motion_script_rules"),
      "",
      r("visual_continuity"),
      "",
      r("dialogue_duration"),
      "",
      replaceDynamic(r("proportional_tiers")),
      "",
      r("camera_directions"),
      "",
      replaceDynamic(r("cinematography_principles")),
      "",
      r("language_rules"),
    ].join("\n");
  },
};

// ─── 8. split_shot_single ───────────────────────────────
// 将单个分镜拆成两个：用于"角色中途入镜"等首帧锚点问题。

export const SPLIT_SHOT_SINGLE_SYSTEM = `你是一位资深商业动画导演，正在将一个分镜拆分为两个连续分镜。

拆分原则：
1. 拆分点通常是角色进入画面、场景重大变化、或叙事转折的时刻
2. 分镜A = 拆分点之前（首帧不含即将入镜的角色）
3. 分镜B = 拆分点之后（首帧含新入镜的角色或新状态）
4. 两个分镜的总时长 = 原始时长（秒数分配应符合各自内容节奏）
5. 分镜A的尾帧 → 暗示分镜B的到来（视线/运镜引导）
6. 分镜B的首帧 → 与分镜A的尾帧在空间上连贯

输出格式：严格输出 JSON 数组（2个对象），字段与 shot_split 一致：
[
  {
    "sequence_offset": 0,
    "sceneDescription": "...",
    "startFrame": "...",
    "endFrame": "...",
    "motionScript": "...",
    "duration": N,
    "soundEffect": "...",
    "cameraDirection": "..."
  },
  {
    "sequence_offset": 1,
    ...
  }
]

约束：
- sceneDescription【严格截取】：必须从原始分镜的场景描述中截取，只保留该子镜头对应的部分；禁止添加原文中不存在的情节、角色行为或环境描述；若原文较短，可适当精简但不得改变语义
- startFrame 是静止画面（无运动词）
- motionScript 格式：0-Xs: [...]. Xs-Ys: [...]. ｜朝向：...
- motionScript 总时长精确等于该分镜 duration
- 有具名角色的分镜：该角色必须出现在 startFrame 中
- 台词【必须保留所有原始台词，禁止丢弃】：将原始 motionScript 中的台词 bracket 按叙事节奏分配到两个子分镜的 motionScript 中；每条台词放入叙事上最合适发生的那个分镜
- 仅输出 JSON 数组，无任何其他文字`;

// ─── 9. frame_generate_first ────────────────────────────

const FIRST_FRAME_STYLE_MATCHING = `=== 关键：画风匹配（最高优先级）===
仔细阅读下方的角色描述和场景描述。它们指定或暗示了画风。
你必须精确匹配该画风。不要默认使用写实风格。
- 如果描述中提到 动漫/漫画/anime/manga/卡通/cartoon → 生成日本2D动漫风格插画（清晰线稿、赛璐珞光影、鲜艳配色）
- 如果描述中提到 写实/真人/photorealistic → 生成电影级写实照片
- 如果附有参考图，参考图的视觉风格就是最高真理——精确匹配，包括线稿粗细、光影风格、色彩饱和度
- 输出的画风必须与角色设定图一致，品质须达到 masterpiece 级别`;

const FIRST_FRAME_REFERENCE_RULES = `=== 参考图（角色设定图）===
每张附带的参考图是一张角色设定图，展示4个视角（正面、四分之三侧面、侧面、背面）。
角色的名字印在每张设定图底部——用它来识别对应的角色。
强制一致性规则：
- 将设定图中的角色名与场景描述中的角色名对应
- 服装必须与参考图完全一致——相同的衣物类型、颜色、材质、配饰。不要替换（如不要把青色常服换成龙袍）
- 面孔、发型、发色、体型、肤色必须精确匹配
- 参考图中展示的所有配饰（帽子、佩刀、发簪、首饰）必须出现
- 画风必须与参考图精确匹配`;

const FIRST_FRAME_RENDERING_QUALITY = `=== 渲染标准（电影级品质 · 有具名角色镜头）===
画质：与项目画风一致的高清电影级静帧；高清晰度，细节丰富，无噪点、无模糊
材质与质感：忠实还原当前画风的材质表现——写实风注重皮肤/布料/反光细节，2D动漫风注重线稿与色彩纯度，3D风注重体积感与次表面散射
光影：电影级三点布光——主光（方向+色温明确）、补光（提亮暗部细节）、轮廓光（分离角色与背景）；光影投射与场景环境逻辑一致，有明确的光源动机
背景：【强制必须】渲染完整精细的背景环境——严禁白色/灰色/纯色背景；背景至少占画面30%面积，展现场景纵深、建筑/自然环境细节与大气透视；环境须与「首帧静止画面」描述一致，而非镜头进行中的动态情节
角色：精确匹配参考图外貌与画风；表情生动传达情绪（眉眼嘴角均有具体变化）；姿态富有重量感与力学合理性；服装/皮肤细节准确，褶皱符合受力方向
构图：电影级取景——三分法或黄金比例；前中后层次清晰，有视觉引导线；具名主角占画面40-70%，背景环境可见，画面有空间纵深感
画质词：masterpiece, best quality, highly detailed, sharp focus, cinematic lighting, 8K resolution
禁止：无文字叠加、无水印、无UI元素、无字幕条、无白色或纯色背景`;

const FIRST_FRAME_RENDERING_QUALITY_ENVIRONMENT = `=== 渲染标准（环境/群演首帧 · 无具名主角）===
画质：与项目画风一致的高清电影级静帧；高清晰度，细节丰富，无噪点、无模糊
光影：以场景主光源为主（月光/篝火/天光等，方向与色温明确）；空镜与远景不加人物轮廓光，不强行三点布光
背景：【强制必须】环境/建筑/天空为画面主体，占画面70%以上；完整纵深与大气透视；严禁白色/灰色/纯色背景
角色：本镜无具名主角——禁止在前景绘制清晰可辨的主角正脸；若需人迹，仅为极远景模糊剪影，且须符合「首帧静止画面」描述
构图：远景/大全景优先；视觉主体是环境而非人物；参考图若含人物，不得覆盖「首帧静止画面」中的构图要求
画质词：masterpiece, best quality, highly detailed, sharp focus, cinematic lighting, 8K resolution
禁止：无文字叠加、无水印、无UI元素、无字幕条、无白色或纯色背景`;

const FIRST_FRAME_CONTINUITY_REFERENCE_RULES = `=== 参考图（镜间衔接帧 · 非角色设定图）===
附带的参考图来自其他镜头的首帧/尾帧/视频尾帧，用于色调、透视、画风延续。
- 可继承：大环境布局、主光源方向、画风、色温、镜头高度的大致透视
- 禁止盲目复制：参考图中的前景人物、混战、入侵、奔跑等「镜头进行中」的动态情节，若与「首帧静止画面」冲突则以静止画面描述为准
- 若首帧描述要求静谧/空镜/远景，应弱化或去除参考图中多余的前景角色
- 角色设定图规则不适用于此类参考图`;

const FIRST_FRAME_CONTINUITY_RULES = `=== 连续性要求 ===
此镜头紧接上一个镜头。附带的参考中包含上一个镜头的尾帧。保持视觉连续性：
- 相同的角色必须穿着一致的服装和比例
- 画风相同——不要在动漫和写实之间切换
- 环境光线和色温应平滑过渡
- 角色位置应从上一个镜头结束时的位置逻辑延续`;

const frameGenerateFirstDef: PromptDefinition = {
  key: "frame_generate_first",
  nameKey: "promptTemplates.prompts.frameGenerateFirst",
  descriptionKey: "promptTemplates.prompts.frameGenerateFirstDesc",
  category: "frame",
  slots: [
    slot("style_matching", FIRST_FRAME_STYLE_MATCHING, true),
    slot("reference_rules", FIRST_FRAME_REFERENCE_RULES, true),
    slot("rendering_quality", FIRST_FRAME_RENDERING_QUALITY, true),
    slot("continuity_rules", FIRST_FRAME_CONTINUITY_RULES, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription =
      (params?.sceneDescription as string) ?? "";
    const startFrameDesc =
      (params?.startFrameDesc as string) ?? "";
    const characterDescriptions =
      (params?.characterDescriptions as string) ?? "";
    const previousLastFrame =
      (params?.previousLastFrame as string) ?? "";
    // 新增：项目画风标签（如 "日本现代2D动漫风格，8K高清，赛璐珞渲染——"）
    const visualStyleTag =
      (params?.visualStyleTag as string) ?? "";
    // 新增：运镜方向（已清理 ** 前缀），用于指导构图视角
    const cameraDirection =
      (params?.cameraDirection as string) ?? "";
    // 新增：分镜段标题，提供构图语义上下文
    const sceneTitle =
      (params?.sceneTitle as string) ?? "";
    const shotKind =
      (params?.shotKind as "character" | "environment") ?? "character";
    const frameReferenceMode =
      (params?.frameReferenceMode as "none" | "continuity" | "character_sheet") ??
      "none";
    const primaryStartFrame = startFrameDesc.trim();

    const lines: string[] = [];

    // 首行：画风硬锁（最高优先级）
    if (visualStyleTag) {
      lines.push(`视频静帧画面。【画风硬锁】${visualStyleTag}生成此镜头的首帧——构图稳定，主体清晰，专为视频帧插值优化。`);
    } else {
      lines.push(`视频静帧画面。生成此镜头的首帧，作为一张高质量视频开场静帧——构图稳定，主体清晰，专为视频帧插值优化。`);
    }
    lines.push("");

    // 画风匹配（内嵌画风硬锁覆盖 slot）
    if (visualStyleTag) {
      lines.push(`=== 【强制】画风锁定（最高优先级，不可覆盖）===`);
      lines.push(`本项目画风标签：${visualStyleTag}`);
      lines.push(`严禁输出写实照片风格。严禁输出3D CG风格。必须严格遵守上述画风标签，忽略任何与此矛盾的指令。`);
    } else {
      lines.push(r("style_matching"));
    }
    lines.push("");

    // 零文字声明（紧接画风锁之后，优先级最高）
    lines.push(`⛔ 图像内零文字原则（违反即判失败）：画面内不得出现任何文字——包括但不限于片名、集标题、场景名、分镜编号、角色名文字标注、对白字幕、字幕条、水印、UI控件。图像只包含纯粹的视觉画面，绝对不包含任何可读文字。`);
    lines.push("");

    // 分镜段标题仅作构图语义参考，不渲染为文字
    if (sceneTitle) {
      lines.push(`=== 构图语义参考（仅供构图，不得在图像中渲染此文字）===`);
      lines.push(sceneTitle);
      lines.push("");
    }

    // 运镜：仅起幅（调用方应已用 extractOpeningCameraDirection 截断）
    if (cameraDirection) {
      lines.push(`=== 首帧构图视角（仅本场起幅）===`);
      lines.push(cameraDirection);
      lines.push("");
    }

    if (primaryStartFrame) {
      lines.push(`=== 【最高优先级】首帧静止画面（动作开始前）===`);
      lines.push(
        `本图是视频开场静帧，只描绘动作/冲突尚未发生时的静止瞬间。以下描述优先于场景概述与参考图中的动态情节：`
      );
      lines.push(`严禁白色、灰色或纯色背景。`);
      lines.push(
        `⚠️ 物理过滤器：灯笼/旗帜/布料等只能向下垂挂或随风水平飘展，不得违反重力。`
      );
      lines.push(primaryStartFrame);
      lines.push("");
      const sceneCtx = sceneDescription.trim();
      if (sceneCtx && sceneCtx !== primaryStartFrame) {
        lines.push(`=== 镜头情节上下文（仅供理解地点/场次，禁止画进首帧）===`);
        lines.push(sceneCtx);
        lines.push("");
      }
    } else {
      lines.push(`=== 【强制】背景场景（无独立首帧描述时的回退）===`);
      lines.push(`严禁白色、灰色或纯色背景。必须渲染以下场景环境：`);
      lines.push(sceneDescription || "宏大的奇幻场景，有建筑、自然景观或战场环境");
      lines.push(`背景需完整可见，占画面至少30%面积，展现真实的场景纵深与氛围。`);
      lines.push("");
      lines.push(`=== 帧描述（物理规律自动修正）===`);
      lines.push(
        `按以下描述渲染此帧静态画面。⚠️ 物理过滤器：灯笼/旗帜/布料等只能向下垂挂或随风水平飘展：`
      );
      lines.push(startFrameDesc || sceneDescription);
      lines.push("");
    }

    if (shotKind === "environment") {
      lines.push(`=== 角色（环境/群演镜头）===`);
      lines.push(
        `本镜无具名主角。勿在前景绘制清晰主角正脸；人迹仅为远景剪影或空置，须符合「首帧静止画面」。`
      );
    } else {
      lines.push(`=== 角色描述 ===`);
      lines.push(characterDescriptions || "（见角色设定图）");
    }
    lines.push("");

    if (frameReferenceMode === "continuity") {
      lines.push(FIRST_FRAME_CONTINUITY_REFERENCE_RULES);
      lines.push("");
    } else if (shotKind === "character") {
      lines.push(r("reference_rules"));
      lines.push("");
    }

    if (previousLastFrame) {
      lines.push(r("continuity_rules"));
      lines.push("");
    }

    lines.push(
      shotKind === "environment"
        ? FIRST_FRAME_RENDERING_QUALITY_ENVIRONMENT
        : r("rendering_quality")
    );
    return lines.join("\n");
  },
};

// ─── 9. frame_generate_last ─────────────────────────────

const LAST_FRAME_STYLE_MATCHING = `=== 关键：画风匹配（最高优先级）===
你必须精确匹配首帧图像（已附带）的画风。
如果首帧是动漫/漫画风格 → 此帧也必须是动漫/漫画风格。
如果首帧是写实风格 → 此帧也必须是写实风格。
不要改变或混合画风。这是不可协商的。`;

const LAST_FRAME_RELATIONSHIP_TO_FIRST = `=== 与首帧的关系（强制一致性要求）===
此尾帧展示镜头动作的结束状态。第一张附带图是本镜头的首帧，其余是角色设定图。优先级顺序如下：

【最高优先级】角色设定图（character sheets）：
- 在此帧中出现的所有角色，必须严格按照角色设定图的外貌生成——面孔、发色、发型、体型、服装、配饰全部以设定图为准。
- 体型比例：角色的身高、肩宽、四肢比例必须与设定图完全一致。不可将高挑角色画矮，不可改变体型。
- 服装：与设定图完全一致的服装（颜色、剪裁、材质、每件配饰）。严禁换装（如将常服换成盔甲、将便服换成礼服）。

【次优先级】首帧图像（用于环境与画风匹配）：
- 背景环境、布光方案、色彩基调、画风与首帧完全一致。
- 若首帧与角色设定图在角色外貌上有出入（例如首帧是群演场景），以角色设定图的外貌为准。
- 面孔、发型、配饰只有在与设定图一致的前提下才参考首帧；姿态/表情/位置则按帧描述中的说明发生变化。`;

const LAST_FRAME_NEXT_SHOT_READINESS = `=== 作为下一个镜头的起始点 ===
此帧将被复用为下一个镜头的首帧，同时也是本镜头视频插值的终点锚帧。确保：
- 姿态是稳定的——不处于运动中间，不模糊；角色须处于一个自然的"收束姿态"
- 构图完整，可作为独立画面成立；背景无残影、无运动拖尾
- 取景允许自然过渡到不同的镜头角度
- 若场景描述暗示角色将离场，尾帧可呈现「走出画面边缘」的过渡姿态
- 若场景描述是特写推进结束，尾帧构图应是推进后的稳定极近景，而非运动模糊帧`;

const LAST_FRAME_RENDERING_QUALITY = `=== 渲染标准（电影级品质 · 有具名角色镜头）===
画质：与首帧完全一致的电影级高清品质——画风、清晰度、色彩饱和度三者均须与首帧无差异
材质与质感：与首帧相同的材质表现风格；写实风保持相同的皮肤/布料细节层次，2D风保持相同的线稿质量与色彩纯度，3D风保持相同的体积感与光泽度
光影：与首帧完全相同的布光方案和色温；仅在动作驱动（如爆炸、闪光、转场）时允许光效变化，变化须合乎物理逻辑
背景：【强制必须】渲染与首帧一致的完整背景环境——严禁白色/灰色/纯色背景；环境须符合「尾帧静止画面」，而非镜头进行中的动态情节
角色身份与比例：【严格比对首帧和设定图】角色面孔必须是同一人物，体型/身高/肩宽/四肢比例必须与设定图和首帧完全一致。服装与设定图完全一致。
情感表现：展示镜头动作结束时的具体情感状态（表情变化）
构图：动作收束后的稳定构图；具名主角占画面40-70%，为下一镜提供自然衔接点
画质词：masterpiece, best quality, highly detailed, sharp focus, cinematic lighting, 8K resolution
禁止：无文字叠加、无水印、无UI元素、无字幕条、无白色或纯色背景`;

const LAST_FRAME_RENDERING_QUALITY_ENVIRONMENT = `=== 渲染标准（环境/群演尾帧 · 无具名主角）===
画质：与首帧一致的电影级高清静帧
光影：与首帧相同的主光源与色温；空镜不加人物轮廓光
背景：与首帧同场景、同纵深；环境为主体，占画面70%以上
角色：无具名主角——禁止前景清晰正脸；人迹仅为远景剪影或空置，须符合「尾帧静止画面」
构图：远景/大全景收束；视觉主体是环境；姿态稳定、无运动模糊
画质词：masterpiece, best quality, highly detailed, sharp focus, cinematic lighting, 8K resolution
禁止：无文字叠加、无水印、无UI元素、无字幕条、无白色或纯色背景`;

const frameGenerateLastDef: PromptDefinition = {
  key: "frame_generate_last",
  nameKey: "promptTemplates.prompts.frameGenerateLast",
  descriptionKey: "promptTemplates.prompts.frameGenerateLastDesc",
  category: "frame",
  slots: [
    slot("style_matching", LAST_FRAME_STYLE_MATCHING, true),
    slot("relationship_to_first", LAST_FRAME_RELATIONSHIP_TO_FIRST, true),
    slot("next_shot_readiness", LAST_FRAME_NEXT_SHOT_READINESS, true),
    slot("rendering_quality", LAST_FRAME_RENDERING_QUALITY, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription =
      (params?.sceneDescription as string) ?? "";
    const endFrameDesc =
      (params?.endFrameDesc as string) ?? "";
    const characterDescriptions =
      (params?.characterDescriptions as string) ?? "";
    const visualStyleTag =
      (params?.visualStyleTag as string) ?? "";
    const cameraDirection =
      (params?.cameraDirection as string) ?? "";
    const sceneTitle =
      (params?.sceneTitle as string) ?? "";
    const shotKind =
      (params?.shotKind as "character" | "environment") ?? "character";
    const hasAnchorFirst = Boolean(params?.hasAnchorFirst);
    const hasCharacterSheetRefs = Boolean(params?.hasCharacterSheetRefs);
    const primaryEndFrame = endFrameDesc.trim();

    const lines: string[] = [];

    // 首行：画风硬锁（最高优先级）
    if (visualStyleTag) {
      lines.push(`视频静帧画面。【画风硬锁】${visualStyleTag}生成此镜头的尾帧——构图稳定，姿态完整，专为视频帧插值优化。`);
    } else {
      lines.push(`视频静帧画面。生成此镜头的尾帧，作为一张高质量视频结束静帧——构图稳定，姿态完整，专为视频帧插值优化。`);
    }
    lines.push("");

    // 画风匹配（内嵌画风硬锁覆盖 slot）
    if (visualStyleTag) {
      lines.push(`=== 【强制】画风锁定（最高优先级，不可覆盖）===`);
      lines.push(`本项目画风标签：${visualStyleTag}`);
      lines.push(`你同时必须精确匹配已附带的首帧图像的画风。严禁在任何画风之间切换或混合。`);
    } else {
      lines.push(r("style_matching"));
    }
    lines.push("");

    // 零文字声明（紧接画风锁之后）
    lines.push(`⛔ 图像内零文字原则（违反即判失败）：画面内不得出现任何文字——包括但不限于片名、集标题、场景名、分镜编号、角色名文字标注、对白字幕、字幕条、水印、UI控件。图像只包含纯粹的视觉画面，绝对不包含任何可读文字。`);
    lines.push("");

    if (sceneTitle) {
      lines.push(`=== 构图语义参考（仅供构图，不得在图像中渲染此文字）===`);
      lines.push(sceneTitle);
      lines.push("");
    }

    if (cameraDirection) {
      lines.push(`=== 尾帧构图视角（仅本场落幅/收束）===`);
      lines.push(cameraDirection);
      lines.push("");
    }

    if (primaryEndFrame) {
      lines.push(`=== 【最高优先级】尾帧静止画面（动作结束后）===`);
      lines.push(
        `本图是视频结束静帧，只描绘本镜动作完成后的稳定收束。以下描述优先于场景概述中的进行态情节：`
      );
      lines.push(`严禁白色、灰色或纯色背景。`);
      lines.push(
        `⚠️ 物理过滤器：灯笼/旗帜/布料等只能向下垂挂或随风水平飘展，不得违反重力。`
      );
      lines.push(primaryEndFrame);
      lines.push("");
      const sceneCtx = sceneDescription.trim();
      if (sceneCtx && sceneCtx !== primaryEndFrame) {
        lines.push(`=== 镜头情节上下文（仅供理解地点/场次，禁止画进尾帧）===`);
        lines.push(sceneCtx);
        lines.push("");
      }
    } else {
      lines.push(`=== 【强制】背景场景（无独立尾帧描述时的回退）===`);
      lines.push(`严禁白色、灰色或纯色背景。必须渲染以下场景环境，并与首帧保持一致：`);
      lines.push(sceneDescription || "宏大的奇幻场景，有建筑、自然景观或战场环境");
      lines.push(`背景需完整可见，占画面至少30%面积。`);
      lines.push("");
      lines.push(`=== 帧描述（物理规律自动修正）===`);
      lines.push(
        `按以下描述渲染此帧静态画面。⚠️ 物理过滤器：灯笼/旗帜/布料等只能向下垂挂或随风水平飘展：`
      );
      lines.push(endFrameDesc || sceneDescription);
      lines.push("");
    }

    if (shotKind === "environment") {
      lines.push(`=== 角色（环境/群演镜头）===`);
      lines.push(
        `本镜无具名主角。勿在前景绘制清晰主角正脸；须符合「尾帧静止画面」。`
      );
    } else {
      lines.push(`=== 角色描述 ===`);
      lines.push(characterDescriptions || "（见角色设定图）");
    }
    lines.push("");

    if (hasAnchorFirst || hasCharacterSheetRefs) {
      lines.push(`=== 参考图（优先级：角色设定图 > 首帧）===`);
      if (hasAnchorFirst) {
        lines.push(`第一张附带图像是本镜头首帧——用于环境、布光、画风匹配。`);
      }
      if (hasCharacterSheetRefs) {
        lines.push(`其余为角色设定图（四视角）——角色外貌、服装、体型以设定图为最高权威。`);
        lines.push(`若首帧为群演/空镜，以设定图与「尾帧静止画面」为准，勿盲目复制首帧中多余人物。`);
      }
      lines.push("");
    }

    lines.push(r("relationship_to_first"));
    lines.push("");
    lines.push(r("next_shot_readiness"));
    lines.push("");
    lines.push(
      shotKind === "environment"
        ? LAST_FRAME_RENDERING_QUALITY_ENVIRONMENT
        : r("rendering_quality")
    );
    return lines.join("\n");
  },
};

// ─── 10. video_generate ─────────────────────────────────

const VIDEO_INTERPOLATION_HEADER = `根据以下描述生成视频，首帧图像是起点，尾帧图像是终点，平滑插值两帧之间的动态过程。

提示词结构（官方 Seedance 首尾帧公式）：
  主体（角色名+视觉标识）+ 从首帧到尾帧的详细动作变化弧度 + 运镜（起幅构图→方式+速度→落幅构图）

核心要求：
- 聚焦"发生了什么"——从首帧状态到尾帧状态，中间发生了哪个具体动作；角色外貌已由图像输入保证，无需在文字中重复描写
- 动作弧度须精确：哪个身体部位，向哪个方向，以什么速度移动，最终停在什么位置
- 运镜优先级最高：明确起幅（景别+视角）→ 运动方式（推/拉/摇/移/跟/升/降/环绕）→ 速度 → 落幅（景别+视角）
- 常用过渡动作词：「主体原地转身」「走出/入画面」「360度环绕运镜」「缓慢拉远至远景」「快速推进至极特写」`;


const VIDEO_DIALOGUE_FORMAT = `对白格式：
- 画内对白：【对白口型】角色名（视觉标识）: "台词"
- 画外旁白：【画外音】角色名: "台词"`;

const VIDEO_FRAME_ANCHORS = `[帧锚点]
首帧：{{START_FRAME_DESC}}
尾帧：{{END_FRAME_DESC}}`;

const videoGenerateDef: PromptDefinition = {
  key: "video_generate",
  nameKey: "promptTemplates.prompts.videoGenerate",
  descriptionKey: "promptTemplates.prompts.videoGenerateDesc",
  category: "video",
  slots: [
    slot("interpolation_header", VIDEO_INTERPOLATION_HEADER, true),
    slot("dialogue_format", VIDEO_DIALOGUE_FORMAT, true),
    slot("frame_anchors", VIDEO_FRAME_ANCHORS, true),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("interpolation_header"),
      "",
      r("dialogue_format"),
      "",
      r("frame_anchors"),
    ].join("\n");
  },
};

// ─── 11. ref_video_prompt（已废弃）──────────────────────
// Vision-LLM 精炼视频 prompt 已被直出架构替代（buildDirectVideoPrompt）。
// generate action 已 410，resolveRefVideoPromptSystem 无调用方。
// DB 旧覆盖由 prune-stale-prompt-overrides.ts 负责清理，此处不再注册进 UI。

// ─── 4b. beauty_image ──────────────────────────────────

const BEAUTY_IMAGE_ROLE = `你是一位顶级的2D动画与插画角色设定师。你的任务是根据角色描述，生成一张专门用于“日常文戏”的高质量定妆图。`;
const BEAUTY_IMAGE_RULES = `=== 核心规则 ===
- 绝对不要给角色佩戴或持有任何武器（如剑、枪、魔法杖等）。如果角色设定中包含专属武器，请确保在此图中武器处于【收刀入鞘、背在身后、或挂在腰间】的非战斗状态。
- 画面重点展示角色的面部特征、日常表情、服饰细节和日常体态。
- 只生成一张正面全身视图，包括完整的头部、躯干，双腿和双脚，从头顶到脚尖完整不缺失——严禁截断腰部以下，严禁半身构图。
- 纯色背景，无任何杂物、文字或水印。`;

const beautyImageDef: PromptDefinition = {
  key: "beauty_image",
  nameKey: "promptTemplates.prompts.beautyImage",
  descriptionKey: "promptTemplates.prompts.beautyImageDesc",
  category: "character",
  slots: [
    slot("role_definition", BEAUTY_IMAGE_ROLE, true),
    slot("style_matching", CHAR_IMAGE_STYLE_MATCHING, true),
    slot("beauty_rules", BEAUTY_IMAGE_RULES, true),
    slot("face_detail", CHAR_IMAGE_FACE_DETAIL, true),
    slot("lighting_rendering", CHAR_IMAGE_LIGHTING_RENDERING, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const characterName = (params?.characterName as string) ?? undefined;
    const description = (params?.description as string) ?? "";
    return [
      r("role_definition"),
      "",
      r("style_matching"),
      "",
      `=== 角色描述 ===`,
      `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
      "",
      r("beauty_rules"),
      "",
      r("face_detail"),
      "",
      r("lighting_rendering"),
    ].join("\n");
  },
};

// ─── 4c. combat_image ──────────────────────────────────

const COMBAT_IMAGE_ROLE = `你是一位顶级的2D动画与动作戏原画师。你的任务是根据角色描述，生成一张专门用于“战斗打戏”的高质量武装定妆图。`;
const COMBAT_IMAGE_RULES = `=== 核心规则 ===
- 画面必须展示角色处于紧张的战斗状态、拔出专属武器（如有）、或施展魔法/特效的瞬间。
- 重点展现武器设计、发光特效、战斗动作和凶狠/专注的表情。
- 只生成一张正面全身视图，包括完整的头部、躯干，双腿和双脚，从头顶到脚尖完整不缺失——严禁截断腰部以下，严禁半身构图。允许战斗姿态（弓步、蹲伏）但必须露出完整双腿和双脚。
- 纯色背景，无任何杂物、文字或水印。`;

const combatImageDef: PromptDefinition = {
  key: "combat_image",
  nameKey: "promptTemplates.prompts.combatImage",
  descriptionKey: "promptTemplates.prompts.combatImageDesc",
  category: "character",
  slots: [
    slot("role_definition", COMBAT_IMAGE_ROLE, true),
    slot("style_matching", CHAR_IMAGE_STYLE_MATCHING, true),
    slot("combat_rules", COMBAT_IMAGE_RULES, true),
    slot("weapons_equipment", CHAR_IMAGE_WEAPONS_EQUIPMENT, true),
    slot("lighting_rendering", CHAR_IMAGE_LIGHTING_RENDERING, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const characterName = (params?.characterName as string) ?? undefined;
    const description = (params?.description as string) ?? "";
    return [
      r("role_definition"),
      "",
      r("style_matching"),
      "",
      `=== 角色描述 ===`,
      `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
      "",
      r("combat_rules"),
      "",
      r("weapons_equipment"),
      "",
      r("lighting_rendering"),
    ].join("\n");
  },
};

// ─── character_state_router（已废弃，LLM 状态路由已移除）────
// 改用 isDefault=1 资产直接选图，不再调用 LLM
// 注意：prune-stale-prompt-overrides.ts 的清单中保留该 key 以清理旧 DB 数据

// ─── outline_expand ─────────────────────────────────────

const outlineExpandDef: PromptDefinition = {
  key: "outline_expand",
  nameKey: "promptTemplates.prompts.outlineExpand",
  descriptionKey: "promptTemplates.prompts.outlineExpandDesc",
  category: "script",
  slots: [slot("system_prompt", OUTLINE_EXPAND_SYSTEM_DEFAULT, true)],
  buildFullPrompt(sc) {
    return sc.system_prompt ?? OUTLINE_EXPAND_SYSTEM_DEFAULT;
  },
};

// ─── single_shot_rewrite（已废弃，route handler 已移除）────
// 改用 batch_storyboard_rewrite（全集批量重写）
// 注意：prune-stale-prompt-overrides.ts 的清单中保留该 key 以清理旧 DB 数据

// ─── split_shot_single ──────────────────────────────────

const splitShotSingleDef: PromptDefinition = {
  key: "split_shot_single",
  nameKey: "promptTemplates.prompts.splitShotSingle",
  descriptionKey: "promptTemplates.prompts.splitShotSingleDesc",
  category: "shot",
  slots: [slot("system_prompt", SPLIT_SHOT_SINGLE_SYSTEM, true)],
  buildFullPrompt(sc) {
    return sc.system_prompt ?? SPLIT_SHOT_SINGLE_SYSTEM;
  },
};

// ─── batch_storyboard_rewrite ───────────────────────────

const batchStoryboardRewriteDef: PromptDefinition = {
  key: "batch_storyboard_rewrite",
  nameKey: "promptTemplates.prompts.batchStoryboardRewrite",
  descriptionKey: "promptTemplates.prompts.batchStoryboardRewriteDesc",
  category: "shot",
  slots: [slot("system_prompt", STORYBOARD_REWRITE_SYSTEM, true)],
  buildFullPrompt(sc) {
    return sc.system_prompt ?? STORYBOARD_REWRITE_SYSTEM;
  },
};

// ─── batch_plot_optimize ────────────────────────────────

const batchPlotOptimizeDef: PromptDefinition = {
  key: "batch_plot_optimize",
  nameKey: "promptTemplates.prompts.batchPlotOptimize",
  descriptionKey: "promptTemplates.prompts.batchPlotOptimizeDesc",
  category: "shot",
  slots: [slot("system_prompt", PLOT_OPTIMIZE_SYSTEM, true)],
  buildFullPrompt(sc) {
    return sc.system_prompt ?? PLOT_OPTIMIZE_SYSTEM;
  },
};

// ── Registry ─────────────────────────────────────────────

export const PROMPT_REGISTRY: PromptDefinition[] = [
  scriptGenerateDef,
  scriptParseDef,
  scriptSplitDef,
  outlineExpandDef,
  characterExtractDef,
  importCharacterExtractDef,
  characterImageDef,
  beautyImageDef,
  combatImageDef,
  // characterStateRouterDef — 已废弃，LLM 状态路由移除
  shotSplitDef,
  splitShotSingleDef,
  // singleShotRewriteDef — 已废弃，从 registry 移除
  batchStoryboardRewriteDef,
  batchPlotOptimizeDef,
  frameGenerateFirstDef,
  frameGenerateLastDef,
  videoGenerateDef,
  // refVideoPromptDef — 已废弃，从 registry 移除
];

export const PROMPT_REGISTRY_MAP: Record<string, PromptDefinition> =
  Object.fromEntries(PROMPT_REGISTRY.map((d) => [d.key, d]));

/**
 * Look up a prompt definition by key.
 */
export function getPromptDefinition(
  key: string
): PromptDefinition | undefined {
  return PROMPT_REGISTRY_MAP[key];
}

/**
 * Get the default slot contents for a prompt definition as a plain object.
 */
export function getDefaultSlotContents(
  key: string
): Record<string, string> | undefined {
  const def = PROMPT_REGISTRY_MAP[key];
  if (!def) return undefined;
  const result: Record<string, string> = {};
  for (const s of def.slots) {
    result[s.key] = s.defaultContent;
  }
  return result;
}
