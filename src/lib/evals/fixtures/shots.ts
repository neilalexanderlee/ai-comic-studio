/**
 * Eval fixtures — canonical shot and character test data
 *
 * These represent real-world scenarios the system must handle correctly.
 * Used across multiple eval suites.
 */

import {
  FIXTURE_CHAR_A,
  FIXTURE_CHAR_C,
  FIXTURE_CHAR_D,
  FIXTURE_CHAR_D_BASE,
} from "@/lib/test-fixtures/placeholder-characters";

export const CHARACTERS = {
  charA: {
    id: "char_a",
    name: FIXTURE_CHAR_A,
    description: "男性，约35岁，黑色长发束成马尾，身着暗红色战袍，表情深沉克制",
    visualHint: "黑色马尾，暗红色战袍，剑眉星目，气质沉稳",
    voiceHint: "男性，约35岁，声音低沉沙哑，语速缓慢，情绪压抑克制",
    scope: "main" as const,
  },
  charD: {
    id: "char_d",
    name: FIXTURE_CHAR_D,
    description: "女性，约16岁，银白色长发，穿浅蓝色轻纱裙，神情清冷淡漠",
    visualHint: "银白长发，浅蓝轻纱，眼神清冷",
    voiceHint: "女性，约16岁，声音轻柔空灵，语速平稳，情绪淡然",
    scope: "main" as const,
  },
  charC: {
    id: "char_c",
    name: FIXTURE_CHAR_C,
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
  prompt: `${FIXTURE_CHAR_A}站在竹林边缘，${FIXTURE_CHAR_D_BASE}从林中缓步走出，二人相视无言`,
  startFrameDesc: `${FIXTURE_CHAR_A}背对镜头，远望竹林；${FIXTURE_CHAR_D_BASE}银发在风中飘散，从阴影中现身`,
  endFrameDesc: "二人对视，中景正面构图，表情凝重",
  cameraDirection: "static — 固定镜头，中景正面",
  duration: 5,
  videoScript: `${FIXTURE_CHAR_A}转身，与${FIXTURE_CHAR_D_BASE}目光相遇，二人无言对立`,
};

/** 群演场景，无主角配角 */
export const SHOT_CROWD_SCENE = {
  id: "shot_002",
  sequence: 2,
  prompt:
    "镜头从集会地面缓缓起吊，灯笼随微风轻轻摇摆，橙黄光晕在木屋墙面上来回游移；" +
    "升至屋顶高度时篝火圈全貌展开——数十名村民手牵手转圈，脚踩干草发出沙沙碎响，孩子的笑声穿过弦乐浮上来",
  startFrameDesc: "仰角拍摄集会场地和灯笼，橙黄暖光",
  endFrameDesc: "俯拍篝火圈全景，村民围圈的宏观视角",
  cameraDirection: "crane up — 镜头从集会地面缓缓起吊",
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
  prompt: `${FIXTURE_CHAR_C}奔跑过集市，穿越熙攘人群，神情焦急`,
  startFrameDesc: `${FIXTURE_CHAR_C}从远处跑来，中景跟随镜头`,
  endFrameDesc: `${FIXTURE_CHAR_C}停步，气喘吁吁，回望身后`,
  cameraDirection: "tracking — 跟随运动",
  duration: 4,
  videoScript: `${FIXTURE_CHAR_C}全速奔跑，镜头跟随`,
};

// ── Prompt enhancement fixtures ───────────────────────────────────────────────

export const RAW_VIDEO_PROMPTS = {
  seedance: {
    raw: `${FIXTURE_CHAR_A}站在悬崖边，狂风吹动衣袍，他转身离去`,
    expectedElements: ["主体", "运动", "环境", "运镜"] as string[],
  },
  kling: {
    raw: `${FIXTURE_CHAR_D_BASE}在月光下跳舞，发丝飞扬，神情空灵`,
    expectedElements: ["主体", "动作", "场景"] as string[],
  },
  gemini: {
    raw: `${FIXTURE_CHAR_A}和${FIXTURE_CHAR_C}在酒馆对峙`,
    expectedElements: ["subject", "action", "camera"] as string[],
  },
};

export const RAW_IMAGE_PROMPTS = {
  doubao: {
    raw: `${FIXTURE_CHAR_A}站在山顶，俯瞰云海，黑发飘扬`,
    expectedElements: ["画风", "主体", "光影"] as string[],
  },
  openai: {
    raw: `${FIXTURE_CHAR_D_BASE}在竹林中行走，光影婆娑`,
    expectedElements: ["subject", "lighting", "composition"] as string[],
  },
};
