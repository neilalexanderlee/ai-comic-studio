import { mediaGain, mediaTiming } from "@/lib/video/timeline";
import type { Clip, Track } from "./clipMeta";

export function mediaAtTime(clip: Clip, track: Track, time: number, muted: boolean) {
  const timing = mediaTiming(clip);
  const offset = Math.max(0, time - clip.startTime);
  const sourceTime = timing.sourceStart + offset;
  const active = time >= clip.startTime && time < clip.endTime && sourceTime < timing.sourceEnd;
  return { active, sourceTime, volume: muted || !active ? 0 : mediaGain(clip, track, offset) };
}
