import { resolvePrompt } from "./resolver";
import { OUTLINE_EXPAND_SYSTEM_DEFAULT } from "./outline-expand-defaults";
import { getArtStylePrompt } from "./art-styles/index";

export const OUTLINE_EXPAND_SYSTEM = OUTLINE_EXPAND_SYSTEM_DEFAULT;

export async function resolveOutlineExpandSystem(
  options: { userId: string; projectId?: string },
  visualStyle?: string
): Promise<string> {
  let system = await resolvePrompt("outline_expand", options);

  // 注入风格导演规划（planning.md）+ 分镜表约束（table.md）
  if (visualStyle && visualStyle !== "auto") {
    const planning = getArtStylePrompt(visualStyle, "planning");
    const table = getArtStylePrompt(visualStyle, "table");

    const stylePrefix: string[] = [];

    if (planning) {
      // 提取色调/光影方案核心段落（前 600 字），作为全片规划基准
      const planningCore = planning.slice(0, 600).trimEnd();
      stylePrefix.push(`═══ 本项目导演规划（全片色调/光影基准，必须贯穿所有集） ═══\n${planningCore}\n═══ END 导演规划 ═══`);
    }

    if (table) {
      // 提取运镜禁忌 + 动作节奏段落
      const tableCore = table.slice(0, 400).trimEnd();
      stylePrefix.push(`═══ 本项目风格分镜约束 ═══\n${tableCore}\n═══ END 风格约束 ═══`);
    }

    if (stylePrefix.length > 0) {
      system = stylePrefix.join("\n\n") + "\n\n" + system;
    }
  }

  return system;
}

export type WholeDramaSourceType = "idea" | "novel";

export const NOVEL_CONDENSE_SYSTEM = `你是一名漫剧改编策划。你的任务是从小说分段中提取后续整剧改编所需的事实，不创作分镜，不续写剧情。
必须保留：角色标准名与关系、时间顺序、核心冲突、关键行动、因果关系、伏笔与结局信息。
删除：重复修辞、环境铺陈和不影响主线的细枝末节。输出简洁的中文结构化摘要。`;

export function buildNovelCondensePrompt(chunk: string, index: number, total: number): string {
  return `以下是小说第 ${index + 1}/${total} 段。请提取本段中不可丢失的改编事实，控制在 800 字以内。

--- 小说分段 ---
${chunk}
--- END ---`;
}

export function buildOutlineExpandPrompt(
  sourceText: string,
  sourceType: WholeDramaSourceType = "idea"
): string {
  const sourceLabel = sourceType === "novel" ? "小说正文或梗概" : "故事想法";
  const task = sourceType === "novel"
    ? "请将以下小说正文或梗概改编为完整的 S 级漫剧分镜剧本。保留原作核心人物关系、主线冲突与关键转折，将叙述性文字转化为可拍摄场面；允许为节奏压缩或合并支线，但不要凭空新增改变主线的重大设定。"
    : "请将以下故事想法扩写为完整的 S 级漫剧分镜剧本。补全世界观、人物弧光与多集剧情结构，但不得偏离输入中的核心冲突。";

  return `${task}（严格遵守系统格式）：

--- ${sourceLabel} ---
${sourceText}
--- END ---

关键要求：
1. 严格使用 S 级分镜格式：每个镜头包含【背景音】【运镜】（英文）【画面】【首帧】【尾帧】【motionScript】【对白】【音效】
2. 每个镜头时长 8-15 秒，时间码连续，从 0:00 开始
3. motionScript 必须使用时间线分段格式：0-Xs: [动作]. Xs-Ys: [动作]. ｜朝向：[方位]；总时长精确等于时间码时长
4. 首帧/尾帧必须不同，体现镜头起止位移，用身体解剖细节表达情绪
5. 【运镜】使用英文摄影机指令（dolly/tilt/pan/crane/handheld 等）
6. 所有台词写完整，禁止使用占位符
7. 先在【角色档案】里为每个主要角色定义视觉ID字符串，全文中一致使用

现在开始输出完整剧本：`;
}
