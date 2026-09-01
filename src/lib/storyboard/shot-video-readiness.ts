import type { VideoMode } from "@/lib/ai/video-capabilities";

export type EpisodeVideoBlockedShot = {
  shotId: string;
  sequence: number;
  issue: VideoReadinessIssue;
  message: string;
};

type ShotForVideoScan = {
  id: string;
  sequence: number;
  anchorFirst?: string | null;
  anchorLastAi?: string | null;
  videoUrl?: string | null;
};

export type VideoReadinessIssue = "missing_anchor_first" | "missing_anchor_last_ai";

/**
 * 客户端版三态模式判定（与 shot-video-readiness.server.ts 的 resolveSingleVideoMode 对齐，
 * 差异仅在于这里不能访问 node:fs，用字段是否有值代替磁盘存在性检查）。
 */
function resolveSingleVideoModeClient(
  shot: {
    anchorLastAi?: string | null;
    chainSourceShotId?: string | null;
    anchorFirstContinuityMode?: string | null;
  }
): VideoMode {
  if (shot.anchorLastAi) return "keyframe";
  if (shot.anchorFirstContinuityMode === "strict_start") return "initialImage";
  if (shot.anchorFirstContinuityMode == null && shot.chainSourceShotId) return "initialImage";
  return "multimodal";
}

/**
 * 客户端预检：路径字段是否已填写（不访问 node:fs）。
 * 只有 keyframe（有 AI 尾帧）/ initialImage（严格首帧承接）模式才要求 anchorFirst；
 * multimodal 模式（默认/多数镜头）下 anchorFirst 只是可选的构图参考，服务端会在缺失时
 * 优雅降级为纯文字提示词 + 角色定妆图生成，不应该在这里就把按钮锁死。
 */
export function getShotVideoReadiness(
  shot: {
    anchorFirst?: string | null;
    anchorLastAi?: string | null;
    chainSourceShotId?: string | null;
    anchorFirstContinuityMode?: string | null;
  }
): { ready: true } | { ready: false; issue: VideoReadinessIssue; message: string } {
  const mode = resolveSingleVideoModeClient(shot);
  if (mode !== "multimodal" && !shot.anchorFirst) {
    return {
      ready: false,
      issue: "missing_anchor_first",
      message: "首帧文件不存在，请重新生成或上传首帧",
    };
  }
  return { ready: true };
}

export type ShotNextStep = "frame" | "prompt" | "video" | null;

/**
 * "推荐下一步"状态机，驱动主页面/drawer 三个按钮里哪个显示为高亮（default 变体，红色）。
 * 只是引导性建议：即使 multimodal 模式下首帧不是硬性前提，先生成首帧对视频质量仍有帮助，
 * 所以这里继续把「画面→提示词→视频」当默认推荐顺序，不因为首帧变可选就改变推荐顺序。
 *
 * 重要：这个函数只决定按钮"是不是红色"，不决定按钮"能不能点"——能不能点必须看各自
 * 真实的后端前提（提示词生成不需要首帧；视频生成看 getShotVideoReadiness 的三态判断），
 * 不要把这里的返回值拿去当 disabled 条件用。主页面与 drawer 必须共用这一份实现，
 * 不要各自再写一遍，否则会重新出现两边判断条件不同步的问题。
 */
export function resolveShotNextStep(
  shot: {
    anchorFirst?: string | null;
    anchorLastAi?: string | null;
    cutPoint?: string | null;
    videoPrompt?: string | null;
    videoUrl?: string | null;
  }
): ShotNextStep {
  const hasFrame = !!(shot.anchorFirst || shot.anchorLastAi || shot.cutPoint);
  if (!hasFrame) return "frame";
  if (!shot.videoPrompt) return "prompt";
  if (!shot.videoUrl) return "video";
  return null;
}

/** @deprecated isCrowdShot 已移除，用无参版本 getShotVideoReadiness */
export function shouldUseFirstFrameVideoMode(
  shot: { anchorLastAi?: string | null }
): boolean {
  return !shot.anchorLastAi;
}

/** 批量生成视频前预检（UI）：与 generate 路由字段条件对齐 */
export function listBatchVideoBlockedShots(
  shots: ShotForVideoScan[],
  _characters: { id: string; name: string; description?: string | null; visualHint?: string | null }[],
  mode: "new_only" | "overwrite"
): EpisodeVideoBlockedShot[] {
  const blocked: EpisodeVideoBlockedShot[] = [];
  for (const shot of shots) {
    const eligible =
      mode === "overwrite" ? !!shot.anchorFirst : !shot.videoUrl && !!shot.anchorFirst;
    if (!eligible) continue;

    const readiness = getShotVideoReadiness(shot);
    if (!readiness.ready) {
      blocked.push({
        shotId: shot.id,
        sequence: shot.sequence,
        issue: readiness.issue,
        message: readiness.message,
      });
    }
  }
  return blocked.sort((a, b) => a.sequence - b.sequence);
}
