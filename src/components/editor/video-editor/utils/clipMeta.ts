/** Clip / Track 元数据（框架无关，基于 Toonflow-web clipMeta.ts 重写） */

export type TrackType = "video" | "audio" | "subtitle" | "bgm";

export type TransitionType =
  | "fade" | "dissolve"
  | "slide-left" | "slide-right" | "slide-up" | "slide-down"
  | "wipe-left" | "wipe-right"
  | "zoom-in" | "zoom-out"
  | "blur" | "pixelate" | "circle";

export interface SubtitleStyle {
  fontSize?: number;       // px
  color?: string;          // CSS color
  background?: string;     // CSS background (e.g. "rgba(0,0,0,0.5)")
  fontWeight?: "normal" | "bold";
  textAlign?: "left" | "center" | "right";
  x?: number;              // 0-1 相对画布宽
  y?: number;              // 0-1 相对画布高（从顶部）
  width?: number;          // 0-1 相对画布宽
}

export interface Clip {
  id: string;
  trackId: string;
  type: TrackType | "transition";
  name: string;
  startTime: number;   // seconds from timeline start
  endTime: number;     // seconds from timeline start
  duration: number;    // seconds (= endTime - startTime)

  // 视频 clip
  url?: string;
  shotId?: string;
  thumbnailUrl?: string;

  // 音频 / BGM clip
  audioUrl?: string;
  volume?: number;     // 0-2, default 1
  fadeIn?: number;     // seconds
  fadeOut?: number;    // seconds

  // 字幕 clip
  text?: string;
  subtitleStyle?: SubtitleStyle;

  // 转场 clip（夹在两个视频 clip 之间）
  transitionType?: TransitionType;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  clips: Clip[];
  muted?: boolean;
  volume?: number;   // 0-2, default 1
}

const TRACK_LABEL: Record<TrackType, string> = {
  video: "视频",
  audio: "音效",
  subtitle: "字幕",
  bgm: "背景音乐",
};

export function getTrackLabel(type: TrackType): string {
  return TRACK_LABEL[type] ?? type;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms}`;
}

export function generateClipId(): string {
  return "clip-" + Math.random().toString(36).slice(2, 9);
}

export function generateTrackId(): string {
  return "track-" + Math.random().toString(36).slice(2, 9);
}
