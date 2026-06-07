/**
 * Track 分组：将同集/同版本的分镜按累计时长 ≤ MAX_TRACK_DURATION 分组。
 * 每组将在 Seedance 多参模式下一次性生成连贯视频。
 *
 * 规则（移植自 Toonflow production_execution_storyboard_panel.md）：
 * - 累计时长 ≤ MAX_TRACK_DURATION（默认 15s）的相邻分镜归为一组
 * - 单镜超过 MAX_TRACK_DURATION → 独立成一组
 * - 分组结果写入 shots.track 字段（T1、T2 等）
 */

export const MAX_TRACK_DURATION = 15; // 秒

type ShotForGrouping = {
  id: string;
  sequence: number;
  duration: number;
};

export type TrackGroup = {
  trackId: string;         // "T1" / "T2" ...
  shots: ShotForGrouping[];
  totalDuration: number;
};

/**
 * 将分镜列表按累计时长 ≤ maxDuration 分组。
 * 输入 shots 必须已按 sequence 升序排列。
 */
export function groupShotsIntoTracks(
  shots: ShotForGrouping[],
  maxDuration: number = MAX_TRACK_DURATION
): TrackGroup[] {
  const groups: TrackGroup[] = [];
  let current: ShotForGrouping[] = [];
  let currentDuration = 0;
  let trackIndex = 1;

  for (const shot of shots) {
    const d = shot.duration ?? 10;

    if (current.length === 0) {
      current.push(shot);
      currentDuration = d;
    } else if (currentDuration + d <= maxDuration) {
      current.push(shot);
      currentDuration += d;
    } else {
      // 当前组已满，关闭并开新组
      groups.push({
        trackId: `T${trackIndex++}`,
        shots: current,
        totalDuration: currentDuration,
      });
      current = [shot];
      currentDuration = d;
    }
  }

  if (current.length > 0) {
    groups.push({
      trackId: `T${trackIndex}`,
      shots: current,
      totalDuration: currentDuration,
    });
  }

  return groups;
}

/**
 * 将 TrackGroup 数组转换为 shotId → trackId 的 Map，
 * 供路由层批量更新 shots.track 字段。
 */
export function buildShotTrackMap(groups: TrackGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const shot of group.shots) {
      map.set(shot.id, group.trackId);
    }
  }
  return map;
}
