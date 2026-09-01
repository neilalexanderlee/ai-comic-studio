"use client";

import { useRef, useState, useEffect } from "react";
import { useEditorStore } from "./hooks/useEditorStore";
import { formatTime, getTrackLabel } from "./utils/clipMeta";
import type { Clip, Track } from "./utils/clipMeta";
import { TRANSITION_OPTIONS } from "./utils/transitionHelper";
import { Plus, Trash2, Volume2, VolumeX, Sparkles, Loader2, X } from "lucide-react";
import { useModelStore } from "@/stores/model-store";
import { uploadUrl } from "@/lib/utils/upload-url";

const TRACK_HEIGHT = 56;
const HEADER_WIDTH = 120;

const CLIP_BG: Record<string, string> = {
  video: "bg-blue-500/80 border-blue-400",
  audio: "bg-emerald-500/80 border-emerald-400",
  subtitle: "bg-amber-500/80 border-amber-400",
  bgm: "bg-purple-500/80 border-purple-400",
  transition: "bg-gray-400/80 border-gray-300",
};

// ── 波形生成（Web Audio API）──────────────────────────────────────────────────

async function generateWaveformData(url: string, samples = 80): Promise<number[]> {
  try {
    const ctx = new AudioContext();
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf);
    await ctx.close();

    const channelData = decoded.getChannelData(0);
    const blockSize = Math.floor(channelData.length / samples);
    const waveform: number[] = [];

    for (let i = 0; i < samples; i++) {
      let sum = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(channelData[start + j] ?? 0);
      }
      waveform.push(sum / blockSize);
    }

    const max = Math.max(...waveform, 0.001);
    return waveform.map((v) => v / max);
  } catch {
    return [];
  }
}

// ── WaveformCanvas ──────────────────────────────────────────────────────────

function WaveformCanvas({ data, width, height }: { data: number[]; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const barW = width / data.length;
    ctx.fillStyle = "rgba(255,255,255,0.45)";

    for (let i = 0; i < data.length; i++) {
      const barH = Math.max(1, data[i] * height * 0.85);
      ctx.fillRect(i * barW, (height - barH) / 2, Math.max(1, barW - 0.5), barH);
    }
  }, [data, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", opacity: 0.7 }}
    />
  );
}

// ── ClipBlock ─────────────────────────────────────────────────────────────────

function ClipBlock({
  clip,
  pps,
  isSelected,
  isMultiSelected,
  onSelect,
  onMultiToggle,
}: {
  clip: Clip;
  pps: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  onSelect: (id: string) => void;
  onMultiToggle: (id: string) => void;
}) {
  const left = clip.startTime * pps;
  const width = Math.max(clip.duration * pps, 4);
  const colorClass = CLIP_BG[clip.type] || "bg-gray-500/80 border-gray-400";

  const dragRef = useRef({ dragging: false, startX: 0, origStart: 0 });
  const moveClip = useEditorStore((s) => s.moveClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const [isEffectDragOver, setIsEffectDragOver] = useState(false);

  // 音频 clip：自动生成波形（audioUrl 改变时重新生成）
  const isAudio = clip.type === "bgm" || clip.type === "audio";
  const audioUrl = isAudio ? clip.audioUrl : undefined;

  useEffect(() => {
    if (!isAudio || !audioUrl || clip.waveformData) return;
    let cancelled = false;
    const fetchUrl = uploadUrl(audioUrl);
    generateWaveformData(fetchUrl).then((data) => {
      if (!cancelled && data.length > 0) {
        updateClip(clip.id, { waveformData: data });
      }
    });
    return () => { cancelled = true; };
  }, [audioUrl]);

  function onMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    if (e.shiftKey) { onMultiToggle(clip.id); return; }
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

  // ── 特效拖放（仅视频 clip 接受 x-drag/effect）────────────────────────────
  function onDragOver(e: React.DragEvent) {
    if (clip.type !== "video") return;
    if (!e.dataTransfer.types.includes("x-drag/effect")) return;
    e.preventDefault();
    e.stopPropagation(); // 不让父级 TrackRow 收到（父级只处理转场）
    setIsEffectDragOver(true);
  }
  function onDragLeaveClip() { setIsEffectDragOver(false); }
  function onDropEffect(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsEffectDragOver(false);
    if (clip.type !== "video") return;
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json"));
      if (data?.type === "effect" && data.subType) {
        updateClip(clip.id, { effectType: data.subType as Clip["effectType"] });
      }
    } catch { /* ignore */ }
  }

  const clipH = TRACK_HEIGHT - 8;

  return (
    <div
      className={`absolute top-1 rounded-md border text-[10px] text-white font-medium
        overflow-hidden select-none cursor-grab active:cursor-grabbing transition-shadow
        ${colorClass}
        ${isSelected ? "ring-2 ring-white ring-offset-1" : ""}
        ${isMultiSelected ? "ring-2 ring-purple-300 ring-offset-1 brightness-110" : ""}
        ${isEffectDragOver ? "ring-2 ring-green-400 brightness-125" : ""}
      `}
      style={{ left, width, height: clipH }}
      onMouseDown={onMouseDown}
      onDragOver={onDragOver}
      onDragLeave={onDragLeaveClip}
      onDrop={onDropEffect}
    >
      {/* 波形背景（bgm / audio clip）*/}
      {isAudio && clip.waveformData && clip.waveformData.length > 0 && (
        <WaveformCanvas data={clip.waveformData} width={Math.round(width)} height={clipH} />
      )}

      <div className="relative flex h-full flex-col justify-between p-1 pointer-events-none z-10">
        <p className="truncate leading-tight drop-shadow-sm">{clip.name}</p>
        <p className="text-[9px] opacity-70 drop-shadow-sm">{clip.duration.toFixed(1)}s</p>
      </div>
      {isMultiSelected && (
        <div className="absolute right-0.5 top-0.5 h-3 w-3 rounded-sm bg-purple-400 flex items-center justify-center pointer-events-none z-20">
          <svg viewBox="0 0 8 8" className="h-2 w-2 fill-white"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" /></svg>
        </div>
      )}
      {/* 特效标记角标 */}
      {clip.type === "video" && clip.effectType && (
        <div className="absolute bottom-0.5 right-0.5 rounded bg-black/40 px-0.5 text-[7px] text-green-300 pointer-events-none z-20">
          ✦{clip.effectType}
        </div>
      )}
    </div>
  );
}

// ── TrackRow ──────────────────────────────────────────────────────────────────

function TrackRow({
  track,
  pps,
  selectedClipId,
  selectedClipIds,
  onSelectClip,
  onMultiToggle,
}: {
  track: Track;
  pps: number;
  // (props unchanged)
  selectedClipId: string | null;
  selectedClipIds: string[];
  onSelectClip: (id: string) => void;
  onMultiToggle: (id: string) => void;
}) {
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const totalDuration = useEditorStore((s) => s.totalDuration);
  const addTransition = useEditorStore((s) => s.addTransition);

  // 转场拖放：落点指示线 X 坐标（相对 content div）
  const [transDropX, setTransDropX] = useState<number | null>(null);
  // 接缝 + 按钮：当前展开的接缝及其屏幕坐标（fixed 定位避免 overflow-hidden 裁切）
  const [openSeam, setOpenSeam] = useState<{ idx: number; screenX: number; screenY: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 计算视频轨的相邻接缝列表
  const seams = track.type === "video"
    ? (() => {
        const vClips = track.clips
          .filter((c) => c.type === "video")
          .sort((a, b) => a.startTime - b.startTime);
        const result: { before: Clip; after: Clip; x: number }[] = [];
        for (let i = 0; i < vClips.length - 1; i++) {
          const seamTime = (vClips[i].endTime + vClips[i + 1].startTime) / 2;
          result.push({ before: vClips[i], after: vClips[i + 1], x: seamTime * pps });
        }
        return result;
      })()
    : [];

  /** 根据落点时间找最近的两个相邻 clip */
  function findAdjacentClips(timeAtDrop: number): { before: Clip; after: Clip } | null {
    const videoClips = track.clips
      .filter((c) => c.type === "video")
      .sort((a, b) => a.startTime - b.startTime);
    if (videoClips.length < 2) return null;
    let best: { before: Clip; after: Clip } | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < videoClips.length - 1; i++) {
      const gapCenter = (videoClips[i].endTime + videoClips[i + 1].startTime) / 2;
      const dist = Math.abs(timeAtDrop - gapCenter);
      if (dist < bestDist) { bestDist = dist; best = { before: videoClips[i], after: videoClips[i + 1] }; }
    }
    return best;
  }

  function getDropX(e: React.DragEvent) {
    const rect = contentRef.current?.getBoundingClientRect();
    return rect ? e.clientX - rect.left : 0;
  }

  function onDragOverTrack(e: React.DragEvent) {
    if (track.type !== "video") return;
    if (!e.dataTransfer.types.includes("x-drag/transition")) return;
    e.preventDefault();
    setTransDropX(getDropX(e));
  }
  function onDragLeaveTrack() { setTransDropX(null); }
  function onDropTransition(e: React.DragEvent) {
    setTransDropX(null);
    if (track.type !== "video") return;
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json"));
      if (data?.type !== "transition") return;
      const timeAtDrop = Math.max(0, getDropX(e) / pps);
      const pair = findAdjacentClips(timeAtDrop);
      if (!pair) { alert("请先添加至少 2 个视频片段再拖入转场"); return; }
      addTransition(pair.before.id, pair.after.id, data.subType, 1);
    } catch { /* ignore */ }
  }

  return (
    <div className="flex border-b border-[--border-subtle]" style={{ height: TRACK_HEIGHT }}>
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
              {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
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

      <div
        ref={contentRef}
        className="relative flex-1 overflow-hidden bg-[--surface]/30"
        style={{ minWidth: totalDuration() * pps + 200 }}
        onDragOver={onDragOverTrack}
        onDragLeave={onDragLeaveTrack}
        onDrop={onDropTransition}
        onClick={() => setOpenSeam(null)}
      >
        {track.clips.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            pps={pps}
            isSelected={selectedClipId === clip.id}
            isMultiSelected={selectedClipIds.includes(clip.id)}
            onSelect={onSelectClip}
            onMultiToggle={onMultiToggle}
          />
        ))}
        {/* 转场拖放落点指示线 */}
        {transDropX !== null && (
          <div
            className="pointer-events-none absolute top-0 z-30 h-full"
            style={{ left: transDropX }}
          >
            <div className="absolute top-0 h-full w-0.5 bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]" />
            <div className="absolute top-0 left-1 rounded bg-green-500 px-1 py-0.5 text-[8px] text-white whitespace-nowrap shadow">
              插入转场
            </div>
          </div>
        )}

        {/* 接缝 + 按钮（视频轨两两相邻 clip 之间） */}
        {seams.map((seam, i) => (
          <div
            key={`${seam.before.id}-${seam.after.id}`}
            className="absolute top-0 z-20 flex h-full -translate-x-1/2 flex-col items-center justify-center"
            style={{ left: seam.x }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (openSeam?.idx === i) { setOpenSeam(null); return; }
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                setOpenSeam({ idx: i, screenX: rect.left + rect.width / 2, screenY: rect.top });
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[--border-subtle] bg-white text-[11px] font-bold text-[--text-muted] shadow hover:border-primary/60 hover:text-primary hover:scale-110 transition-all"
              title="插入转场"
            >
              +
            </button>
          </div>
        ))}

        {/* 转场选择浮层（fixed 定位，不受 overflow-hidden 裁切） */}
        {openSeam !== null && (() => {
          const seam = seams[openSeam.idx];
          if (!seam) return null;
          return (
            <div
              className="fixed z-[9999] rounded-lg border border-[--border-subtle] bg-white shadow-xl p-2"
              style={{ width: 184, left: openSeam.screenX - 92, top: openSeam.screenY - 8, transform: "translateY(-100%)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-[--text-muted]">选择转场效果</p>
              <div className="grid grid-cols-2 gap-1">
                {TRANSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    onClick={() => {
                      addTransition(seam.before.id, seam.after.id, opt.type, 1);
                      setOpenSeam(null);
                    }}
                    className="rounded border border-[--border-subtle] bg-[--surface] px-1.5 py-1 text-[10px] text-[--text-primary] hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── BgmGeneratePanel（inline popover）────────────────────────────────────────

// 豆包音乐（火山生成纯音乐）单段时长硬限制。服务端在 /api/bgm/generate 里做真正的 clamp，
// 这里只用于生成前提示用户；两处数值必须一致（见 VOLC_MUSIC_MIN/MAX_DURATION）。
// 不直接 import 服务端常量：那个模块引了 node:fs，会被打进客户端 bundle。
const BGM_MIN_DURATION = 30;
const BGM_MAX_DURATION = 120;

function BgmGeneratePanel({
  rangeStart,
  rangeEnd,
  bgmNoteChips,
  onClose,
}: {
  rangeStart: number;
  rangeEnd: number;
  bgmNoteChips: string[];   // 去重后的 bgmNote 列表，每条作为 chip
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(bgmNoteChips[0] ?? "");
  const [generating, setGenerating] = useState(false);

  const providers = useModelStore((s) => s.providers);
  const musicProvider = providers.find((p) => p.capability === "music");

  const addTrack = useEditorStore((s) => s.addTrack);
  const addClip = useEditorStore((s) => s.addClip);
  const tracks = useEditorStore((s) => s.tracks);
  const clearMultiSelect = useEditorStore((s) => s.clearMultiSelect);

  const duration = Math.round(rangeEnd - rangeStart);

  // chips 变化时用第一条作为默认
  useEffect(() => { setPrompt(bgmNoteChips[0] ?? ""); }, [bgmNoteChips]);

  async function handleGenerate() {
    if (!musicProvider || !prompt.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/bgm/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          providerId: musicProvider.id,
          protocol: musicProvider.protocol,
          baseUrl: musicProvider.baseUrl,
          modelId: musicProvider.models.find((m) => m.checked)?.id || "",
          targetDuration: duration,
        }),
      });
      const data = await res.json() as { filePath?: string; duration?: number; name?: string; error?: string };
      if (!res.ok || !data.filePath) throw new Error(data.error ?? "生成失败");

      // 找或创建 BGM 轨
      const bgmTrack = tracks.find((t) => t.type === "bgm") ?? addTrack("bgm", "背景音乐");

      // clip 时长 = min(选区时长, 实际生成时长)
      // 火山音乐单段上限 120s：选区更长时只会生成 120s，clip 也只铺到 120s，避免尾部无声。
      // 选区不足 30s 时按 30s 生成，clip 只截取选区那段。
      // 用户可在时间线上拖拽 clip 右边缘调整覆盖范围。
      const clipDuration = Math.min(duration, data.duration ?? duration);
      addClip(bgmTrack.id, {
        type: "bgm",
        name: data.name ?? prompt.slice(0, 20),
        audioUrl: data.filePath,
        startTime: rangeStart,
        duration: clipDuration,
        volume: 0.3,
      });

      clearMultiSelect();
      onClose();
    } catch (e) {
      alert("BGM 生成失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
    {/* 背景遮罩：点外部关闭 */}
    <div className="fixed inset-0 z-40" onClick={onClose} />
    <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-80 rounded-xl border border-purple-200 bg-white shadow-2xl p-4 space-y-2.5">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-purple-500" />
          <span className="text-[11px] font-semibold text-purple-700">生成 BGM</span>
          {musicProvider
            ? <span className="text-[9px] text-[--text-muted] border border-[--border-subtle] rounded px-1">{musicProvider.name}</span>
            : <span className="text-[9px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1">需配置音乐模型</span>
          }
        </div>
        <button onClick={onClose} className="text-[--text-muted] hover:text-[--text-primary]">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 范围信息（只读） */}
      <div className="flex items-center gap-1.5 rounded-lg bg-purple-50 px-2.5 py-1.5 text-[10px] text-purple-700 border border-purple-100">
        <span className="font-mono">{formatTime(rangeStart)}</span>
        <span className="text-purple-300">→</span>
        <span className="font-mono">{formatTime(rangeEnd)}</span>
        <span className="ml-auto font-semibold">{duration}s</span>
      </div>

      {/* 时长约束提示（豆包音乐单段仅支持 30–120 秒） */}
      {duration > BGM_MAX_DURATION && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[9px] text-amber-700">
          豆包音乐单段上限 {BGM_MAX_DURATION} 秒，本次只会生成前 {BGM_MAX_DURATION} 秒。
          更长的段落请分多次生成后在时间线上拼接。
        </p>
      )}
      {duration < BGM_MIN_DURATION && (
        <p className="rounded-lg bg-purple-50 border border-purple-100 px-2.5 py-1.5 text-[9px] text-purple-600">
          豆包音乐最短生成 {BGM_MIN_DURATION} 秒，将按 {BGM_MIN_DURATION} 秒生成并截取选区这 {duration} 秒。
        </p>
      )}

      {/* bgmNote chips（来自选中分镜的背景音标注） */}
      {bgmNoteChips.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] text-[--text-muted] font-medium">分镜背景音建议（点击填入）</p>
          <div className="flex flex-wrap gap-1">
            {bgmNoteChips.map((note, i) => (
              <button
                key={i}
                onClick={() => setPrompt(note)}
                className={`rounded-full border px-2 py-0.5 text-[9px] transition-colors ${
                  prompt === note
                    ? "border-purple-400 bg-purple-100 text-purple-700"
                    : "border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100"
                }`}
                title={note}
              >
                {note.length > 20 ? note.slice(0, 20) + "…" : note}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prompt */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder="描述音乐风格…"
        disabled={generating}
        className="w-full resize-none rounded-lg border border-[--border-subtle] px-2.5 py-1.5 text-[11px] outline-none focus:border-purple-300 disabled:opacity-50"
      />

      {/* 生成按钮 */}
      <button
        disabled={!musicProvider || !prompt.trim() || generating}
        onClick={handleGenerate}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {generating
          ? <><Loader2 className="h-3 w-3 animate-spin" />生成中…</>
          : <><Sparkles className="h-3 w-3" />生成并放置</>
        }
      </button>
    </div>
    </>
  );
}

// ── Timeline 主组件 ───────────────────────────────────────────────────────────

export function Timeline() {
  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);
  const pps = useEditorStore((s) => s.pixelsPerSecond);
  const totalDuration = useEditorStore((s) => s.totalDuration);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const selectClip = useEditorStore((s) => s.selectClip);
  const toggleMultiSelectClip = useEditorStore((s) => s.toggleMultiSelectClip);
  const clearMultiSelect = useEditorStore((s) => s.clearMultiSelect);
  const setZoom = useEditorStore((s) => s.setZoom);
  const addTrack = useEditorStore((s) => s.addTrack);

  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = Math.max(totalDuration(), 10);

  const [bgmPanelOpen, setBgmPanelOpen] = useState(false);

  // ── 选中范围计算 ─────────────────────────────────────────────────────────
  const selectedVideoClips = tracks
    .flatMap((t) => (t.type === "video" ? t.clips : []))
    .filter((c) => c.type === "video" && selectedClipIds.includes(c.id));

  const selectionRange = selectedVideoClips.length > 0
    ? {
        start: Math.min(...selectedVideoClips.map((c) => c.startTime)),
        end: Math.max(...selectedVideoClips.map((c) => c.endTime)),
        // 去重 bgmNote，保留各条作为独立 chip
        bgmNoteChips: [...new Set(selectedVideoClips.map((c) => c.bgmNote).filter((n): n is string => !!n))],
      }
    : null;

  // 关闭 panel 时清多选
  function closeBgmPanel() {
    setBgmPanelOpen(false);
  }

  // 刻度尺点击
  function onRulerClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setPlayhead(x / pps);
    clearMultiSelect();
    setBgmPanelOpen(false);
  }

  // 滚轮缩放
  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      setZoom(pps + delta);
    }
  }

  // 刻度
  const rulerTicks: number[] = [];
  const step = pps >= 100 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;
  for (let t = 0; t <= total + step; t += step) rulerTicks.push(t);

  return (
    <div className="flex h-full flex-col bg-[--surface] border-t border-[--border-subtle]" onWheel={onWheel}>
      {/* 工具栏 */}
      <div className="relative flex items-center gap-2 border-b border-[--border-subtle] px-3 py-1.5">
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

        {/* 无多选时：操作提示 */}
        {!selectionRange && (
          <span className="ml-2 text-[10px] text-[--text-muted] select-none">
            <kbd className="rounded border border-[--border-subtle] bg-[--surface] px-1 py-0.5 font-mono text-[9px]">Shift</kbd>
            {" + 点击分镜片段可多选，然后生成 BGM"}
          </span>
        )}

        {/* 有多选时：选中信息 + 生成 BGM 按钮 */}
        {selectionRange && (
          <div className="ml-2 flex items-center gap-2 rounded-lg bg-purple-50 border border-purple-200 px-2 py-1">
            <span className="text-[10px] text-purple-700 font-medium">
              {selectedVideoClips.length} 个分镜 · {Math.round(selectionRange.end - selectionRange.start)}s
            </span>
            <button
              onClick={() => setBgmPanelOpen((o) => !o)}
              className="flex items-center gap-1 rounded-md bg-purple-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-purple-700 transition-colors"
            >
              <Sparkles className="h-2.5 w-2.5" />
              为选中范围生成 BGM
            </button>
            <button
              onClick={() => { clearMultiSelect(); setBgmPanelOpen(false); }}
              className="text-purple-400 hover:text-purple-600"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* BGM 生成浮层（fixed 居中，不受父容器 overflow 影响） */}
        {bgmPanelOpen && selectionRange && (
          <BgmGeneratePanel
            rangeStart={selectionRange.start}
            rangeEnd={selectionRange.end}
            bgmNoteChips={selectionRange.bgmNoteChips}
            onClose={closeBgmPanel}
          />
        )}

        <div className="ml-auto flex gap-1">
          {(["video", "audio", "subtitle", "bgm"] as const).map((type) => (
            <button
              key={type}
              onClick={() => { try { addTrack(type); } catch (e: unknown) { alert((e as Error).message); } }}
              className="flex items-center gap-0.5 rounded border border-[--border-subtle] bg-[--surface] px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:border-primary/40 hover:text-primary"
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
                <div key={t} className="absolute top-0 flex flex-col items-center" style={{ left: t * pps }}>
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
              {/* 多选范围高亮 */}
              {selectionRange && (
                <div
                  className="absolute top-0 h-full bg-purple-400/20 border-x border-purple-400/40 pointer-events-none"
                  style={{
                    left: selectionRange.start * pps,
                    width: (selectionRange.end - selectionRange.start) * pps,
                  }}
                />
              )}
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
                selectedClipIds={selectedClipIds}
                onSelectClip={selectClip}
                onMultiToggle={toggleMultiSelectClip}
              />
            ))}
            {tracks.length === 0 && (
              <div className="flex h-24 items-center justify-center text-[12px] text-[--text-muted]">
                点击「全部加入」或逐个添加分镜视频
              </div>
            )}
            {/* 播放头竖线 */}
            <div
              className="pointer-events-none absolute top-0 z-20 h-full w-px bg-red-500/80"
              style={{ left: HEADER_WIDTH + playhead * pps }}
            />
            {/* 多选范围竖条（轨道区） */}
            {selectionRange && (
              <div
                className="pointer-events-none absolute top-0 z-10 h-full bg-purple-400/10"
                style={{
                  left: HEADER_WIDTH + selectionRange.start * pps,
                  width: (selectionRange.end - selectionRange.start) * pps,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* 提示文字 */}
      {tracks.length > 0 && selectedClipIds.length === 0 && (
        <div className="border-t border-[--border-subtle] px-3 py-1 text-[9px] text-[--text-muted]">
          Shift+点击视频片段可多选 → 为选中范围生成 BGM
        </div>
      )}
    </div>
  );
}
