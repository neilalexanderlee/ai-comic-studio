/** Shared source/timeline mapping. duration is derived from the timeline endpoints. */
export interface TimedMedia {
  startTime: number; endTime: number; duration: number;
  trimStart?: number; trimEnd?: number;
  volume?: number; fadeIn?: number; fadeOut?: number;
}
export function mediaTiming(clip: TimedMedia) {
  const duration = clip.endTime - clip.startTime;
  const sourceStart = clip.trimStart ?? 0;
  const sourceEnd = Math.min(clip.trimEnd ?? sourceStart + duration, sourceStart + duration);
  if (![clip.startTime, duration, sourceStart, sourceEnd].every(Number.isFinite) ||
      clip.startTime < 0 || duration <= 0 || sourceStart < 0 || sourceEnd <= sourceStart) {
    throw new Error("片段时间范围无效，请检查裁剪起止位置");
  }
  return { duration, sourceStart, sourceEnd };
}
export function mediaGain(clip: TimedMedia, track: { muted?: boolean; volume?: number }, offset: number) {
  const duration = clip.endTime - clip.startTime;
  const fadeIn = clip.fadeIn ? Math.min(1, Math.max(0, offset) / clip.fadeIn) : 1;
  const fadeOut = clip.fadeOut ? Math.min(1, Math.max(0, duration - offset) / clip.fadeOut) : 1;
  return track.muted ? 0 : Math.max(0, (clip.volume ?? 1) * (track.volume ?? 1) * fadeIn * fadeOut);
}
