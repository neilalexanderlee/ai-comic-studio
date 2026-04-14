// ─────────────────────────────────────────────────────────
// Prompt Registry — Slot Decomposition
// Decomposes all 12 prompt templates into editable slots.
// ─────────────────────────────────────────────────────────

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

const CHAR_EXTRACT_ROLE_DEFINITION = `你是一位资深角色设计师、摄影指导和美术总监。你的角色描述是直接输入AI图像生成器的唯一权威视觉参考。你写的每一个字都决定了角色的外观——务必精准、具体、富有画面感。

你的任务：从剧本中提取每个有名字的角色，并生成专业级的视觉规格书，达到真实电影制作宝典的水准。`;

const CHAR_EXTRACT_STYLE_DETECTION = `═══ 第一步——识别视觉风格 ═══
识别剧本中声明或隐含的风格：
- "真人" / "写实" / "实拍" / "照片级" → 按真实摄影或高端CG电影描写，绝不使用任何动漫美学。
- "动漫" / "漫画" / "anime" / "manga" → 按动漫比例、风格化特征、鲜艳色彩描写。
- "3D CG" / "皮克斯" → 按3D渲染管线描写。
- "2D卡通" → 按卡通插画描写。
此风格必须出现在每个角色的描述中。真人风格的剧本绝不能产出动漫风的描述。`;

const CHAR_EXTRACT_OUTPUT_FORMAT = `═══ 输出格式 ═══
仅JSON数组——不要markdown代码块，不要评论：
[
  {
    "name": "角色名，与剧本中完全一致",
    "scope": "main" 或 "guest",
    "description": "完整视觉规格——单段落，包含以下所有要求",
    "visualHint": "2-4个字的视觉标识符，用于对白标签（如 银发金瞳、红衣长发）。必须一眼可识别——聚焦最显著的外貌特征。",
    "personality": "2-3个塑造姿态、表情和动作的核心性格特质"
  }
]`;

const CHAR_EXTRACT_SCOPE_RULES = `═══ 角色分类规则 ═══
- "main"：驱动故事的核心角色，出现在多个场景中，或对剧情至关重要——主角、重要配角、关键反派
- "guest"：短暂出现的次要/辅助角色——路人、只出场一次的龙套、有名字但不重要的角色
拿不准时，优先选"main"。有实质对白或剧情影响的角色就是"main"。`;

const CHAR_EXTRACT_DESCRIPTION_REQUIREMENTS = `═══ 描述要求 ═══
写一段密集、精确的段落，涵盖以下所有方面。该描述将被原封不动地传给图像生成器——以专业摄影指导向摄影师布置任务的口吻书写：

0. 风格标签：以画风开头（如"写实真人电影风格，85mm镜头——"或"日系动漫风格——"），锚定下游渲染器。

1. 体态与气质：性别、表观年龄、身高感（高挑/娇小/中等）、体型（精瘦/纤细/健壮/敦实）、自然姿态和举止。

2. 面部——以特写镜头的方式描写：
   - 骨骼结构：脸型、颧骨、下颌线（锐利/柔和/棱角分明）、眉骨
   - 眼睛：形状（杏眼/圆眼/丹凤眼/单眼皮）、大小、瞳色（要具体，如"暴风灰"、"琥珀棕"、"深黑如墨"）、睫毛浓密度
   - 鼻子：鼻梁高度、鼻尖形状、鼻翼宽度
   - 嘴唇：厚薄、唇弓弧度、自然静态表情
   - 皮肤：用精确修饰词描述色调（如"瓷白冷调"、"暖蜜金"、"深檀木色蓝调底"），质感（通透/哑光/粗粝），斑点/痣等
   - 整体：直接描述颜值定位——模特级美人、硬朗帅气、邻家亲切感？

3. 发型：精确颜色（色相+底调，如"蓝黑色带深靛蓝光泽"），相对于身体的长度，质地（笔直/大波浪/紧卷），样式（如何蓬起、垂落、运动），发饰。

4. 服装——主要造型（完整穿搭分解）：
   - 上装：款式、剪裁、材质（如"修身石灰色羊毛中山领外套"），颜色
   - 下装：裤/裙类型、材质、颜色
   - 鞋履：款式、材质
   - 外套/铠甲：如有，逐层描写
   - 配饰：首饰（金属、宝石、风格）、腰带、包袋、手套、帽子——务必具体

5. 武器与装备（如有）：
   - 近战武器：刃长、刃型、护手样式、握柄缠绕材质、表面处理（烤蓝/抛光/雕刻），携带方式
   - 远程武器：弓/枪类型、表面处理、改装细节
   - 护甲：材质（板甲/锁子甲/皮甲），表面处理，徽记或刻纹
   - 其他装备：描述功能和外观

6. 标志性特征：伤疤（位置、形状、新旧）、纹身（图案、位置）、眼镜（框型、镜片色调）、机械义体、非人类特征（耳、翼、角、尾）——描述精确的视觉外观。

7. 角色色彩调色板：列出3-5个定义此角色视觉身份的主色（如"深红、磨旧金、炭黑"）。

【示例】
赛博朋克风格，35mm广角镜头低角度——男，约30岁，190cm精瘦高挑身形，脊背微弓带有黑客的颓废感。棱角分明的长脸，颧骨高耸投下锐利阴影，下颌线如刀削般锋锐，眉骨突出。狭长上挑的狐狸眼，左眼瞳色自然灰绿、右眼为机械义眼散发幽蓝冷光，睫毛稀疏。高挺鹰钩鼻，鼻尖略下弯带有攻击性，鼻翼窄。薄唇苍白，唇角自然下垂，常年不见笑意。肤色病态苍白偏冷青调，质感哑光粗粝，左颊从眼角到嘴角一道细长的银色机械缝合疤痕，沿疤痕嵌有微型蓝色LED指示灯。属于阴郁危险的暗夜猎手型。头发铂银白色带荧光紫挑染，右侧剃至3mm露出头皮上的电路纹身，左侧长发遮住半边脸垂至下巴，发尾参差不齐如刀割。上身破旧的哑光黑色合成皮夹克，立领，左肩焊接一块钛合金护甲片，内搭深灰色高科技速干背心，胸口印有褪色的红色骷髅标志。下身黑色工装机能裤，膝盖处缝有凯夫拉补丁，裤腿束入小腿处。脚穿磨损严重的黑色高帮军靴，鞋底加厚，鞋舌外翻。左前臂从手肘到手腕整段替换为钛合金机械义肢，关节处露出液压管线和微型齿轮，指尖是碳纤维材质。右手无名指戴一枚氧化发黑的钨钢戒指。腰后别一把折叠式等离子短刀，刀柄缠绕磨旧的红色伞绳。角色色彩调色板：哑光黑、铂银白、荧光紫、幽蓝冷光、锈红。`;

const CHAR_EXTRACT_WRITING_RULES = `═══ 书写规则 ═══
- 单段连续描写——description字段内不要使用项目符号或换行
- 要具体到让两个不同的AI图像生成器能生成辨认得出是同一个角色的图像
- 使用精确的颜色名：不要用"红色"而要用"血红"或"玫瑰粉"
- 颜值很重要——如果剧本暗示角色有吸引力，就写出真正惊艳的美感。使用高端时尚摄影和影视选角的专业语汇。
- 对非人类角色，以同样的解剖学精度描写其独特特征`;

const CHAR_EXTRACT_LANGUAGE_RULES = `【关键语言规则】所有字段必须使用与剧本相同的语言。中文剧本 → 中文输出。英文剧本 → 英文输出。角色名必须与剧本中完全一致。

仅返回JSON数组。不要markdown。不要评论。`;

const characterExtractDef: PromptDefinition = {
  key: "character_extract",
  nameKey: "promptTemplates.prompts.characterExtract",
  descriptionKey: "promptTemplates.prompts.characterExtractDesc",
  category: "character",
  slots: [
    slot("role_definition", CHAR_EXTRACT_ROLE_DEFINITION, true),
    slot("style_detection", CHAR_EXTRACT_STYLE_DETECTION, true),
    slot("output_format", CHAR_EXTRACT_OUTPUT_FORMAT, false),
    slot("scope_rules", CHAR_EXTRACT_SCOPE_RULES, true),
    slot(
      "description_requirements",
      CHAR_EXTRACT_DESCRIPTION_REQUIREMENTS,
      true
    ),
    slot("writing_rules", CHAR_EXTRACT_WRITING_RULES, true),
    slot("language_rules", CHAR_EXTRACT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("style_detection"),
      "",
      r("output_format"),
      "",
      r("scope_rules"),
      "",
      r("description_requirements"),
      "",
      r("writing_rules"),
      "",
      r("language_rules"),
    ].join("\n");
  },
};

// ─── 5. import_character_extract ────────────────────────

const IMPORT_CHAR_ROLE_DEFINITION = `你是一位资深角色设计师、摄影指导和美术总监。你的任务是从给定文本中提取所有有名字的角色，估算出现频率，并为每个角色生成专业级视觉规格书。`;

const IMPORT_CHAR_EXTRACTION_RULES = `规则：
1. 提取文本中每一个被命名的角色
2. 统计每个角色的大致出现/被提及次数
3. 被提及2次以上的很可能是主要角色
4. 合并明显的别名（如"小明"和"明哥"指同一个人）

═══ 第一步——识别视觉风格 ═══
识别文本中声明或隐含的风格：
- "真人" / "写实" / "实拍" / 历史题材 → 按写实电影风格描写，不使用任何动漫美学。
- "动漫" / "漫画" / "anime" / "manga" → 按动漫比例、风格化特征描写。
- "3D CG" / "皮克斯" → 按3D渲染描写。
- 如未指定风格，根据内容推断（历史文本 → 写实历史正剧风格）。

═══ 描述要求 ═══
"description"字段必须是一段密集的段落，涵盖以下所有方面，以专业摄影指导的口吻书写：

0. 风格标签：以画风开头（如"电影级写实历史正剧风格，无滤镜，85mm镜头特写——"）
1. 【体态】：性别、表观年龄、身高/体型、姿态、气质
2. 【面部】：脸型、下颌线、眉骨、眼型/瞳色、鼻型、嘴唇、肤色（精确描述）、皮肤质感、颜值定位
3. 【发型】：精确颜色、长度、样式、发饰
4. 【服装】：完整穿搭分解——上装、下装、鞋履、外套、配饰，注明材质和颜色
5. 【武器/装备】（如有）：武器、铠甲、装备的详细描写
6. 【色彩调色板】：3-5个定义此角色视觉身份的主色

【示例】
电影级写实历史正剧风格，无滤镜，85mm镜头特写——男，约45岁，身高约178cm，体型魁梧厚实但不臃肿，站姿沉稳如山，双肩微微后展透出帝王威压。方正国字脸，颧骨高耸，下颌线刚硬如刀削，眉骨隆起投下深邃阴影。丹凤眼窄长上挑，瞳色极深近乎纯黑，目光阴鸷锐利如鹰隼。鼻梁高挺笔直，鼻尖略呈鹰钩，鼻翼不宽。薄唇紧抿，唇线下弯，自然流露出冷峻威严。肤色深麦色暖调，面部肌理粗粝，法令纹深刻，额角有隐约的岁月痕迹。属于令人畏惧的帝王级气场。花白短髯修剪齐整，头戴十二旒冕冠，黑色旒珠垂落遮挡部分面容。身穿明黄色龙袍，五爪金龙盘踞前胸，金线满绣云纹海水江崖纹，袖口镶赤金色回纹宽边。腰系白玉带钩嵌红宝石的御带。脚蹬黑色缎面朝靴。角色色彩调色板：明黄、赤金、纯黑、白玉色、深麦色。

═══ 视觉标识 ═══
"visualHint"字段必须是2-4个字的外貌标签，用于即时视觉识别（如"龙袍金冠阴沉脸"、"大红直身佩刀"）。必须描述外貌，不是动作。

【关键语言规则】所有输出字段必须使用与原文相同的语言。`;

const IMPORT_CHAR_OUTPUT_FORMAT = `输出格式——仅JSON数组，不要markdown代码块，不要评论：
[
  {
    "name": "角色名，与文本中出现的一致",
    "frequency": 5,
    "description": "完整视觉规格——一段密集的段落，遵循以上所有要求",
    "visualHint": "2-4个字的外貌标识符"
  }
]

仅返回JSON数组。不要markdown。不要评论。`;

const importCharacterExtractDef: PromptDefinition = {
  key: "import_character_extract",
  nameKey: "promptTemplates.prompts.importCharacterExtract",
  descriptionKey: "promptTemplates.prompts.importCharacterExtractDesc",
  category: "character",
  slots: [
    slot("role_definition", IMPORT_CHAR_ROLE_DEFINITION, true),
    slot("extraction_rules", IMPORT_CHAR_EXTRACTION_RULES, true),
    slot("output_format", IMPORT_CHAR_OUTPUT_FORMAT, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [r("role_definition"), "", r("extraction_rules"), "", r("output_format")].join("\n");
  },
};

// ─── 6. character_image ─────────────────────────────────

const CHAR_IMAGE_STYLE_MATCHING = `=== 关键：画风匹配 ===
仔细阅读下方的角色描述。描述中指定或暗示了画风（如 动漫、漫画、写实照片级、卡通、水彩、像素风、油画 等）。
你必须精确匹配该画风。不要默认使用写实风格。不要覆盖描述中的风格。
- 如果描述中提到"动漫"/"漫画"/"anime"/"manga" → 生成动漫/漫画风格插画
- 如果描述中提到"写实"/"真人"/"photorealistic" → 生成写实渲染
- 如果描述暗示其他风格 → 忠实遵循该风格
- 如果完全未提及风格 → 根据角色的背景和类型推断最合适的风格`;

const CHAR_IMAGE_FACE_DETAIL = `=== 面部——高精度 ===
以适合所选画风的高精度渲染面部：
- 清晰一致的面部特征：骨骼结构、眼型、鼻型、嘴型——全部匹配描述中的外貌
- 眼睛：富有表现力、细节丰富、有高光反射和深度感——根据画风调整（动漫用动漫风格眼睛，写实用精细虹膜细节）
- 头发：清晰的发量、颜色和动态感，使用适合画风的渲染方式（写实用单根发丝，动漫用大块发束配高光条）
- 皮肤：符合画风的渲染——动漫用平滑赛璐珞着色，写实用毛孔级细节
- 整体：面部应具有辨识度和记忆点，有强烈的视觉特征`;

const CHAR_IMAGE_FOUR_VIEW_LAYOUT = `=== 四视图布局 ===
四个视角从左到右排列在纯白画布上，统一中景（腰部到头顶），四个视角保持一致：
1. 正面——面向观众，双臂自然放松垂于两侧，展示完整服装和手持武器
2. 四分之三侧面——向右旋转约45°，展示面部深度和立体感
3. 侧面轮廓——标准90°朝右，清晰展示鼻子、头发和武器的轮廓
4. 背面——完全背对，展示后脑发型、服装背部细节、背部装备`;

const CHAR_IMAGE_LIGHTING_RENDERING = `=== 光线与渲染 ===
- 干净的专业布光：主光从前上方，补光从对侧，轮廓光用于分离角色
- 纯白背景，确保角色清晰分离
- 在所选画风内达到最高渲染质量
- 四个视角保持一致的光线方向`;

const CHAR_IMAGE_CONSISTENCY_RULES = `=== 四视角一致性 ===
- 每个视角中角色身份必须完全一致——相同的面孔、相同的比例、相同的精确颜色
- 服装、配饰、武器位置、发色和发型完全一致
- 四个视角头顶对齐、腰部对齐
- 所有视角保持一致的表情和性格气质`;

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
    slot("four_view_layout", CHAR_IMAGE_FOUR_VIEW_LAYOUT, true),
    slot("lighting_rendering", CHAR_IMAGE_LIGHTING_RENDERING, true),
    slot("consistency_rules", CHAR_IMAGE_CONSISTENCY_RULES, true),
    slot("name_label", CHAR_IMAGE_NAME_LABEL, false),
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
      `=== 武器与装备（如有）===`,
      `- 以与角色相同的画风渲染所有武器、铠甲和装备`,
      `- 展示适合画风的材质细节：写实风要有使用痕迹，动漫/卡通风要有干净的风格化线条`,
      `- 所有装备必须与角色身体比例协调`,
      "",
      r("four_view_layout"),
      "",
      r("lighting_rendering"),
      "",
      r("consistency_rules"),
      "",
      nameLabelText,
      "",
      `=== 最终输出标准 ===`,
      `专业角色设计参考设定图。在所选画风内达到最高质量。零AI瑕疵，视图之间零不一致。这是唯一的权威参考——所有后续生成的画面必须精确再现此角色的此风格。`,
    ].join("\n");
  },
};

// ─── 7. shot_split ──────────────────────────────────────

const SHOT_SPLIT_ROLE_DEFINITION = `你是一位经验丰富的分镜导演和摄影指导，擅长动画短片制作。你规划的镜头列表视觉动态丰富、叙事高效，并为AI视频生成流水线优化（首帧 → 尾帧 → 插值视频）。

你的任务：将剧本分解为精确的镜头列表，每个镜头成为一个{{MIN_DURATION}}-{{MAX_DURATION}}秒的AI生成视频片段。`;

const SHOT_SPLIT_OUTPUT_FORMAT_TEMPLATE = `输出JSON数组：
[
  {
    "sequence": 1,
    "sceneDescription": "场景/环境描写——布景、建筑、道具、天气、时间、布光方案、色彩基调、氛围情绪",
    "startFrame": "详细的首帧描述，用于AI图像生成（见下方要求）",
    "endFrame": "详细的尾帧描述，用于AI图像生成（见下方要求）",
    "motionScript": "完整的动作脚本，描述从首帧到尾帧发生的一切",
    "videoScript": "简洁的1-2句动态描述，用于视频生成模型（见下方要求）",
    "duration": {{MIN_DURATION}}-{{MAX_DURATION}},
    "dialogues": [
      {
        "character": "精确的角色名",
        "text": "此镜头中说的台词"
      }
    ],
    "cameraDirection": "具体的镜头运动指令"
  }
]`;

const SHOT_SPLIT_START_END_FRAME_RULES = `=== 首帧与尾帧要求（关键——直接驱动图像生成）===
每帧都必须是自给自足的图像生成提示词，包含：
- 构图：画面布局——前景/中景/背景层次，角色位置（左/中/右，三分法），景深
- 角色：使用精确角色名，描述当前姿态、表情、动作、服装（匹配角色设定图）
- 镜头：景别（大特写/特写/中景/全景/大全景），角度（平视/仰拍/俯拍/鸟瞰/荷兰角）
- 光线：方向、质感、色温——针对此帧的具体时刻
- 首帧和尾帧中不要包含对白文本

=== 首帧专属规则 ===
- 展示动作开始前的初始状态
- 角色处于起始位置，带有开场表情
- 镜头处于起始位置/构图

=== 尾帧专属规则 ===
- 展示动作完成后的结束状态
- 角色已移动到新位置，表情反映动作的结果
- 镜头处于最终位置/构图（经过cameraDirection运动后）
- 必须视觉稳定（不能处于运动中间）——此帧将被复用为下一个镜头的开场参考
- 构图必须作为独立画面成立

【示例】
startFrame: "全景，三分法构图。画面左侧三分之一处，林晓月（米白衬衫、黑色长直发）骑着旧自行车从巷口驶入，车篮里的葱叶在晚风中微微摆动。弄堂两侧晾衣竿上的花色被单在暖橘色夕阳中轻轻飘荡。青石板路面反射着金色余晖，远处弄堂尽头隐约可见几户人家的灯光。自然光线从画面右上方45度照入，色温偏暖。"
endFrame: "中景偏近，林晓月在画面中央偏右位置停下自行车，左脚点地，右手拨开眼前垂落的花被单，微微喘气的嘴角带着一丝无奈的笑意。背景中弄堂深处的赵东明（深灰工装夹克）的模糊身影倚在门框上，作为画面的视觉锚点。夕阳从背后打出暖色轮廓光。"`;

const SHOT_SPLIT_MOTION_SCRIPT_RULES = `=== motionScript 要求 ===
- 按时间段叙事："0-2秒：[动作]。2-4秒：[动作]。4-6秒：[动作]。……"
- 严格规则：每个时间段最多3秒。10秒的镜头 = 至少4个段落。绝不写超过3秒的段落。
- 每段是一个密集的长句（50-80字），同时编织四个层次：
  • 角色：精确的肢体运动——指关节发白、筋腱绷起、瞳孔收缩、屏住呼吸、牙关紧咬；指定速度和力度
  • 环境：世界的反应——地面裂纹蛛网状扩散、灯柱弯折、火花倾泻、黑烟翻滚、碎片轨迹
  • 镜头：精确的景别+运动+速度——"镜头猛降至地面超广角然后急速上升"/"镜头保持大特写然后猛甩向右"
  • 物理/氛围：材质细节——金属碎裂声、冲击波空气涟漪、热变形、色温变化、粒子行为

【示例】
- 差（太笼统，跨度太长）："0-6秒：铁兽挥爪摧毁了街道。镜头推进。"
- 好（具体，最多3秒）："0-2秒：铁兽右前肢重重落地发出震骨闷响，蛛网裂纹从落点向外辐射六米，三组机械爪齿同时升起拖出液压白雾，传感器眼脉冲暗红；镜头低角度广角缓缓上摇。2-4秒：前爪以亚音速横扫，在灯柱中段切出蓝白色火花爆裂，断裂的上半截以45度角旋飞而出，沥青碎块和碎金属向下方四散飞溅；镜头保持中景然后猛推进。4-6秒：破裂管道涌出的黑烟在热冲击波上翻滚弥漫画面，碎片仍在降落，铁兽传感器眼锁定下一个目标发出尖锐的液压啸叫；镜头低角度缓慢右旋，最终定格在铁兽的剪影上。"`;

const SHOT_SPLIT_VIDEO_SCRIPT_RULES = `=== videoScript 要求 ===
- 用途：视频生成模型的主要输入——驱动所有动态；必须是自然的Seedance风格散文
- 格式：30-60字的流畅散文，不要任何分类标签
  • 以角色名+括号内简短视觉标识开头（如 林晓月（米白衬衫黑长发）或 Sarah (red coat)）
  • 描述动作——具体的身体运动、方向、速度
  • 在句尾自然嵌入镜头运动
  • 一个精准的氛围或情感细节定调
- 规则：不要Scene:/Action:/Performance:/Detail:标签。不要时间戳。不要对白文本（放在dialogues数组中）。不要单独的镜头行。
- 语言：与剧本相同

【示例】
- 差（有标签）："Scene: 湖畔垂柳。Action: 陆云舟落棋。Performance: 神情淡然。"
- 差（单独镜头行）："陆云舟落棋。Camera: dolly out。"
- 好（散文，约45字）：
  "陆云舟（月白长袍，玉簪束发）从棋盘上缓缓抬眼，头微侧转向斜后方，嘴角牵出一抹含笑弧度，月白纱衣随晨风轻轻摆动，镜头缓慢推近。"
- 好（英文，约45词）：
  "The Veteran (black helmet, calm eyes) leans forward over the steering wheel, one hand adjusting the visor with practiced ease, the rain-blurred dashboard lights casting green on his face as the camera slowly pushes in."

=== sceneDescription 要求 ===
- 两帧共享的环境上下文
- 布景、建筑、道具、天气、时间
- 布光方案（主光/补光/轮廓光，方向、质感、色温）
- 色彩基调和氛围情绪
- 不要包含角色动作或姿态——那些放在 startFrame/endFrame 中

【示例】
sceneDescription: "老城区弄堂黄昏。窄长的青石板巷道两侧是斑驳的灰白色砖墙，二层木阳台上晾满花色被单。弄堂尽头可见一棵老梧桐树的枝叶剪影。自然光为落日暖橘色调，从巷口方向斜照入，在石板路面形成长长的影子。色彩基调：暖橘、灰白、深绿、旧木棕。氛围：烟火气十足的市井温情，带有时光流逝的怀旧感。"`;

const SHOT_SPLIT_CAMERA_DIRECTIONS = `镜头运动指令（每个镜头选择一个）：
- "static" — 固定镜头，无运动
- "slow zoom in" / "slow zoom out" — 缓慢变焦
- "pan left" / "pan right" — 水平横摇
- "tilt up" / "tilt down" — 垂直纵摇
- "tracking shot" — 跟随角色运动
- "dolly in" / "dolly out" — 镜头物理前进/后退
- "crane up" / "crane down" — 垂直升降
- "orbit left" / "orbit right" — 环绕主体旋转
- "push in" — 缓慢前推强调`;

const SHOT_SPLIT_CINEMATOGRAPHY_PRINCIPLES_TEMPLATE = `摄影原则：
- 变化景别——避免连续镜头使用相同构图；全景/中景/特写交替使用
- 新场景开头使用定场镜头
- 重要对白或事件后使用反应镜头
- 在动作中切换——每个镜头在允许平滑过渡到下一个镜头的时刻结束
- 保持视线匹配——角色在镜头间保持一致的屏幕方向
- 180度法则——保持角色在画面中的一致位置
- 时长：所有镜头必须在{{MIN_DURATION}}-{{MAX_DURATION}}秒内。对白密集型 = {{DIALOGUE_MAX}}-{{MAX_DURATION}}秒；动作镜头 = {{MIN_DURATION}}-{{ACTION_MAX}}秒；定场镜头 = {{MIN_DURATION}}-{{ESTABLISHING_MAX}}秒
- 连续性：镜头N的尾帧必须与镜头N+1的首帧逻辑衔接（相同角色、一致环境、自然的位置过渡）
- 覆盖度：剧本中的每个场景至少生成一个镜头。不要跳过或合并场景。如果场景复杂，拆分为多个镜头。每个场景标记（场景 N）必须至少产生一个镜头。`;

const SHOT_SPLIT_LANGUAGE_RULES = `【关键语言规则】所有文本字段（sceneDescription、startFrame、endFrame、motionScript、dialogues.text、dialogues.character）必须使用与剧本相同的语言。如果剧本是中文，所有字段都用中文。只有"cameraDirection"使用英文（技术术语）。

仅返回JSON数组。不要markdown代码块。不要评论。`;

const SHOT_SPLIT_PROPORTIONAL_TIERS_TEMPLATE = `=== 比例差异规则 ===
{{PROPORTIONAL_TIERS}}`;

const shotSplitDef: PromptDefinition = {
  key: "shot_split",
  nameKey: "promptTemplates.prompts.shotSplit",
  descriptionKey: "promptTemplates.prompts.shotSplitDesc",
  category: "shot",
  slots: [
    slot("role_definition", SHOT_SPLIT_ROLE_DEFINITION, true),
    slot("output_format", SHOT_SPLIT_OUTPUT_FORMAT_TEMPLATE, false),
    slot("start_end_frame_rules", SHOT_SPLIT_START_END_FRAME_RULES, true),
    slot("motion_script_rules", SHOT_SPLIT_MOTION_SCRIPT_RULES, true),
    slot("video_script_rules", SHOT_SPLIT_VIDEO_SCRIPT_RULES, true),
    slot("proportional_tiers", SHOT_SPLIT_PROPORTIONAL_TIERS_TEMPLATE, true),
    slot("camera_directions", SHOT_SPLIT_CAMERA_DIRECTIONS, true),
    slot(
      "cinematography_principles",
      SHOT_SPLIT_CINEMATOGRAPHY_PRINCIPLES_TEMPLATE,
      true
    ),
    slot("language_rules", SHOT_SPLIT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);

    const maxDuration =
      (params?.maxDuration as number) ?? 15;
    const minDuration = Math.min(8, maxDuration);

    // Build proportional tiers dynamically
    let proportionalTiers: string;
    if (maxDuration <= 8) {
      proportionalTiers = `- ${minDuration}-${maxDuration}秒镜头：变化幅度与时长成正比`;
    } else {
      const tier1End = Math.round(maxDuration * 0.6);
      const tier2End = Math.round(maxDuration * 0.85);
      const tier2Start = tier1End + 1;
      const tier3Start = tier2End + 1;
      proportionalTiers =
        `- ${minDuration}-${tier1End}秒镜头：微小到中等变化（轻微转头、表情变化、小幅镜头运动）\n` +
        `- ${tier2Start}-${tier2End}秒镜头：中等变化（角色移动位置、明显表情变化、清晰镜头运动）\n` +
        `- ${tier3Start}-${maxDuration}秒镜头：大幅变化（角色穿越画面、重大动作完成、戏剧性镜头运动）`;
    }

    const durationRange = minDuration === maxDuration
      ? String(maxDuration)
      : `${minDuration}-${maxDuration}`;

    const replaceDuration = (text: string) => text
      .replace(/\{\{MIN_DURATION\}\}-\{\{MAX_DURATION\}\}/g, durationRange)
      .replace(/\{\{MIN_DURATION\}\}/g, String(minDuration))
      .replace(/\{\{MAX_DURATION\}\}/g, String(maxDuration));

    const roleDefinition = replaceDuration(r("role_definition"));

    // Replace dynamic placeholders in output_format
    let outputFormat = replaceDuration(r("output_format"));

    // Replace dynamic placeholders in cinematography_principles
    let cinematography = r("cinematography_principles");
    cinematography = cinematography
      .replace(/\{\{MIN_DURATION\}\}/g, String(minDuration))
      .replace(/\{\{MAX_DURATION\}\}/g, String(maxDuration))
      .replace(
        /\{\{DIALOGUE_MAX\}\}/g,
        String(Math.min(maxDuration, 12))
      )
      .replace(
        /\{\{ACTION_MAX\}\}/g,
        String(Math.min(maxDuration, 12))
      )
      .replace(
        /\{\{ESTABLISHING_MAX\}\}/g,
        String(Math.min(maxDuration, 10))
      );

    // Replace proportional tiers placeholder
    let proportionalSection = r("proportional_tiers");
    proportionalSection = proportionalSection.replace(
      /\{\{PROPORTIONAL_TIERS\}\}/g,
      proportionalTiers
    );

    return [
      roleDefinition,
      "",
      outputFormat,
      "",
      r("start_end_frame_rules"),
      "",
      r("motion_script_rules"),
      "",
      r("video_script_rules"),
      "",
      proportionalSection,
      "",
      r("camera_directions"),
      "",
      cinematography,
      "",
      r("language_rules"),
    ].join("\n");
  },
};

// ─── 8. frame_generate_first ────────────────────────────

const FIRST_FRAME_STYLE_MATCHING = `=== 关键：画风匹配（最高优先级）===
仔细阅读下方的角色描述和场景描述。它们指定或暗示了画风。
你必须精确匹配该画风。不要默认使用写实风格。
- 如果描述中提到 动漫/漫画/anime/manga/卡通/cartoon → 生成动漫/漫画风格插画
- 如果描述中提到 写实/真人/photorealistic → 生成写实照片级图像
- 如果附有参考图，参考图的视觉风格就是真理——精确匹配
- 输出的画风必须与角色设定图一致`;

const FIRST_FRAME_REFERENCE_RULES = `=== 参考图（角色设定图）===
每张附带的参考图是一张角色设定图，展示4个视角（正面、四分之三侧面、侧面、背面）。
角色的名字印在每张设定图底部——用它来识别对应的角色。
强制一致性规则：
- 将设定图中的角色名与场景描述中的角色名对应
- 服装必须与参考图完全一致——相同的衣物类型、颜色、材质、配饰。不要替换（如不要把青色常服换成龙袍）
- 面孔、发型、发色、体型、肤色必须精确匹配
- 参考图中展示的所有配饰（帽子、佩刀、发簪、首饰）必须出现
- 画风必须与参考图精确匹配`;

const FIRST_FRAME_RENDERING_QUALITY = `=== 渲染 ===
材质：符合画风的丰富细节
光线：具有动机的电影级布光。使用轮廓光分离角色。
背景：完整渲染的详细环境。不要空白或抽象背景。
角色：精确匹配参考图的外貌和画风。表情生动，姿态自然有动感。
构图：电影级取景，明确的视觉焦点和景深。`;

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

    const lines: string[] = [];
    lines.push(`生成此镜头的首帧，作为一张高质量图像。`);
    lines.push("");
    lines.push(r("style_matching"));
    lines.push("");
    lines.push(`=== 场景环境 ===`);
    lines.push(sceneDescription);
    lines.push("");
    lines.push(`=== 帧描述 ===`);
    lines.push(startFrameDesc);
    lines.push("");
    lines.push(`=== 角色描述 ===`);
    lines.push(characterDescriptions);
    lines.push("");
    lines.push(r("reference_rules"));
    lines.push("");

    if (previousLastFrame) {
      lines.push(r("continuity_rules"));
      lines.push("");
    }

    lines.push(r("rendering_quality"));
    return lines.join("\n");
  },
};

// ─── 9. frame_generate_last ─────────────────────────────

const LAST_FRAME_STYLE_MATCHING = `=== 关键：画风匹配（最高优先级）===
你必须精确匹配首帧图像（已附带）的画风。
如果首帧是动漫/漫画风格 → 此帧也必须是动漫/漫画风格。
如果首帧是写实风格 → 此帧也必须是写实风格。
不要改变或混合画风。这是不可协商的。`;

const LAST_FRAME_RELATIONSHIP_TO_FIRST = `=== 与首帧的关系 ===
此尾帧展示镜头动作的结束状态。与首帧相比：
- 相同的环境、布光方案和色彩基调
- 画风绝对相同——不可有任何变化
- 服装完全一致——角色穿着与设定图和首帧中完全相同的服装。不可换装。
- 面孔、发型、配饰相同——只有姿态/表情/位置发生变化
- 角色的位置、姿态和表情已按帧描述中的说明发生变化`;

const LAST_FRAME_NEXT_SHOT_READINESS = `=== 作为下一个镜头的起始点 ===
此帧将被复用为下一个镜头的首帧。确保：
- 姿态是稳定的——不处于运动中间，不模糊
- 构图完整，可作为独立画面成立
- 取景允许自然过渡到不同的镜头角度`;

const LAST_FRAME_RENDERING_QUALITY = `=== 渲染 ===
材质：匹配首帧风格的丰富细节
光线：与首帧相同的布光方案。仅在动作驱动的情况下变化。
背景：必须匹配首帧的环境。
角色：精确匹配参考图。展示镜头动作结束时的情感状态。
构图：镜头的自然收束，为下一个剪辑做好准备。`;

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

    const lines: string[] = [];
    lines.push(`生成此镜头的尾帧，作为一张高质量图像。`);
    lines.push("");
    lines.push(r("style_matching"));
    lines.push("");
    lines.push(`=== 场景环境 ===`);
    lines.push(sceneDescription);
    lines.push("");
    lines.push(`=== 帧描述 ===`);
    lines.push(endFrameDesc);
    lines.push("");
    lines.push(`=== 角色描述 ===`);
    lines.push(characterDescriptions);
    lines.push("");
    lines.push(`=== 参考图 ===`);
    lines.push(`第一张附带图像是此镜头的首帧——以它为视觉锚点。`);
    lines.push(`其余附带图像是角色设定图（每张4个视角，名字印在底部）。`);
    lines.push(`将每张设定图的角色名与场景中的角色对应。`);
    lines.push("");
    lines.push(r("relationship_to_first"));
    lines.push("");
    lines.push(r("next_shot_readiness"));
    lines.push("");
    lines.push(r("rendering_quality"));
    return lines.join("\n");
  },
};

// ─── 10. scene_frame_generate ────────────────────────────

const SCENE_FRAME_REFERENCE_RULES = `=== 角色参考图 ===
附带的角色设定图是权威视觉参考。
强制一致性规则：
- 必须精确再现参考图中每个角色的外貌——相同的面孔、服装、发型、体型和颜色
- 不要改变任何角色的外观
- 画风必须与参考图精确匹配`;

const SCENE_FRAME_COMPOSITION_RULES = `=== 构图规则 ===
- 根据场景描述渲染具体的构图——不要默认使用通用的双人镜头
- 完整渲染的背景——不要空白或抽象背景
- 电影级取景，清晰的构图和景深
- 角色在画面中的位置和姿态必须符合场景描述和动作上下文`;

const SCENE_FRAME_RENDERING = `=== 渲染质量 ===
- 材质：符合画风的丰富细节
- 光线：电影级布光，光源有明确动机，使用轮廓光分离角色
- 角色：精确匹配参考图的外貌和画风，表情生动，姿态自然
- 画风由参考图决定——精确匹配`;

const sceneFrameGenerateDef: PromptDefinition = {
  key: "scene_frame_generate",
  nameKey: "promptTemplates.prompts.sceneFrameGenerate",
  descriptionKey: "promptTemplates.prompts.sceneFrameGenerateDesc",
  category: "frame",
  slots: [
    slot("reference_rules", SCENE_FRAME_REFERENCE_RULES, true),
    slot("composition_rules", SCENE_FRAME_COMPOSITION_RULES, true),
    slot("rendering", SCENE_FRAME_RENDERING, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription = (params?.sceneDescription as string) ?? "";
    const charRefMapping = (params?.charRefMapping as string) ?? "";
    const characterDescriptions = (params?.characterDescriptions as string) ?? "";
    const cameraDirection = (params?.cameraDirection as string) ?? "";
    const startFrameDesc = (params?.startFrameDesc as string) ?? "";
    const motionScript = (params?.motionScript as string) ?? "";

    const lines: string[] = [];
    lines.push(`生成一张电影级静帧图像，作为场景参考帧。`);
    lines.push("");
    lines.push(`=== 场景描述 ===`);
    lines.push(sceneDescription);

    if (startFrameDesc) {
      lines.push("");
      lines.push(`=== 开场构图 ===`);
      lines.push(`画面必须描绘这一特定时刻：${startFrameDesc}`);
    }

    if (cameraDirection && cameraDirection !== "static") {
      lines.push("");
      lines.push(`=== 镜头构图 ===`);
      lines.push(`镜头运动：${cameraDirection}`);
      lines.push(`将此镜头角度/距离精确应用到构图中。`);
    }

    if (motionScript) {
      lines.push("");
      lines.push(`=== 动作/运动上下文 ===`);
      lines.push(`角色正在：${motionScript}`);
      lines.push(`捕捉角色处于所描述的关键姿态或动作中。`);
    }

    lines.push("");
    lines.push(`=== 角色描述 ===`);
    lines.push(characterDescriptions);

    lines.push("");
    lines.push(r("reference_rules"));
    if (charRefMapping) {
      lines.push(`角色与参考图对应关系：${charRefMapping}`);
    }

    lines.push("");
    lines.push(r("composition_rules"));
    lines.push("");
    lines.push(r("rendering"));

    return lines.join("\n");
  },
};

// ─── 11. video_generate ─────────────────────────────────

const VIDEO_INTERPOLATION_HEADER = `从首帧平滑插值到尾帧。`;

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

// ─── 11. ref_video_generate ─────────────────────────────

const REF_VIDEO_DIALOGUE_FORMAT = `对白格式：
- 画内对白：【对白口型】角色名（视觉标识）: "台词"
- 画外旁白：【画外音】角色名: "台词"`;

const refVideoGenerateDef: PromptDefinition = {
  key: "ref_video_generate",
  nameKey: "promptTemplates.prompts.refVideoGenerate",
  descriptionKey: "promptTemplates.prompts.refVideoGenerateDesc",
  category: "video",
  slots: [
    slot("dialogue_format", REF_VIDEO_DIALOGUE_FORMAT, true),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return r("dialogue_format");
  },
};

// ─── 12. ref_video_prompt ───────────────────────────────

const REF_VIDEO_PROMPT_ROLE_DEFINITION = `你是一位Seedance 2.0视频提示词撰写专家。给定一个镜头的首帧（起始状态）和尾帧（结束状态），加上剧本上下文，撰写精确的动态提示词，描述两帧之间的过渡。

## 核心原则
视频模型将首帧作为起点。你的工作是精确描述如何从首帧过渡到尾帧——什么在动，怎么动，什么时候动。仔细研究两帧：注意角色位置、表情、光线、镜头角度和环境在两帧之间的变化。`;

const REF_VIDEO_PROMPT_MOTION_RULES = `## 规则
- 匹配剧本上下文的语言（中文剧本 → 中文提示词，英文 → 英文），纯散文，无标签
- 首次提及时："角色名（视觉标识）"——使用下方角色视觉标识中提供的精确标识符。绝不自行编造替代品。
- 镜头运动：要具体——"缓慢推近"、"固定"、"焦点从X转移到Y"、"手持微晃"
- 将动作拆解为精确的节拍，有清晰的因果关系：先发生什么 → 然后 → 结果
- 每个节拍应描述物理运动：距离、速度、方向、运动的质感
- 不要使用空洞的修饰词（"优雅地"、"轻柔地"），除非它们指定了运动方式
- 氛围/环境细节仅在它们有动态时描写（摇曳的枝条、升腾的雾气、闪烁的灯光）
- 40-70字
- 如有对白，保持原文语言，独立一行放在最后：【对白口型】角色名（视觉标识）: "原文台词"
- 仅输出提示词，无前言`;

const REF_VIDEO_PROMPT_QUALITY_BENCHMARK = `## 质量基准

差（笼统，侧重外貌描写）：
他的手指散发出温暖的光芒，优雅地落下棋子。氛围宁静而美好。

好（精确，侧重动态描写）：
镜头固定。弈哲（月白长袍）捏住玉棋子，在晨雾中以极慢弧线落下。落子——棋面微震，一颗露珠滚落。手指停顿一拍，然后以一个平滑的动作收回。焦点从指尖转移到落定的棋子。背景垂柳枝条轻轻飘荡。

【示例】
- "林晓月（米白衬衫黑长发）双手握住自行车把手缓缓刹停，左脚落地踩稳，右手松开车把去拨开面前垂落的花被单，嘴角微微上扬露出无奈的笑意，镜头从全景缓慢推至中近景。"
- "赵东明（深灰工装夹克）从门框上直起身，夹在指间的烟转了半圈，目光从远处收回聚焦到画面左侧，嘴角的弧度微不可察地加深，镜头固定。"`;

const REF_VIDEO_PROMPT_LANGUAGE_RULES = `匹配剧本上下文的语言。仅输出提示词。`;

const refVideoPromptDef: PromptDefinition = {
  key: "ref_video_prompt",
  nameKey: "promptTemplates.prompts.refVideoPrompt",
  descriptionKey: "promptTemplates.prompts.refVideoPromptDesc",
  category: "video",
  slots: [
    slot("role_definition", REF_VIDEO_PROMPT_ROLE_DEFINITION, true),
    slot("motion_rules", REF_VIDEO_PROMPT_MOTION_RULES, true),
    slot("quality_benchmark", REF_VIDEO_PROMPT_QUALITY_BENCHMARK, true),
    slot("language_rules", REF_VIDEO_PROMPT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("motion_rules"),
      "",
      r("quality_benchmark"),
    ].join("\n");
  },
};

// ── Registry ─────────────────────────────────────────────

export const PROMPT_REGISTRY: PromptDefinition[] = [
  scriptGenerateDef,
  scriptParseDef,
  scriptSplitDef,
  characterExtractDef,
  importCharacterExtractDef,
  characterImageDef,
  shotSplitDef,
  frameGenerateFirstDef,
  frameGenerateLastDef,
  sceneFrameGenerateDef,
  videoGenerateDef,
  refVideoGenerateDef,
  refVideoPromptDef,
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
