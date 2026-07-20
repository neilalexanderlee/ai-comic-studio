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
): "initialImage" | "keyframe" | "multimodal" {
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
