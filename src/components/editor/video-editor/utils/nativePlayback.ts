import { mediaGain } from "@/lib/video/timeline";
import type { Clip, Track } from "./clipMeta";

export function supportsWebAv(scope: { isSecureContext?: boolean; VideoDecoder?: unknown; AudioDecoder?: unknown }, storage?: { getDirectory?: unknown }): boolean {
  return scope.isSecureContext === true && typeof scope.VideoDecoder === "function" &&
    typeof scope.AudioDecoder === "function" && typeof storage?.getDirectory === "function";
}

export function mediaAtTime(clip: Clip, track: Track, time: number, muted: boolean) {
  const active = time >= clip.startTime && time < clip.endTime &&
    (clip.trimEnd === undefined || (clip.trimStart ?? 0) + time - clip.startTime < clip.trimEnd);
  const offset = Math.max(0, time - clip.startTime);
  return {
    active,
    sourceTime: (clip.trimStart ?? 0) + offset,
    volume: muted || track.muted || !active ? 0 : mediaGain(clip, track, offset),
  };
}
