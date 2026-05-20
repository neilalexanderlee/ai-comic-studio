/**
 * Eval fixtures — canonical shot and character test data
 *
 * These represent real-world scenarios the system must handle correctly.
 * Used across multiple eval suites.
 */

export const CHARACTERS = {
  longYuan: {
    id: "char_longyuan",
    name: "龙渊",
    description: "男性，约35岁，黑色长发束成马尾，身着暗红色战袍，表情深沉克制",
    visualHint: "黑色马尾，暗红色战袍，剑眉星目，气质沉稳",
    voiceHint: "男性，约35岁，声音低沉沙哑，语速缓慢，情绪压抑克制",
    scope: "main" as const,
  },
  yunYan: {
    id: "char_yunyan",
    name: "云烟（少女形态）",
    description: "女性，约16岁，银白色长发，穿浅蓝色轻纱裙，神情清冷淡漠",
    visualHint: "银白长发，浅蓝轻纱，眼神清冷",
    voiceHint: "女性，约16岁，声音轻柔空灵，语速平稳，情绪淡然",
    scope: "main" as const,
  },
  linFeng: {
    id: "char_linfeng",
    name: "林峰",
    description: "男性，约28岁，短发，便装，性格热情豪爽",
    visualHint: "短发，便装，面容阳光",
    voiceHint: "男性，约28岁，声音爽朗，语速较快，情绪活泼",
    scope: "guest" as const,
  },
};

export const ALL_CHARACTERS = Object.values(CHARACTERS);

// ── Shot fixtures ─────────────────────────────────────────────────────────────

/** 包含主角的分镜 */
export const SHOT_WITH_NAMED_CHARACTERS = {
  id: "shot_001",
  sequence: 1,
  prompt: "龙渊站在竹林边缘，云烟从林中缓步走出，二人相视无言",
  startFrameDesc: "龙渊背对镜头，远望竹林；云烟银发在风中飘散，从阴影中现身",
  endFrameDesc: "二人对视，中景正面构图，表情凝重",
  cameraDirection: "static — 固定镜头，中景正面",
  duration: 5,
  videoScript: "龙渊转身，与云烟目光相遇，二人无言对立",
};

/** 群演场景，无主角配角 */
export const SHOT_CROWD_SCENE = {
  id: "shot_002",
  sequence: 2,
  prompt:
    "镜头从麦垛地面缓缓起吊，灯笼随微风轻轻摇摆，橙黄光晕在木屋墙面上来回游移；" +
    "升至屋顶高度时篝火圈全貌展开——数十名村民手牵手转圈，脚踩稻草发出沙沙碎响，孩子的笑声穿过弦乐浮上来",
  startFrameDesc: "仰角拍摄麦垛和灯笼，橙黄暖光",
  endFrameDesc: "俯拍篝火圈全景，村民围圈的宏观视角",
  cameraDirection: "crane up — 镜头从麦垛地面缓缓起吊",
  duration: 6,
  videoScript: "镜头起吊，篝火圈全貌呈现",
};

/** 纯动作/环境镜头，无角色出现 */
export const SHOT_PURE_ACTION = {
  id: "shot_003",
  sequence: 3,
  prompt: "剑气纵横，山崩地裂，碎石飞溅，烟尘弥漫",
  startFrameDesc: "剑光一闪，岩石开裂",
  endFrameDesc: "烟尘散去，峡谷一分为二",
  cameraDirection: "extreme wide — 大远景俯拍",
  duration: 3,
  videoScript: "剑气斩过山脉，地形被永久改变",
};

/** 单角色特写 */
export const SHOT_SINGLE_CHARACTER = {
  id: "shot_004",
  sequence: 4,
  prompt: "林峰奔跑过集市，穿越熙攘人群，神情焦急",
  startFrameDesc: "林峰从远处跑来，中景跟随镜头",
  endFrameDesc: "林峰停步，气喘吁吁，回望身后",
  cameraDirection: "tracking — 跟随运动",
  duration: 4,
  videoScript: "林峰全速奔跑，镜头跟随",
};

// ── Prompt enhancement fixtures ───────────────────────────────────────────────

export const RAW_VIDEO_PROMPTS = {
  seedance: {
    raw: "龙渊站在悬崖边，狂风吹动衣袍，他转身离去",
    expectedElements: ["主体", "运动", "环境", "运镜"] as string[],
  },
  kling: {
    raw: "云烟在月光下跳舞，发丝飞扬，神情空灵",
    expectedElements: ["主体", "动作", "场景"] as string[],
  },
  gemini: {
    raw: "龙渊和林峰在酒馆对峙",
    expectedElements: ["subject", "action", "camera"] as string[],
  },
};

export const RAW_IMAGE_PROMPTS = {
  doubao: {
    raw: "龙渊站在山顶，俯瞰云海，黑发飘扬",
    expectedElements: ["画风", "主体", "光影"] as string[],
  },
  openai: {
    raw: "云烟在竹林中行走，光影婆娑",
    expectedElements: ["subject", "lighting", "composition"] as string[],
  },
};
