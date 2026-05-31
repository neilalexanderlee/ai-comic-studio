/**
 * 系统提示词模板编写规范（代码侧事实来源）。
 * 详见 docs/PROMPT-TEMPLATE-AUTHORING.md
 */

/** 禁止出现在默认模板 / registry 内置示例中的具体剧情向用语（全库扫描用） */
export const BANNED_PLOT_TERMS_IN_TEMPLATES = [
  "龙渊",
  "灵瑶",
  "白夜",
  "赤狮",
  "萝拉",
  "炎魔",
  "星落小镇",
  "星落",
  "霜魂刀",
  "霜魂斩",
  "星晶护盾",
  "麦垛",
  "草垛",
  "打谷场",
  "龙渊灵瑶",
  "龙渊父亲",
  "龙渊之母",
  "龙渊之父",
  "小灵",
] as const;

/** 默认模板源文件 glob（相对 src/lib/ai/prompts） */
export const PROMPT_TEMPLATE_SOURCE_FILES = [
  "registry.ts",
  "ref-video-prompt-defaults.ts",
  "single-shot-rewrite-defaults.ts",
  "character-extract-defaults.ts",
  "character-extract.ts",
  "import-character-extract-defaults.ts",
  "shot-split.ts",
  "outline-expand-defaults.ts",
  "frame-generate.ts",
  "frame-strategy-judge.ts",
  "script-parse.ts",
  "script-generate.ts",
  "script-split.ts",
  "video-generate.ts",
] as const;
