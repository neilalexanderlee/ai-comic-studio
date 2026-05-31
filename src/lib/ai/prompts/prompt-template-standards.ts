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
  "云烟",
  "林峰",
  "翠蒂娜",
  "凌瑶",
] as const;

/** 全库 deplot 扫描时排除的路径（相对仓库根）。standards 文件含禁止词列表本身。 */
export const REPO_DEPLOT_EXCLUDE_RELATIVE = [
  "src/lib/ai/prompts/prompt-template-standards.ts",
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
