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
  /**
   * 素材源地址 —— **导出的唯一依据**。
   *
   * 服务端 ffmpeg 导出（`render/route.ts`）直接读这个字段，所以它必须始终是全分辨率源片。
   * 想让浏览器解码更轻，改 `previewUrl`，不要动这里 —— 把代理写进 url 等于让导出降级成 480p。
   */
  url?: string;
  /**
   * 低码率预览代理（480p），**仅供浏览器实时解码**（VideoPreview / 时长探测）。
   *
   * 编辑器在浏览器里用 WebCodecs 解码源片，一个 clip 动辄几十 MB：既拖慢首次可播，
   * 也把 OSS 下行流量吃穿（实测一集 15 个 clip：源片 125MB vs 代理 12.5MB）。
   * 导出路径不看这个字段。
   */
  previewUrl?: string;
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
