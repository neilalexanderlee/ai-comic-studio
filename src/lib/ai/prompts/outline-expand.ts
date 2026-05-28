import { resolvePrompt } from "./resolver";
import { OUTLINE_EXPAND_SYSTEM_DEFAULT } from "./outline-expand-defaults";

export const OUTLINE_EXPAND_SYSTEM = OUTLINE_EXPAND_SYSTEM_DEFAULT;

export async function resolveOutlineExpandSystem(options: {
  userId: string;
  projectId?: string;
}): Promise<string> {
  return resolvePrompt("outline_expand", options);
}

export function buildOutlineExpandPrompt(outline: string): string {
  return `请将以下故事大纲扩写为完整的 S 级漫剧分镜剧本（严格遵守系统格式）：

--- 故事大纲 ---
${outline}
--- END ---

关键要求：
1. 严格使用 S 级分镜格式：每个镜头包含【背景音】【运镜】（英文）【画面】【首帧】【尾帧】【videoScript】【对白】【音效】
2. 每个镜头时长 8-15 秒，时间码连续，从 0:00 开始
3. videoScript 必须包含四要素（角色视觉ID + 单一动词 + 摄影机公式 + 感官细节），30-60字
4. 首帧/尾帧必须不同，体现镜头起止位移，用身体解剖细节表达情绪
5. 【运镜】使用英文摄影机指令（dolly/tilt/pan/crane/handheld 等）
6. 所有台词写完整，禁止使用占位符
7. 先在【角色档案】里为每个主要角色定义视觉ID字符串，全文中一致使用

现在开始输出完整剧本：`;
}
