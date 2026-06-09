import { resolvePrompt } from "./resolver";
import {
  SINGLE_SHOT_REWRITE_DEFAULT_SLOTS,
  assembleSingleShotRewriteSystem,
} from "./single-shot-rewrite-defaults";
import { getArtStylePrompt } from "./art-styles/index";

export const SINGLE_SHOT_REWRITE_SYSTEM = assembleSingleShotRewriteSystem(
  SINGLE_SHOT_REWRITE_DEFAULT_SLOTS
);

export async function resolveSingleShotRewriteSystem(
  options: { userId: string; projectId?: string },
  visualStyleTag?: string,
  visualStyle?: string
): Promise<string> {
  let system = await resolvePrompt("single_shot_rewrite", options);
  if (visualStyleTag) {
    system = system.replace(
      "{VISUAL_STYLE_LOCK}",
      `画风锁定：${visualStyleTag}`
    );
  } else {
    system = system.replace("{VISUAL_STYLE_LOCK}", "").replace(/\n\n\n+/g, "\n\n");
  }

  // 注入风格专属分镜表约束（来自 table.md：运镜禁忌/动作节奏/情绪节奏）
  if (visualStyle) {
    const tableConstraints = getArtStylePrompt(visualStyle, "table");
    if (tableConstraints) {
      // 提取关键段落（运镜禁忌/动作节奏/光影氛围），避免注入过多内容
      const sections: string[] = [];
      const sectionMatches = tableConstraints.match(/## [^\n]+\n([\s\S]*?)(?=\n##|$)/g) ?? [];
      for (const sec of sectionMatches) {
        if (/运镜禁忌|动作节奏|光影|情绪|环境动态/.test(sec)) {
          // 截取前300字避免过长
          sections.push(sec.slice(0, 300).trimEnd());
        }
      }
      if (sections.length > 0) {
        system += `\n\n━━━ 当前画风专属约束 ━━━\n${sections.join("\n\n")}`;
      }
    }
  }

  return system.trim();
}

export type SingleShotRewriteUserParams = {
  sequence: number;
  duration: number;
  prompt: string | null;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string | null;
  characterDescriptions: string;
  hasNamedChars: boolean;
};

export function buildSingleShotRewriteUserPrompt(params: SingleShotRewriteUserParams): string {
  const frameDescNamed = params.hasNamedChars
    ? "视觉重心角色的位置和姿态（静止姿态，不写运动过程）"
    : "最核心场景元素的位置";
  const frameDescMulti = params.hasNamedChars
    ? "- 多人：聚焦视觉重心最重的一个角色，次要角色最多一句\"XX随其后\""
    : "- 不堆叠多个场景层次";

  return `━━━ 当前镜头（序号 ${params.sequence}，时长 ${params.duration}s）━━━
场景描述：${params.prompt || "（空）"}
现有首帧：${params.startFrameDesc || "（空）"}
现有尾帧：${params.endFrameDesc || "（空）"}
现有动作脚本：${params.motionScript || "（空）"}
现有运镜：${params.cameraDirection || "static"}

${params.characterDescriptions ? `角色参考（仅供理解叙事，帧描述里只写名字不写外貌）：\n${params.characterDescriptions}` : ""}

【startFrameDesc / endFrameDesc】—— 给图像模型的静帧构图锚点（单一事实来源）
一帧四要素，缺一不可：景别/视角 ＋ ${frameDescNamed} ＋ 主光（颜色+方向+来源）＋ 情绪的身体解剖表现
${frameDescMulti}

【motionScript】—— 精确时间线，总时长精确等于 ${params.duration}s
▸ 开头必须写"(承接上镜: [衔接动作说明])"，首镜写"(开篇)"
▸ 末尾必须写 ｜朝向：[角色名-朝向方位]（有命名角色时必填）
▸ 自检：场景描述中的背景情节是否已写入第一段远景？首帧是否与「片中才发生」的事件时序一致？

仅返回 JSON，无 markdown 无注释：
{
  "startFrameDesc": "首帧静帧：景别/视角，主体+静止姿态，主光颜色+方向+来源，情绪的身体解剖表现",
  "endFrameDesc": "尾帧静帧：景别/视角，主体+稳定落幅姿态，与首帧有可见构图差异",
  "motionScript": "(承接上镜: 衔接说明)0-Xs: [...]. Xs-Ys: [...].｜朝向：角色名-朝向方位",
  "cameraDirection": "起幅[景别]→运动方式+速度→落幅[景别]",
  "_director_note": "（可选）仅在发现结构性问题时填写，如「角色中途入镜建议拆成两个镜头：…」；无问题则省略此字段"
}`;
}
