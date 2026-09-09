"use client";

import { forwardRef, useEffect, useImperativeHandle, useCallback, useRef, useState } from "react";
import { useEditorStore } from "./hooks/useEditorStore";
import { uploadUrl } from "@/lib/utils/upload-url";
import { fetchMedia } from "./utils/mediaCache";
import { mediaAtTime } from "./utils/realtimePlayback";
import type { Clip } from "./utils/clipMeta";

/** Immediate editing preview using native media clocks; no render job or secure context required. */
export interface RealtimePreviewHandle { prepare(): Promise<void> }
export const RealtimePreview = forwardRef<RealtimePreviewHandle, { muted: boolean }>(function RealtimePreview({ muted }, ref) {
  const context = useRef<AudioContext | null>(null);
  const [mediaEpoch, setMediaEpoch] = useState(0);
  const gains = useRef(new Map<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>());
  useImperativeHandle(ref, () => ({ async prepare() {
    context.current ??= new AudioContext();
    await context.current.resume();
    setError("");
  } }), []);
  useEffect(() => {
    // A media element can only belong to one Web Audio source for its lifetime.
    // React effect restarts (StrictMode/Fast Refresh) need fresh media elements
    // after the previous AudioContext has been closed.
    setMediaEpoch(n => n + 1);
    const pause = () => { if (document.hidden) useEditorStore.getState().setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    const nodes = gains.current;
    return () => {
      document.removeEventListener("visibilitychange", pause);
      nodes.forEach(n => { n.source.disconnect(); n.gain.disconnect(); });
      nodes.clear();
      void context.current?.close(); context.current = null;
    };
  }, []);
  const tracks = useEditorStore((s) => s.tracks);
  const storedPlayhead = useEditorStore((s) => s.playhead);
  const total = Math.max(0, ...tracks.flatMap(t => t.clips.map(c => c.endTime)));
  const playhead = Math.min(storedPlayhead, Math.max(0, total - .001));
  const globalStyle = useEditorStore((s) => s.globalSubtitleStyle);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const output = useEditorStore((s) => s.output);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [aspect, setAspect] = useState(canvasWidth / canvasHeight);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const ratio = output.width && output.height ? output.width / output.height : aspect;
  const width = Math.min(size.width, size.height * ratio);
  const height = width / ratio;
  const elements = useRef(new Map<string, HTMLMediaElement>());
  const register = useCallback((id: string, el: HTMLMediaElement | null) => {
    if (el) elements.current.set(id, el);
    else {
      const previous = elements.current.get(id);
      const node = previous && gains.current.get(previous);
      if (node) { node.source.disconnect(); node.gain.disconnect(); gains.current.delete(previous!); }
      elements.current.delete(id);
    }
  }, []);
  const [error, setError] = useState("");
  const [buffering, setBuffering] = useState(false);
  const media = tracks.flatMap((track) => track.clips.filter((c) =>
    (c.type === "video" || c.type === "audio" || c.type === "bgm") &&
    !!(c.audioUrl || c.url)
  ).sort((a, b) => a.startTime - b.startTime).map((clip) => ({ clip, track })));
  const firstVideoId = media.find(m => m.clip.type === "video")?.clip.id;
  // Retain the first source for canvas geometry and fast replay; prebuffer nearby cuts.
  const nearby = media.filter(({ clip }) => clip.id === firstVideoId || (clip.endTime >= playhead - 1 && clip.startTime <= playhead + 8));

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let pendingTime: number | null = null;
    let observedTime = useEditorStore.getState().playhead;
    const playing = new WeakSet<HTMLMediaElement>();
    function tick(now: number) {
      const state = useEditorStore.getState();
      const time = state.isPlaying ? state.playhead : Math.min(state.playhead, Math.max(0, state.totalDuration() - .001));
      const elapsed = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (time !== observedTime) pendingTime = null; // external seek
      let waiting = false;
      for (const { clip, track } of media) {
        const el = elements.current.get(clip.id);
        const position = mediaAtTime(clip, track, time, muted);
        if (!el) { if (position.active) waiting = true; continue; }
        if (context.current) {
          let node = gains.current.get(el);
          if (!node) {
            const source = context.current.createMediaElementSource(el);
            const gain = context.current.createGain();
            source.connect(gain).connect(context.current.destination);
            node = { source, gain }; gains.current.set(el, node);
          }
          node.gain.gain.value = position.volume;
          el.volume = 1;
        } else el.volume = Math.min(1, position.volume);
        el.muted = position.volume === 0;
        if (el instanceof HTMLVideoElement) el.style.visibility = position.active && position.sourceTime < el.duration ? "visible" : "hidden";
        if (!position.active || (Number.isFinite(el.duration) && position.sourceTime >= el.duration)) {
          el.pause();
          playing.delete(el);
          continue;
        }
        if (el.readyState === 0) { waiting = true; continue; }
        if (Math.abs(el.currentTime - position.sourceTime) > (state.isPlaying ? 0.3 : 0.04)) {
          el.currentTime = position.sourceTime;
        }
        if (el.readyState < 2 || el.seeking) waiting = true;
        if (!state.isPlaying) { el.pause(); playing.delete(el); }
      }
      if (state.isPlaying) {
        if (waiting) {
          // Freeze the timeline and all sound while any active clip buffers.
          for (const el of elements.current.values()) { el.pause(); playing.delete(el); }
        } else {
          for (const { clip, track } of media) {
            const el = elements.current.get(clip.id);
            const position = mediaAtTime(clip, track, time, muted);
            if (!el || !position.active || position.sourceTime >= el.duration || playing.has(el)) continue;
            playing.add(el);
            void el.play().catch((e: Error) => {
              playing.delete(el);
              if (e.name === "AbortError") return;
              setError("播放失败，请重新点击播放：" + e.message);
              useEditorStore.getState().setPlaying(false);
            });
          }
          // Follow a playing media clock; use wall time only in deliberate timeline gaps.
          const master = media.find(({ clip, track }) => clip.type === "video" &&
            mediaAtTime(clip, track, time, muted).active && !!elements.current.get(clip.id) && !elements.current.get(clip.id)!.ended && mediaAtTime(clip, track, time, muted).sourceTime < elements.current.get(clip.id)!.duration);
          const masterElement = master && elements.current.get(master.clip.id);
          const mediaTime = master && masterElement ? master.clip.startTime + masterElement.currentTime - (master.clip.trimStart ?? 0) : time + elapsed;
          const next = Math.min(state.totalDuration(), Math.max(time, mediaTime));
          pendingTime = next;
          state.setPlayhead(next);
          if (next >= state.totalDuration()) state.setPlaying(false);
        }
      }
      observedTime = pendingTime ?? time;
      setBuffering(waiting);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const el of elements.current.values()) el.pause();
    };
  }, [tracks, muted]);

  const hasComplexEffects = tracks.some(t => t.clips.some(c => c.type === "transition" || c.effectType));
  return <div ref={host} className="absolute inset-0 flex items-center justify-center bg-black" data-preview-mode="realtime">
    <div className="relative overflow-hidden" style={{width, height}}>
      {nearby.map(({ clip }) => <MediaElement key={`${clip.id}:${mediaEpoch}`} clip={clip}
        active={playhead >= clip.startTime && playhead < clip.endTime}
        register={register}
        onDimensions={(w, h) => { if (clip.id === firstVideoId && w && h) setAspect(w / h); }}
        onError={(message) => { setError(message); useEditorStore.getState().setPlaying(false); }} />)}
      {tracks.flatMap(t => t.clips).filter(c => c.type === "subtitle" && playhead >= c.startTime && playhead < c.endTime).map(clip => {
        const style = clip.subtitleStyleOverride ? {...globalStyle, ...clip.subtitleStyle} : globalStyle;
        const align = style.textAlign ?? "center";
        return <div key={clip.id} className="pointer-events-none absolute whitespace-pre-wrap" style={{
          left: `${(style.x ?? (align === "left" ? .05 : align === "right" ? .95 : .5)) * 100}%`,
          top: `${(style.y ?? .92) * 100}%`,
          transform: `translate(${align === "left" ? "0" : align === "right" ? "-100%" : "-50%"}, -100%)`,
          fontSize: (style.fontSize ?? 32) * height / canvasHeight,
          color: style.color ?? "#fff", textAlign: align,
          fontFamily: "Arial, sans-serif", lineHeight: 1.2,
          width: "max-content", maxWidth: "90%",
          textShadow: "-1px -1px 1px #000, 1px 1px 1px #000, 0 0 2px #000",
        }}>{clip.text}</div>;
      })}
    </div>
    {hasComplexEffects && <div className="absolute top-2 right-2 rounded bg-black/70 px-2 py-1 text-xs text-white">实时预览显示剪辑与字幕；转场和画面特效请查看精准预览</div>}
    {(error || buffering) && <div role="status" className="absolute top-3 left-3 rounded bg-black/75 px-3 py-2 text-xs text-white">
      {error || "素材缓冲中…"}
    </div>}
  </div>;
});

function MediaElement({ clip, active, register, onError, onDimensions }: {
  clip: Clip; active: boolean; register: (id: string, el: HTMLMediaElement | null) => void; onError: (message: string) => void; onDimensions: (w: number, h: number) => void;
}) {
  const ref = clip.type === "video" ? (clip.previewUrl || clip.url)! : (clip.audioUrl || clip.url)!;
  const [src, setSrc] = useState("");
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl = "";
    setSrc("");
    void fetchMedia(ref, uploadUrl(ref), abort.signal).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch((e: Error) => {
      if (!abort.signal.aborted) errorRef.current(`素材加载失败（${clip.name}）：${e.message}`);
    });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [ref, clip.name]);
  const registerElement = useCallback((el: HTMLMediaElement | null) => register(clip.id, el), [clip.id, register]);
  const props = { ref: registerElement, src: src || undefined, preload: "auto", onError: () => errorRef.current(`素材无法播放：${clip.name}`) };
  return clip.type === "video"
    ? <video {...props} onLoadedMetadata={e => onDimensions(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} playsInline className="absolute inset-0 h-full w-full object-contain" style={{ visibility: active ? "visible" : "hidden" }} />
    : <audio {...props} />;
}
