import type { Clip, Track } from "./clipMeta";

export function supportsWebAv(scope: { isSecureContext?: boolean; VideoDecoder?: unknown; AudioDecoder?: unknown }, storage?: { getDirectory?: unknown }): boolean {
  return scope.isSecureContext === true && typeof scope.VideoDecoder === "function" &&
    typeof scope.AudioDecoder === "function" && typeof storage?.getDirectory === "function";
}

export function mediaAtTime(clip: Clip, track: Track, time: number, muted: boolean) {
  const active = time >= clip.startTime && time < clip.endTime;
  const offset = Math.max(0, time - clip.startTime);
  const fadeIn = clip.fadeIn ? Math.min(1, offset / clip.fadeIn) : 1;
  const fadeOut = clip.fadeOut ? Math.min(1, Math.max(0, clip.endTime - time) / clip.fadeOut) : 1;
  return {
    active,
    sourceTime: (clip.trimStart ?? 0) + offset,
    volume: muted || track.muted || !active ? 0 : Math.max(0, Math.min(1, (clip.volume ?? 1) * (track.volume ?? 1) * fadeIn * fadeOut)),
  };
}
