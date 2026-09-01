/**
 * 轨道空间工具函数：区间占用判断、末尾追加点、边界吸附、总时长计算。
 * 全部基于本项目的 Clip / Track 类型（见 clipMeta.ts）。
 */
import type { Track, Clip } from "./clipMeta";

/** 检查轨道在 [startTime, startTime+duration] 内是否有足够空间（不与已有 clip 重叠） */
export function hasSpaceInTrack(track: Track, startTime: number, duration: number): boolean {
  const endTime = startTime + duration;
  for (const clip of track.clips) {
    if (clip.type === "transition") continue;
    if (startTime < clip.endTime && endTime > clip.startTime) return false;
  }
  return true;
}

/** 计算轨道上可以插入新 clip 的起始时间（追加到末尾） */
export function getTrackEndTime(track: Track): number {
  return track.clips.reduce((max, c) => Math.max(max, c.endTime), 0);
}

/** 找到距离 dropTime 最近的可用插入点（对齐到已有 clip 边界） */
export function snapToClipBoundary(
  track: Track,
  targetTime: number,
  snapThreshold = 0.3
): number {
  let bestTime = targetTime;
  let bestDist = snapThreshold;

  for (const clip of track.clips) {
    const distStart = Math.abs(clip.startTime - targetTime);
    const distEnd = Math.abs(clip.endTime - targetTime);
    if (distStart < bestDist) { bestDist = distStart; bestTime = clip.startTime; }
    if (distEnd < bestDist) { bestDist = distEnd; bestTime = clip.endTime; }
  }
  return bestTime;
}

/** 计算整个时间线的总时长（所有轨道所有 clip 的最大 endTime） */
export function calcTotalDuration(tracks: Track[]): number {
  return tracks.reduce((max, t) =>
    t.clips.reduce((m2, c) => Math.max(m2, c.endTime), max), 0);
}
