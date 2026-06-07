"use client";

import { create } from "zustand";
import type { Track, Clip, TrackType, TransitionType } from "../utils/clipMeta";
import { generateClipId, generateTrackId, getTrackLabel } from "../utils/clipMeta";

interface EditorState {
  // ── 轨道数据 ────────────────────────────────────
  tracks: Track[];
  // ── 播放状态 ────────────────────────────────────
  playhead: number;         // 当前播放位置（秒）
  isPlaying: boolean;
  // ── 选中状态 ────────────────────────────────────
  selectedClipId: string | null;
  selectedTrackId: string | null;
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

  // ── 从项目分镜初始化 ─────────────────────────────
  initFromShots: (shots: Array<{
    id: string;
    sequence: number;
    prompt: string;
    videoUrl: string | null;
    duration: number;
    dialogues?: Array<{ characterName: string; text: string; type?: string }>;
  }>) => void;

  // ── 清空 ─────────────────────────────────────────
  reset: () => void;
}

const MAX_TRACK_COUNTS: Record<TrackType, number> = {
  video: 5,
  audio: 3,
  subtitle: 2,
  bgm: 1,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  tracks: [],
  playhead: 0,
  isPlaying: false,
  selectedClipId: null,
  selectedTrackId: null,
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
  selectClip: (clipId) => set({ selectedClipId: clipId }),

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
        startTime: cursor,
        endTime: cursor + duration,
        duration,
      });

      // 台词 → 字幕（每条台词拆分显示，约3秒一条）
      if (shot.dialogues?.length) {
        const perDialogue = duration / shot.dialogues.length;
        shot.dialogues.forEach((d, i) => {
          const text = `${d.characterName}：${d.text}`;
          subtitleClips.push({
            id: generateClipId(),
            trackId: subtitleTrack.id,
            type: "subtitle",
            name: text.slice(0, 20),
            text,
            startTime: cursor + i * perDialogue,
            endTime: cursor + (i + 1) * perDialogue,
            duration: perDialogue,
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

  reset: () => set({ tracks: [], playhead: 0, isPlaying: false, selectedClipId: null }),
}));
