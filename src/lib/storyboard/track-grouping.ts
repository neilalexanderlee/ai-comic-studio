/**
 * Track 分组：将同集/同版本的分镜按累计时长 ≤ MAX_TRACK_DURATION 分组。
 * 每组将在 Seedance 多参模式下一次性生成连贯视频。
 *
 * 规则（移植自 Toonflow production_execution_storyboard_panel.md，含场景边界修订）：
 * - 累计时长 ≤ MAX_TRACK_DURATION（默认 15s）的相邻分镜归为一组
 * - 单镜超过 MAX_TRACK_DURATION → 独立成一组
 * - sceneId 变化 → 强制断 Track（场景切换不应共享同一次多参生成）
 * - 分组结果写入 shots.track 字段（T1、T2 等）
 */

export const MAX_TRACK_DURATION = 15; // 秒

type ShotForGrouping = {
  id: string;
  sequence: number;
  duration: number;
  sceneId?: string | null;
};

export type TrackGroup = {
  trackId: string;         // "T1" / "T2" ...
  shots: ShotForGrouping[];
  totalDuration: number;
};

/**
 * 将分镜列表按累计时长 ≤ maxDuration 分组，并在场景边界处强制切断。
 * 输入 shots 必须已按 sequence 升序排列。
 */
export function groupShotsIntoTracks(
  shots: ShotForGrouping[],
  maxDuration: number = MAX_TRACK_DURATION
): TrackGroup[] {
  const groups: TrackGroup[] = [];
  let current: ShotForGrouping[] = [];
  let currentDuration = 0;
  let currentSceneId: string | null | undefined = undefined;
  let trackIndex = 1;

  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      trackId: `T${trackIndex++}`,
      shots: current,
      totalDuration: currentDuration,
    });
    current = [];
    currentDuration = 0;
    currentSceneId = undefined;
  };

  for (const shot of shots) {
    const d = shot.duration ?? 10;
    const sceneChanged =
      currentSceneId !== undefined &&
      shot.sceneId != null &&
      currentSceneId != null &&
      shot.sceneId !== currentSceneId;

    if (current.length === 0) {
      current.push(shot);
      currentDuration = d;
      currentSceneId = shot.sceneId;
    } else if (!sceneChanged && currentDuration + d <= maxDuration) {
      current.push(shot);
      currentDuration += d;
      // 若当前组 sceneId 未定（上一镜无 sceneId），用本镜填充
      if (currentSceneId == null && shot.sceneId != null) {
        currentSceneId = shot.sceneId;
      }
    } else {
      // 场景切换 or 时长超限 → 关闭当前组
      flush();
      current.push(shot);
      currentDuration = d;
      currentSceneId = shot.sceneId;
    }
  }

  flush();

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
