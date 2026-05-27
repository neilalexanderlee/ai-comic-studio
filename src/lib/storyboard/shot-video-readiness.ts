import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";

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
  prompt?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  videoScript?: string | null;
  motionScript?: string | null;
};

function buildShotText(shot: ShotForVideoScan): string {
  return [shot.prompt, shot.startFrameDesc, shot.endFrameDesc, shot.videoScript, shot.motionScript]
    .filter(Boolean)
    .join(" ");
}

/**
 * 首帧参考图视频模式：仅用 anchor_first；群演或无 AI 尾帧路径时启用。
 * 客户端仅检查 DB 路径字段，磁盘存在性由生成 API 最终校验。
 */
export function shouldUseFirstFrameVideoMode(
  shot: { anchorLastAi?: string | null },
  isCrowdShot: boolean
): boolean {
  if (isCrowdShot) return true;
  return !shot.anchorLastAi;
}

export type VideoReadinessIssue = "missing_anchor_first" | "missing_anchor_last_ai";

/** 客户端预检：路径字段是否已填写（不访问 node:fs） */
export function getShotVideoReadiness(
  shot: { anchorFirst?: string | null; anchorLastAi?: string | null },
  isCrowdShot: boolean
): { ready: true } | { ready: false; issue: VideoReadinessIssue; message: string } {
  if (!shot.anchorFirst) {
    return {
      ready: false,
      issue: "missing_anchor_first",
      message: "首帧文件不存在，请重新生成或上传首帧",
    };
  }
  if (!shouldUseFirstFrameVideoMode(shot, isCrowdShot) && !shot.anchorLastAi) {
    return {
      ready: false,
      issue: "missing_anchor_last_ai",
      message: "AI 尾帧文件不存在，请重新生成尾帧",
    };
  }
  return { ready: true };
}

/** 批量生成视频前预检（UI）：与 generate 路由字段条件对齐 */
export function listBatchVideoBlockedShots(
  shots: ShotForVideoScan[],
  characters: { id: string; name: string; description?: string | null; visualHint?: string | null }[],
  mode: "new_only" | "overwrite"
): EpisodeVideoBlockedShot[] {
  const blocked: EpisodeVideoBlockedShot[] = [];
  for (const shot of shots) {
    const eligible =
      mode === "overwrite" ? !!shot.anchorFirst : !shot.videoUrl && !!shot.anchorFirst;
    if (!eligible) continue;

    const isCrowdShot = filterShotCharacters(buildShotText(shot), characters).length === 0;
    const readiness = getShotVideoReadiness(shot, isCrowdShot);
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
