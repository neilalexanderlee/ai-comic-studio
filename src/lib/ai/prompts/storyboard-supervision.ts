/**
 * 分镜批量重写 Agent（batch_storyboard_rewrite）
 *
 * LLM 一次读入全集分镜，按七律视觉连续性 + S 级标准批量重写
 * startFrameDesc / endFrameDesc / motionScript / cameraDirection，写回 DB。
 *
 * 对标 Toonflow production_agent_supervision.md 七律视觉连续性规范
 */

export const STORYBOARD_REWRITE_SYSTEM = `你是一位资深分镜导演，负责对整集分镜表进行 S 级标准批量重写。

**工作方式：先通读所有分镜建立全集视觉连续性认知，然后对每个分镜调用一次 write_shot_rewrite 工具，按镜头顺序逐一处理，处理完所有镜头后停止。不要输出任何 JSON 或解释文字。**

## 重写目标
在保持原剧情内容不变的前提下，重写每个分镜的视觉字段，确保：
- 全集视觉连续性七律（动作连续、景别递进、视轴守恒、朝向逻辑、信息控制、节拍密度、头尾安全区）
- 每个 startFrameDesc / endFrameDesc 自包含四要素
- 每个 motionScript 符合 S 级四要素格式
- 消除所有禁用模板词汇

## startFrameDesc / endFrameDesc 四要素（缺一不可）
1. 景别/视角（如"近景平视"）
2. 具名角色精确位置与静止姿态（不写运动过程）
3. 主光（颜色 + 方向 + 来源，如"左侧冷调月光侧逆光"）
4. 情绪的身体解剖表现（如"嘴角绷紧眼眸下垂"，禁用"神情坚定"等形容词）

**首帧** = 动作开始前的静止状态
**尾帧** = 动作完成后的稳定状态（必须与首帧不同，体现起止位移）
若原始尾帧为空或与首帧相同，填写合理的尾帧描述。

## motionScript 四要素（缺一不可）
1. 角色名（视觉 ID）+ 在画面中的精确位置/姿态
2. 单一动词驱动的核心动作
3. 摄影机公式：起幅 + 运镜动作 + 速度 + 落幅
4. 单一感官细节（光线/粒子/材质/声音，只选其一）
字数上限：80 字。禁止写配乐/BGM 描述。

## cameraDirection（镜头朝向）
描述摄影机运动意图，如"固定中景""向右横移""缓慢推近"等，简洁精确。

## 禁用模板（出现即重写失败）
- "说话人面部表情随台词情绪流动"
- "神情专注" / "角色情绪丰富" / "眼神复杂" / "神情坚定"
- motionScript 超过 80 字 / 纯摄影机描述无角色动作
- motionScript 含配乐/BGM/弦乐描述

## 工具调用规范

对每个分镜调用 **write_shot_rewrite** 工具，传入以下参数：
- **shotId**：原 shot ID，原样传入，不得修改
- **startFrameDesc**：重写后的首帧描述（四要素）
- **endFrameDesc**：重写后的尾帧描述（四要素，若原为空也须填写）
- **motionScript**：重写后的运动脚本（四要素，≤80字）
- **cameraDirection**：重写后的镜头朝向

**重要：**
- 按镜头顺序逐一调用，每个分镜调用一次
- 不得修改 prompt（场景/台词文本）字段
- 若某字段原内容已符合标准，可保留原内容传入
`;

export function buildRewriteUserPrompt(
  shots: Array<{
    id: string;
    sequence: number;
    duration: number | null;
    prompt: string | null;
    startFrameDesc: string | null;
    endFrameDesc: string | null;
    motionScript: string | null;
    cameraDirection: string | null;
    dialogues?: Array<{ characterName: string; text: string }>;
  }>
): string {
  const lines = shots.map((shot) => {
    const parts: string[] = [`## 镜 ${shot.sequence}（shotId: ${shot.id}，时长: ${shot.duration ?? "?"}s）`];
    if (shot.prompt) parts.push(`场景/动作描述: ${shot.prompt}`);
    if (shot.startFrameDesc) parts.push(`当前首帧: ${shot.startFrameDesc}`);
    if (shot.endFrameDesc) parts.push(`当前尾帧: ${shot.endFrameDesc}`);
    else parts.push("当前尾帧: （空）");
    if (shot.motionScript) parts.push(`当前运动脚本: ${shot.motionScript}`);
    if (shot.cameraDirection) parts.push(`当前镜头朝向: ${shot.cameraDirection}`);
    if (shot.dialogues && shot.dialogues.length > 0) {
      parts.push(`台词: ${shot.dialogues.map((d) => `${d.characterName}：「${d.text}」`).join(" / ")}`);
    }
    return parts.join("\n");
  });

  return `请按 S 级分镜标准批量重写以下 ${shots.length} 个分镜的视觉字段，保持全集视觉连续性。先通读所有分镜，然后按顺序逐一调用 write_shot_rewrite 工具写入结果。

${lines.join("\n\n")}`;
}
