import { resolvePrompt } from "./resolver";
import {
  SINGLE_SHOT_REWRITE_DEFAULT_SLOTS,
  assembleSingleShotRewriteSystem,
} from "./single-shot-rewrite-defaults";

export const SINGLE_SHOT_REWRITE_SYSTEM = assembleSingleShotRewriteSystem(
  SINGLE_SHOT_REWRITE_DEFAULT_SLOTS
);

export async function resolveSingleShotRewriteSystem(
  options: { userId: string; projectId?: string },
  visualStyleTag?: string
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
  return system.trim();
}

export type SingleShotRewriteUserParams = {
  sequence: number;
  duration: number;
  prompt: string | null;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  videoScript: string | null;
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
现有视频脚本：${params.videoScript || "（空）"}
现有运镜：${params.cameraDirection || "static"}

${params.characterDescriptions ? `角色参考（仅供理解叙事，帧描述里只写名字不写外貌）：\n${params.characterDescriptions}` : ""}

【startFrameDesc / endFrameDesc】—— 给图像模型的静帧构图锚点（本请求上下文）
一帧 = 一个主导印象。格式：景别/视角 ＋ ${frameDescNamed} ＋ 背景关键环境元素 ＋ 主光
${frameDescMulti}

【motionScript】—— 精确时间线，总时长精确等于 ${params.duration}s

仅返回 JSON，无 markdown 无注释：
{
  "startFrameDesc": "首帧静帧：景别/视角，主体+静止姿态，背景关键环境元素，主光颜色+方向+来源",
  "endFrameDesc": "尾帧静帧：景别/视角，主体+稳定落幅姿态，背景关键环境元素，与首帧有可见构图差异",
  "motionScript": "0-Xs: [动作+镜头]. Xs-${params.duration}s: [续，总时长精确=${params.duration}s].",
  "videoScript": "导演意图一句话+核心动作+镜头运动，散文不超60字",
  "cameraDirection": "起幅[景别]→运动方式+速度→落幅[景别]"
}`;
}
