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
 * 客户端预检：路径字段是否已填写（不访问 node:fs）。
 * 三态模式下视频生成只需要 anchorFirst，anchorLastAi 仅 keyframe 模式需要
 * 且 keyframe 的前提是 anchorLastAi 在磁盘存在（服务端检查），客户端不重复检查。
 */
export function getShotVideoReadiness(
  shot: { anchorFirst?: string | null; anchorLastAi?: string | null }
): { ready: true } | { ready: false; issue: VideoReadinessIssue; message: string } {
  if (!shot.anchorFirst) {
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
