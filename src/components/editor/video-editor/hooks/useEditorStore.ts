"use client";

import { create } from "zustand";
import type { Track, Clip, TrackType, TransitionType, SubtitleStyle } from "../utils/clipMeta";
import { generateClipId, generateTrackId, getTrackLabel } from "../utils/clipMeta";

interface EditorState {
  // ── 轨道数据 ────────────────────────────────────
  tracks: Track[];
  // ── 全局字幕样式 ─────────────────────────────────
  globalSubtitleStyle: SubtitleStyle;
  // ── 播放状态 ────────────────────────────────────
  playhead: number;         // 当前播放位置（秒）
  isPlaying: boolean;
  // ── 选中状态 ────────────────────────────────────
  selectedClipId: string | null;
  selectedTrackId: string | null;
  selectedClipIds: string[];       // 多选（Shift+click），用于 BGM 范围生成
  // ── 视口 ────────────────────────────────────────
  pixelsPerSecond: number;  // 缩放：每秒对应多少像素
  canvasWidth: number;
  canvasHeight: number;

  // ── 计算属性 ────────────────────────────────────
  totalDuration: () => number;
  getClipById: (clipId: string) => Clip | null;
  getTrackById: (trackId: string) => Track | null;
  getSelectedClip: () => Clip | null;
  getVideoTracks: () => Track[];
  getAudioTracks: () => Track[];

  // ── 轨道操作 ────────────────────────────────────
  addTrack: (type: TrackType, name?: string) => Track;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;

  // ── Clip 操作 ────────────────────────────────────
  addClip: (trackId: string, clip: Omit<Clip, "id" | "trackId" | "endTime">) => Clip;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  moveClip: (clipId: string, newStartTime: number, newTrackId?: string) => void;
  resizeClip: (clipId: string, newStartTime: number, newEndTime: number) => void;

  // ── 转场 ────────────────────────────────────────
  addTransition: (prevClipId: string, nextClipId: string, type: TransitionType, duration?: number) => void;

  // ── 播放控制 ────────────────────────────────────
  setPlayhead: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (pps: number) => void;

  // ── 选中 ────────────────────────────────────────
  selectClip: (clipId: string | null) => void;
  toggleMultiSelectClip: (clipId: string) => void;
  clearMultiSelect: () => void;

  // ── 从项目分镜初始化 ─────────────────────────────
  initFromShots: (shots: Array<{
    id: string;
    sequence: number;
    prompt: string;
    videoUrl: string | null;
    duration: number;
    bgmNote?: string | null;
    dialogues?: Array<{ characterName: string; text: string; type?: string }>;
  }>) => void;

  // ── 从 DB 快照恢复 ────────────────────────────────
  loadFromSnapshot: (tracks: Track[]) => void;

  // ── 全局字幕样式 ─────────────────────────────────
  /** 更新全局字幕样式；applyToAll=true 时同时把所有字幕 clip 的 subtitleStyle 更新为新值 */
  setGlobalSubtitleStyle: (style: Partial<SubtitleStyle>, applyToAll?: boolean) => void;

  // ── 清空 ─────────────────────────────────────────
  reset: () => void;
}

const MAX_TRACK_COUNTS: Record<TrackType, number> = {
  video: 5,
  audio: 3,
  subtitle: 2,
  bgm: 1,
};

const DEFAULT_GLOBAL_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 32,
  color: "#ffffff",
  textAlign: "center",
  y: 0.82,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  tracks: [],
  globalSubtitleStyle: { ...DEFAULT_GLOBAL_SUBTITLE_STYLE },
  playhead: 0,
  isPlaying: false,
  selectedClipId: null,
  selectedTrackId: null,
  selectedClipIds: [],
  pixelsPerSecond: 80,
  canvasWidth: 1920,
  canvasHeight: 1080,

  // ── 计算属性 ──────────────────────────────────────────────────────────────

  totalDuration: () => {
    const { tracks } = get();
    let max = 0;
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.endTime > max) max = clip.endTime;
      }
    }
    return max;
  },

  getClipById: (clipId) => {
    for (const track of get().tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  },

  getTrackById: (trackId) => get().tracks.find((t) => t.id === trackId) ?? null,

  getSelectedClip: () => {
    const { selectedClipId } = get();
    if (!selectedClipId) return null;
    return get().getClipById(selectedClipId);
  },

  getVideoTracks: () => get().tracks.filter((t) => t.type === "video"),
  getAudioTracks: () => get().tracks.filter((t) => t.type === "audio" || t.type === "bgm"),

  // ── 轨道操作 ──────────────────────────────────────────────────────────────

  addTrack: (type, name) => {
    const { tracks } = get();
    const sameType = tracks.filter((t) => t.type === type);
    const max = MAX_TRACK_COUNTS[type] ?? 3;
    if (sameType.length >= max) {
      throw new Error(`最多支持 ${max} 条${getTrackLabel(type)}轨道`);
    }
    const newTrack: Track = {
      id: generateTrackId(),
      type,
      name: name ?? `${getTrackLabel(type)} ${sameType.length + 1}`,
      clips: [],
      volume: 1,
    };
    set({ tracks: [...tracks, newTrack] });
    return newTrack;
  },

  removeTrack: (trackId) => {
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== trackId) }));
  },

  updateTrack: (trackId, updates) => {
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...updates } : t)),
    }));
  },

  // ── Clip 操作 ──────────────────────────────────────────────────────────────

  addClip: (trackId, clipData) => {
    const newClip: Clip = {
      ...clipData,
      id: generateClipId(),
      trackId,
      endTime: clipData.startTime + clipData.duration,
    };
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t
      ),
    }));
    return newClip;
  },

  removeClip: (clipId) => {
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
      })),
      selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
    }));
  },

  updateClip: (clipId, updates) => {
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          const updated = { ...c, ...updates };
          // 保持 endTime 与 startTime + duration 同步
          if (updates.duration !== undefined && updates.endTime === undefined) {
            updated.endTime = updated.startTime + updated.duration;
          } else if (updates.startTime !== undefined && updates.endTime === undefined) {
            updated.endTime = updated.startTime + updated.duration;
          }
          return updated;
        }),
      })),
    }));
  },

  moveClip: (clipId, newStartTime, newTrackId) => {
    const clip = get().getClipById(clipId);
    if (!clip) return;
    const duration = clip.duration;
    if (newTrackId && newTrackId !== clip.trackId) {
      // 跨轨道移动
      set((s) => ({
        tracks: s.tracks.map((t) => {
          if (t.id === clip.trackId) {
            return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
          }
          if (t.id === newTrackId) {
            const moved = { ...clip, trackId: newTrackId, startTime: newStartTime, endTime: newStartTime + duration };
            return { ...t, clips: [...t.clips, moved] };
          }
          return t;
        }),
      }));
    } else {
      get().updateClip(clipId, { startTime: newStartTime, endTime: newStartTime + duration });
    }
  },

  resizeClip: (clipId, newStartTime, newEndTime) => {
    const duration = newEndTime - newStartTime;
    get().updateClip(clipId, { startTime: newStartTime, endTime: newEndTime, duration });
  },

  // ── 转场 ──────────────────────────────────────────────────────────────────

  addTransition: (prevClipId, nextClipId, type, duration = 1) => {
    const prevClip = get().getClipById(prevClipId);
    const nextClip = get().getClipById(nextClipId);
    if (!prevClip || !nextClip || prevClip.trackId !== nextClip.trackId) return;
    const half = duration / 2;
    const transitionStart = prevClip.endTime - half;
    const transitionEnd = nextClip.startTime + half;
    const transitionClip: Clip = {
      id: generateClipId(),
      trackId: prevClip.trackId,
      type: "transition",
      name: type,
      startTime: transitionStart,
      endTime: transitionEnd,
      duration,
      transitionType: type,
    };
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === prevClip.trackId
          ? { ...t, clips: [...t.clips, transitionClip] }
          : t
      ),
    }));
  },

  // ── 播放控制 ──────────────────────────────────────────────────────────────

  setPlayhead: (time) => set({ playhead: Math.max(0, time) }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setZoom: (pps) => set({ pixelsPerSecond: Math.max(10, Math.min(500, pps)) }),
  selectClip: (clipId) => {
    if (!clipId) {
      set({ selectedClipId: null, selectedClipIds: [] });
      return;
    }
    // 选中 clip 时 playhead 自动跳到该 clip 开头（NLE 标准行为）
    const clip = get().getClipById(clipId);
    set({
      selectedClipId: clipId,
      selectedClipIds: [],
      ...(clip ? { playhead: clip.startTime } : {}),
    });
  },

  toggleMultiSelectClip: (clipId) => {
    set((s) => {
      const ids = s.selectedClipIds;
      return {
        selectedClipIds: ids.includes(clipId)
          ? ids.filter((id) => id !== clipId)
          : [...ids, clipId],
        selectedClipId: null, // 多选时清空单选
      };
    });
  },

  clearMultiSelect: () => set({ selectedClipIds: [] }),

  setGlobalSubtitleStyle: (style, applyToAll = false) => {
    set((s) => {
      const next = { ...s.globalSubtitleStyle, ...style };
      if (!applyToAll) return { globalSubtitleStyle: next };
      // 同时把所有字幕 clip 的 subtitleStyle 更新为新值
      return {
        globalSubtitleStyle: next,
        tracks: s.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.type === "subtitle" ? { ...c, subtitleStyle: { ...next } } : c
          ),
        })),
      };
    });
  },

  // ── 从项目分镜初始化 ──────────────────────────────────────────────────────

  initFromShots: (shots) => {
    const state = get();
    if (state.tracks.length > 0) return; // 已初始化，跳过

    // 创建主视频轨道
    const videoTrack: Track = {
      id: generateTrackId(),
      type: "video",
      name: "视频 1",
      clips: [],
      volume: 1,
    };

    // 创建字幕轨道
    const subtitleTrack: Track = {
      id: generateTrackId(),
      type: "subtitle",
      name: "字幕",
      clips: [],
    };

    let cursor = 0;
    const videoClips: Clip[] = [];
    const subtitleClips: Clip[] = [];

    for (const shot of shots) {
      if (!shot.videoUrl) continue;
      const duration = shot.duration || 10;
      const clipId = generateClipId();

      videoClips.push({
        id: clipId,
        trackId: videoTrack.id,
        type: "video",
        name: `分镜 ${shot.sequence}`,
        url: shot.videoUrl,
        shotId: shot.id,
        bgmNote: shot.bgmNote ?? undefined,
        startTime: cursor,
        endTime: cursor + duration,
        duration,
      });

      // 台词 → 字幕（按字数加权分配时长，最短 1.2s / 条）
      if (shot.dialogues?.length) {
        const MIN_SUB = 1.2;
        const totalChars = shot.dialogues.reduce((s, d) => s + (d.text?.length ?? 1), 0) || 1;
        // 先按字数算出原始比例，再保证每条 ≥ MIN_SUB，然后等比缩放使总和 = duration
        const rawDurs = shot.dialogues.map((d) =>
          Math.max(MIN_SUB, ((d.text?.length ?? 1) / totalChars) * duration)
        );
        const rawTotal = rawDurs.reduce((s, v) => s + v, 0);
        const scale = rawTotal > 0 ? duration / rawTotal : 1;
        let dCursor = cursor;
        shot.dialogues.forEach((d, i) => {
          const dDuration = Math.max(MIN_SUB, rawDurs[i] * scale);
          const capped = Math.min(dDuration, cursor + duration - dCursor);
          if (capped < 0.3) return;
          // 行业惯例：字幕只显示台词文本，不加角色名前缀，不加引号
          // VO/OS 加括号标注类型，普通对白直接输出台词
          const rawText = (d.text ?? "").replace(/^[「『【]|[」』】]$/g, "").trim();
          const text = d.type === "os"
            ? `（内心）${rawText}`
            : d.type === "vo"
            ? `（旁白）${rawText}`
            : rawText;
          subtitleClips.push({
            id: generateClipId(),
            trackId: subtitleTrack.id,
            type: "subtitle",
            name: text.slice(0, 20),
            text,
            startTime: dCursor,
            endTime: dCursor + capped,
            duration: capped,
            subtitleStyle: {
              fontSize: 32,
              color: "#ffffff",
              background: "rgba(0,0,0,0.55)",
              textAlign: "center",
              x: 0.1,
              y: 0.82,
              width: 0.8,
            },
          });
          dCursor += capped;
        });
      }

      cursor += duration;
    }

    videoTrack.clips = videoClips;
    subtitleTrack.clips = subtitleClips;

    const tracks: Track[] = [videoTrack];
    if (subtitleClips.length > 0) tracks.push(subtitleTrack);

    set({ tracks, playhead: 0 });
  },

  loadFromSnapshot: (tracks) => set({ tracks, playhead: 0, selectedClipId: null, selectedClipIds: [] }),

  reset: () => set({ tracks: [], globalSubtitleStyle: { ...DEFAULT_GLOBAL_SUBTITLE_STYLE }, playhead: 0, isPlaying: false, selectedClipId: null }),
}));
