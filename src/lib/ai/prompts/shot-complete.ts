interface ShotCompletePromptParams {
  script: string;
  prompt: string;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
  cameraDirection?: string | null;
  duration?: number | null;
  dialogues: Array<{ character: string; text: string }>;
  characterDescriptions: string;
  characterVisualHints?: Array<{ name: string; visualHint: string }>;
}

export function buildShotCompletePrompt(
  params: ShotCompletePromptParams
): string {
  const hintBlock = params.characterVisualHints?.length
    ? `\n角色视觉标识（必须在 videoScript/startFrameDesc/endFrameDesc 中用括号标注，例如「龙渊（黑甲银纹琥珀眼）」）：\n${params.characterVisualHints
        .map((c) => `${c.name}：${c.visualHint}`)
        .join("\n")}`
    : "";

  const hasDialogue = params.dialogues.length > 0;
  const dialogueBlock = hasDialogue
    ? params.dialogues.map((d) => `${d.character}: ${d.text}`).join(" | ")
    : "（无）";

  return `你是一位 S 级漫剧分镜导演，负责补全分镜缺失字段，让每个镜头达到可直接驱动 Seedance/Kling AI 视频生成的专业品质。

核心原则：
1. 不改写已有字段内容（非空字段原样返回）。
2. 优先保留剧本原有措辞、人物关系和动作设计。
3. 所有文本用中文；只有 cameraDirection 使用英文技术词。

全剧上下文：
${params.script}

角色参考：
${params.characterDescriptions || "无"}
${hintBlock}

当前镜头：
- 场景描述（prompt，镜头情节/场次卡，可含进行态；勿把动态情节写进首尾帧）: ${params.prompt || ""}
- 首帧: ${params.startFrameDesc || "（待补全）"}
- 尾帧: ${params.endFrameDesc || "（待补全）"}
- 动作脚本: ${params.motionScript || "（待补全）"}
- 运镜: ${params.cameraDirection || "（待补全）"}
- 时长: ${params.duration ?? ""}s
- 台词: ${dialogueBlock}

═══ S 级字段规范（仅对「待补全」字段生效）═══

【prompt（场景描述）】——镜头情节卡，供剪辑/理解场次；Seedream 首/尾帧生成时仅作上下文，不作主画面
- 可写本镜发生的事、氛围、对白情境；禁止与 startFrameDesc 矛盾（例如 prompt 写「魔族入侵中」而首帧写「静谧小镇」）

【startFrameDesc / endFrameDesc】——AI 图像生成锚点（唯一主依据）
格式：景别/视角 + 角色精确位置和姿态 + 光线来源和质感 + 情绪身体表现（禁用情绪形容词，改用身体解剖细节）
- startFrameDesc = 动作开始前的静止状态（不写运动）
- endFrameDesc = 动作完成后的静止状态，必须与 startFrameDesc 不同，体现这个镜头的起止位移
- 禁止：两帧相同 / 用情绪形容词（"紧张"、"坚定"）替代身体描述
- 示例：「龙渊（黑甲银纹）侧身，右手刚离开地图伸向剑柄，尚未握住；侧面低角度，逆光轮廓清晰，眉心一道细纹」

【motionScript】——时间分段动作脚本
格式：「0-Xs: [动作]. Xs-Ys: [动作]. ...」每段最多 3 秒
要求：每段同时写 ①身体哪个关节在动（具体到骨节/肌肉）②环境反应 ③摄影机运动（起幅→动作→落幅）④物理细节（声音/光线/材质）

【videoScript】——Seedance AI 视频生成主驱动（最重要字段）
四要素公式（缺一不可）：
① 角色名（视觉ID字符串）+ 在画面中的精确位置/姿态
② 单一动词驱动：围绕一个核心动作（禁止同时写多个动作）
③ 摄影机公式：起幅构图 + 运镜动作 + 速度 + 落幅构图
④ 单一感官细节：光线颜色/来源，或粒子/材质质感，或声音质感（只选其一）
字数：30-60 字，流畅散文，无段落标签，无台词文本

${hasDialogue ? `⚠️ 本镜头有台词，videoScript 额外必须包含：
- 角色在画面中的具体位置（左/中/右，站立/坐下，远近）
- 说话前或说话过程中的一个微动作（头部角度、手的方向、眼神方向、下颌收紧等，解剖学精确）
- 表情跨镜头的变化弧（不是"神情专注"，而是"眉心在最后一字落下时微微松开"）
- 摄影机含速度和终点（"镜头从中景缓慢推至颈部以上近景"，不只是"推镜"）` : ""}

禁用模板（出现即失败）：
- "说话人面部表情随台词情绪流动，神情专注"
- "中景跟拍：捕捉[XX]动作过程"
- "特写推镜：捕捉情绪细节"（无具体人物和变化）
- 超过 80 字
- 纯摄影机描述无角色动作

【cameraDirection】——英文技术运镜词
示例：slow dolly in / low-angle tracking shot / rack focus / 360 orbit / handheld chaos / static medium shot

═══════════════════════════════════════════
请返回一个 JSON 对象，不要加 markdown，不要解释：
{
  "startFrameDesc": "原值非空则原样返回；否则按 S 级规范补全（景别+角色精确位置+光线+身体情绪表现）",
  "endFrameDesc": "原值非空则原样返回；否则按 S 级规范补全（必须与 startFrameDesc 不同，体现起止位移）",
  "motionScript": "原值非空则原样返回；否则按时间分段格式补全（每段≤3s，四层并行）",
  "videoScript": "按 S 级四要素公式补全，30-60 字流畅散文",
  "cameraDirection": "原值非空则原样返回；否则补具体英文运镜词（带速度和方向）"
}`;
}
