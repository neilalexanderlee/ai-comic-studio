import { COMPOSITION_VERSION, EFFECTS, TRANSITIONS } from "./composition";
import { mediaTiming } from "./timeline";
const clipKeys = [
  "id",
  "type",
  "url",
  "audioUrl",
  "startTime",
  "endTime",
  "duration",
  "trimStart",
  "trimEnd",
  "volume",
  "fadeIn",
  "fadeOut",
  "text",
  "subtitleStyle",
  "subtitleStyleOverride",
  "transitionType",
  "beforeClipId",
  "afterClipId",
  "effectType",
] as const;
/** Discard UI-only data from render requests and cache identity. Keeps legacy snapshots readable. */
export function canonicalTimeline(value: unknown) {
  const timeline = value as {
    tracks: Array<{
      type: string;
      volume?: number;
      muted?: boolean;
      clips: Array<Record<string, unknown>>;
    }>;
    canvasWidth?: number;
    canvasHeight?: number;
    globalSubtitleStyle?: unknown;
    output?: unknown;
    compositionVersion?: number;
  };
  if (!timeline || !Array.isArray(timeline.tracks) || !timeline.tracks.length)
    throw new Error("时间线为空");
  if (
    timeline.compositionVersion &&
    timeline.compositionVersion > COMPOSITION_VERSION
  )
    throw new Error("时间线版本高于当前服务器，请更新服务器");
  const tracks = timeline.tracks.map((t) => {
    if (
      !["video", "audio", "bgm", "subtitle"].includes(t.type) ||
      !Array.isArray(t.clips)
    )
      throw new Error("轨道格式无效");
    const clips = t.clips.map((c) => {
      if (
        !["video", "audio", "bgm", "subtitle", "transition"].includes(
          String(c.type),
        )
      )
        throw new Error("片段类型无效");
      const picked = Object.fromEntries(
        clipKeys.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]),
      );
      const timing = mediaTiming(picked as never);
      picked.duration = timing.duration;
      for (const key of ["volume", "fadeIn", "fadeOut"])
        if (
          c[key] !== undefined &&
          (!Number.isFinite(c[key]) || Number(c[key]) < 0)
        )
          throw new Error("片段音量或渐变参数无效");
      if (
        c.effectType &&
        !(EFFECTS as readonly unknown[]).includes(c.effectType)
      )
        throw new Error("未知画面特效");
      if (c.type === "transition" && !(String(c.transitionType) in TRANSITIONS))
        throw new Error("未知转场");
      return picked;
    });
    if (t.volume !== undefined && (!Number.isFinite(t.volume) || t.volume < 0))
      throw new Error("轨道音量无效");
    return {
      type: t.type,
      muted: t.muted ?? false,
      volume: t.volume ?? 1,
      clips,
    };
  });
  return {
    compositionVersion: COMPOSITION_VERSION,
    tracks,
    canvasWidth: timeline.canvasWidth,
    canvasHeight: timeline.canvasHeight,
    globalSubtitleStyle: timeline.globalSubtitleStyle,
    output: timeline.output,
  };
}
