/** Clip / Track 元数据类型与时间线通用小工具（框架无关，供编辑器各组件共用） */

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
  bgmNote?: string;       // 来自分镜的 bgmNote，用于多选后自动填 BGM prompt
  /** 素材内部裁剪起点（秒），默认 0 */
  trimStart?: number;
  /** 素材内部裁剪终点（秒），默认 = 素材总时长 */
  trimEnd?: number;

  // 音频 / BGM clip
  audioUrl?: string;
  volume?: number;     // 0-2, default 1
  fadeIn?: number;     // seconds
  fadeOut?: number;    // seconds
  /** 波形采样数据（0-1 归一化），由 Web Audio API 生成，用于时间线可视化 */
  waveformData?: number[];

  // 字幕 clip
  text?: string;
  subtitleStyle?: SubtitleStyle;

  // 转场 clip（夹在两个视频 clip 之间）
  transitionType?: TransitionType;

  // 画面特效（应用于视频 clip 整个时长）
  effectType?: "fadeIn" | "fadeOut" | "flash" | "shake" | "zoomIn" | "zoomOut" | "pulse" | "rotateIn";
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
