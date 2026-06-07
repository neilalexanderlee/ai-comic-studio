"use client";

import { useRef, useCallback, useState } from "react";
import { useEditorStore } from "./hooks/useEditorStore";
import { formatTime, getTrackLabel } from "./utils/clipMeta";
import type { Clip, Track } from "./utils/clipMeta";
import { TRANSITION_OPTIONS } from "./utils/transitionHelper";
import { Plus, Trash2, Volume2, VolumeX, ChevronRight } from "lucide-react";

const TRACK_HEIGHT = 56;    // px per track
const HEADER_WIDTH = 120;   // left label area

// ── 颜色映射 ──────────────────────────────────────────────
const CLIP_BG: Record<string, string> = {
  video: "bg-blue-500/80 border-blue-400",
  audio: "bg-emerald-500/80 border-emerald-400",
  subtitle: "bg-amber-500/80 border-amber-400",
  bgm: "bg-purple-500/80 border-purple-400",
  transition: "bg-gray-400/80 border-gray-300",
};

// ── ClipBlock ────────────────────────────────────────────

function ClipBlock({
  clip,
  pps,
  trackHeight,
  onSelect,
  isSelected,
}: {
  clip: Clip;
  pps: number;
  trackHeight: number;
  onSelect: (id: string) => void;
  isSelected: boolean;
}) {
  const left = clip.startTime * pps;
  const width = Math.max(clip.duration * pps, 4);
  const colorClass = CLIP_BG[clip.type] || "bg-gray-500/80 border-gray-400";

  const dragRef = useRef({ dragging: false, startX: 0, origStart: 0 });
  const updateClip = useEditorStore((s) => s.updateClip);
  const moveClip = useEditorStore((s) => s.moveClip);

  function onMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect(clip.id);
    dragRef.current = { dragging: true, startX: e.clientX, origStart: clip.startTime };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current.dragging) return;
      const dx = ev.clientX - dragRef.current.startX;
      const newStart = Math.max(0, dragRef.current.origStart + dx / pps);
      moveClip(clip.id, newStart);
    }
    function onUp() {
      dragRef.current.dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      className={`absolute top-1 rounded-md border text-[10px] text-white font-medium
        overflow-hidden select-none cursor-grab active:cursor-grabbing
        ${colorClass}
        ${isSelected ? "ring-2 ring-white ring-offset-1" : ""}
      `}
      style={{ left, width, height: TRACK_HEIGHT - 8 }}
      onMouseDown={onMouseDown}
    >
      <div className="flex h-full flex-col justify-between p-1 pointer-events-none">
        <p className="truncate leading-tight">{clip.name}</p>
        <p className="text-[9px] opacity-70">{clip.duration.toFixed(1)}s</p>
      </div>
    </div>
  );
}

// ── TrackRow ─────────────────────────────────────────────

function TrackRow({
  track,
  pps,
  selectedClipId,
  onSelectClip,
}: {
  track: Track;
  pps: number;
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
}) {
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const addClip = useEditorStore((s) => s.addClip);
  const totalDuration = useEditorStore((s) => s.totalDuration);

  return (
    <div className="flex border-b border-[--border-subtle]" style={{ height: TRACK_HEIGHT }}>
      {/* 左侧标签 */}
      <div
        className="flex shrink-0 items-center justify-between bg-[--surface] px-2 border-r border-[--border-subtle]"
        style={{ width: HEADER_WIDTH }}
      >
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-[--text-primary]">{track.name}</p>
          <p className="text-[9px] text-[--text-muted]">{getTrackLabel(track.type)}</p>
        </div>
        <div className="flex items-center gap-0.5">
          {(track.type === "audio" || track.type === "bgm") && (
            <button
              onClick={() => updateTrack(track.id, { muted: !track.muted })}
              className="flex h-5 w-5 items-center justify-center rounded text-[--text-muted] hover:text-primary"
            >
              {track.muted
                ? <VolumeX className="h-3 w-3" />
                : <Volume2 className="h-3 w-3" />
              }
            </button>
          )}
          <button
            onClick={() => removeTrack(track.id)}
            className="flex h-5 w-5 items-center justify-center rounded text-[--text-muted] hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 轨道内容区 */}
      <div
        className="relative flex-1 overflow-hidden bg-[--surface]/30"
        style={{ minWidth: totalDuration() * pps + 200 }}
      >
        {track.clips.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            pps={pps}
            trackHeight={TRACK_HEIGHT}
            onSelect={onSelectClip}
            isSelected={selectedClipId === clip.id}
          />
        ))}
      </div>
    </div>
  );
}

// ── Timeline 主组件 ───────────────────────────────────────

export function Timeline() {
  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);
  const pps = useEditorStore((s) => s.pixelsPerSecond);
  const totalDuration = useEditorStore((s) => s.totalDuration);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const selectClip = useEditorStore((s) => s.selectClip);
  const setZoom = useEditorStore((s) => s.setZoom);
  const addTrack = useEditorStore((s) => s.addTrack);

  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = Math.max(totalDuration(), 10);

  // 刻度尺点击 → 移动播放头
  function onRulerClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setPlayhead(x / pps);
  }

  // 滚轮缩放
  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      setZoom(pps + delta);
    }
  }

  // 生成刻度
  const rulerTicks: number[] = [];
  const step = pps >= 100 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;
  for (let t = 0; t <= total + step; t += step) rulerTicks.push(t);

  return (
    <div className="flex h-full flex-col bg-white border-t border-[--border-subtle]" onWheel={onWheel}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-[--border-subtle] px-3 py-1.5">
        <span className="text-[11px] font-semibold text-[--text-muted]">时间线</span>
        <div className="flex items-center gap-1 text-[10px] text-[--text-muted]">
          <span>缩放</span>
          <input
            type="range" min={20} max={300} value={pps}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-3 w-20"
          />
          <span>{pps}px/s</span>
        </div>
        <div className="ml-auto flex gap-1">
          {(["video", "audio", "subtitle", "bgm"] as const).map((type) => (
            <button
              key={type}
              onClick={() => { try { addTrack(type); } catch (e: unknown) { alert((e as Error).message); } }}
              className="flex items-center gap-0.5 rounded border border-[--border-subtle] bg-white px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:border-primary/40 hover:text-primary"
            >
              <Plus className="h-2.5 w-2.5" />
              {getTrackLabel(type)}轨
            </button>
          ))}
        </div>
      </div>

      {/* 滚动区 */}
      <div ref={scrollRef} className="flex flex-1 overflow-auto">
        <div style={{ minWidth: HEADER_WIDTH + total * pps + 200 }}>
          {/* 刻度尺 */}
          <div className="flex border-b border-[--border-subtle]" style={{ height: 24 }}>
            <div style={{ width: HEADER_WIDTH, minWidth: HEADER_WIDTH }} className="border-r border-[--border-subtle] bg-[--surface]" />
            <div
              ref={rulerRef}
              className="relative flex-1 cursor-pointer bg-[--surface]/50 select-none"
              style={{ minWidth: total * pps + 200 }}
              onClick={onRulerClick}
            >
              {rulerTicks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 flex flex-col items-center"
                  style={{ left: t * pps }}
                >
                  <div className="h-2 w-px bg-[--border-subtle]" />
                  <span className="text-[8px] text-[--text-muted] leading-none mt-0.5">{formatTime(t)}</span>
                </div>
              ))}
              {/* 播放头 */}
              <div
                className="absolute top-0 z-10 h-full w-px bg-red-500 pointer-events-none"
                style={{ left: playhead * pps }}
              >
                <div className="h-3 w-3 -translate-x-1/2 rounded-sm bg-red-500" />
              </div>
            </div>
          </div>

          {/* 轨道区 */}
          <div className="relative">
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                pps={pps}
                selectedClipId={selectedClipId}
                onSelectClip={selectClip}
              />
            ))}
            {tracks.length === 0 && (
              <div className="flex h-24 items-center justify-center text-[12px] text-[--text-muted]">
                从上方媒体库拖入视频，或点击「+视频轨」添加轨道
              </div>
            )}
            {/* 播放头竖线（轨道区） */}
            <div
              className="pointer-events-none absolute top-0 z-20 h-full w-px bg-red-500/80"
              style={{ left: HEADER_WIDTH + playhead * pps }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
