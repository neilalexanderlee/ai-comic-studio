import "server-only";
import { shotFrameUsable } from "@/lib/storyboard/frame-reference.server";
import type { EpisodeVideoBlockedShot, VideoReadinessIssue } from "@/lib/storyboard/shot-video-readiness";
import type { VideoMode } from "@/lib/ai/video-capabilities";

/**
 * 单镜视频生成模式（三态）：
 *
 *   "keyframe"     — 首尾帧模式：anchorFirst + anchorLastAi 同时存在，两帧强约束（最优）
 *   "initialImage" — 严格首帧模式：仅显式 strict_start 承接镜头（像素级时序连续）
 *   "multimodal"   — 多模态参考模式：anchorFirst 作构图参考，角色定妆图锁定外貌
 *
 * 决策顺序：
 *   1. anchorLastAi 在磁盘 → "keyframe"（最强约束，两帧双锁）
 *   2. anchorFirstContinuityMode === "strict_start" → "initialImage"（像素级连续优先）
 *   3. 其余所有镜头（含群演）→ "multimodal"
 *
 * 注意：群演镜头（无命名角色）不再单独路由到 initialImage。
 *   multimodal 模式下无角色时 multimodalRefs 仅含 anchorFirst，Seedance 降级处理，无副作用。
 *   原先的 isCrowdShot 判断基于字符串匹配，不稳定且失败代价高（误判时角色跑偏 bug 复现）。
 *
 * ⚠️ 本函数返回的是**理想模式**——只看分镜数据，不考虑当前 provider 支不支持。
 *   调用方必须再过一道 `downgradeVideoMode(ideal, capability)`（`@/lib/ai/video-capabilities`），
 *   否则把 multimodal 送进 Kling / Veo / 即梦会直接崩（它们只实现了首帧和首尾帧两种 body）。
 */
export type SingleVideoMode = VideoMode;

export function resolveSingleVideoMode(
  shot: {
    anchorLastAi?: string | null;
    chainSourceShotId?: string | null;
    anchorFirstContinuityMode?: string | null;
  }
): SingleVideoMode {
  if (shotFrameUsable(shot.anchorLastAi)) return "keyframe";
  if (shot.anchorFirstContinuityMode === "strict_start") return "initialImage";
  // Legacy rows created before anchorFirstContinuityMode existed used chainSourceShotId as the strict-start signal.
  if (shot.anchorFirstContinuityMode == null && shot.chainSourceShotId) return "initialImage";
  return "multimodal";
}

type ShotForVideoScan = {
  id: string;
  sequence: number;
  anchorFirst?: string | null;
  anchorLastAi?: string | null;
  videoUrl?: string | null;
  prompt?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
};

/** @deprecated 用 resolveSingleVideoMode 替代 */
export function shouldUseFirstFrameVideoMode(
  shot: {
    anchorLastAi?: string | null;
    chainSourceShotId?: string | null;
    anchorFirstContinuityMode?: string | null;
  }
): boolean {
  return resolveSingleVideoMode(shot) !== "keyframe";
}

/**
 * 检查镜头是否具备视频生成条件（磁盘文件校验）。
 * keyframe 模式（有 AI 尾帧）本身已满足：anchorLastAi 在磁盘是进入 keyframe 的前提。
 * multimodal / initialImage 模式只需要 anchorFirst 存在。
 */
export function getShotVideoReadiness(
  shot: { anchorFirst?: string | null; anchorLastAi?: string | null }
): { ready: true } | { ready: false; issue: VideoReadinessIssue; message: string } {
  if (!shot.anchorFirst || !shotFrameUsable(shot.anchorFirst)) {
    return {
      ready: false,
      issue: "missing_anchor_first",
      message: "首帧文件不存在，请重新生成或上传首帧",
    };
  }
  return { ready: true };
}

/** 批量生成视频前预检（服务端，校验磁盘文件） */
export function listBatchVideoBlockedShotsOnDisk(
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

/** 视频提示词生成用：磁盘上存在的首帧 / AI 尾帧路径 */
export function collectVisionFramePaths(shot: {
  anchorFirst?: string | null;
  anchorLastAi?: string | null;
}): string[] {
  const paths: string[] = [];
  if (shot.anchorFirst && shotFrameUsable(shot.anchorFirst)) paths.push(shot.anchorFirst);
  if (shot.anchorLastAi && shotFrameUsable(shot.anchorLastAi)) paths.push(shot.anchorLastAi);
  return paths;
}
