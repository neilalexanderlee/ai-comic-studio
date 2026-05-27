import "server-only";
import { shotFrameFileOnDisk } from "@/lib/storyboard/frame-reference.server";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";
import type { EpisodeVideoBlockedShot, VideoReadinessIssue } from "@/lib/storyboard/shot-video-readiness";

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

export function shouldUseFirstFrameVideoMode(
  shot: { anchorLastAi?: string | null },
  isCrowdShot: boolean
): boolean {
  if (isCrowdShot) return true;
  return !shotFrameFileOnDisk(shot.anchorLastAi);
}

export function getShotVideoReadiness(
  shot: { anchorFirst?: string | null; anchorLastAi?: string | null },
  isCrowdShot: boolean
): { ready: true } | { ready: false; issue: VideoReadinessIssue; message: string } {
  if (!shot.anchorFirst || !shotFrameFileOnDisk(shot.anchorFirst)) {
    return {
      ready: false,
      issue: "missing_anchor_first",
      message: "首帧文件不存在，请重新生成或上传首帧",
    };
  }
  if (!shouldUseFirstFrameVideoMode(shot, isCrowdShot) && !shotFrameFileOnDisk(shot.anchorLastAi)) {
    return {
      ready: false,
      issue: "missing_anchor_last_ai",
      message: "AI 尾帧文件不存在，请重新生成尾帧",
    };
  }
  return { ready: true };
}

/** 批量生成视频前预检（服务端，校验磁盘文件） */
export function listBatchVideoBlockedShotsOnDisk(
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

/** 视频提示词生成用：磁盘上存在的首帧 / AI 尾帧路径 */
export function collectVisionFramePaths(shot: {
  anchorFirst?: string | null;
  anchorLastAi?: string | null;
}): string[] {
  const paths: string[] = [];
  if (shot.anchorFirst && shotFrameFileOnDisk(shot.anchorFirst)) paths.push(shot.anchorFirst);
  if (shot.anchorLastAi && shotFrameFileOnDisk(shot.anchorLastAi)) paths.push(shot.anchorLastAi);
  return paths;
}
