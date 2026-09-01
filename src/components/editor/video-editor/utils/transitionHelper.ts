/**
 * 转场工具函数：定位时间点两侧相邻的视频 clip，以及 UI 可选的转场类型清单。
 */
import type { Clip, Track, TransitionType } from "./clipMeta";

/** 找到指定时间点两侧相邻的两个视频 clip */
export function findAdjacentClipsAtTime(
  track: Track,
  timeInSeconds: number,
): { prevClip: Clip | null; nextClip: Clip | null } {
  const videoClips = track.clips
    .filter((c) => c.type === "video")
    .sort((a, b) => a.startTime - b.startTime);

  let prevClip: Clip | null = null;
  let nextClip: Clip | null = null;

  for (const clip of videoClips) {
    if (clip.endTime <= timeInSeconds) {
      prevClip = clip;
    } else if (clip.startTime >= timeInSeconds && !nextClip) {
      nextClip = clip;
    }
  }
  return { prevClip, nextClip };
}

/** 获取所有可用转场类型（UI 展示用） */
export const TRANSITION_OPTIONS: { type: TransitionType; label: string }[] = [
  { type: "fade", label: "淡入淡出" },
  { type: "dissolve", label: "溶解" },
  { type: "slide-left", label: "向左滑入" },
  { type: "slide-right", label: "向右滑入" },
  { type: "slide-up", label: "向上滑入" },
  { type: "slide-down", label: "向下滑入" },
  { type: "wipe-left", label: "向左擦除" },
  { type: "wipe-right", label: "向右擦除" },
  { type: "zoom-in", label: "放大进入" },
  { type: "zoom-out", label: "缩小进入" },
  { type: "blur", label: "模糊过渡" },
  { type: "pixelate", label: "像素化" },
  { type: "circle", label: "圆形擦除" },
];
