"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "./hooks/useEditorStore";
import { uploadUrl } from "@/lib/utils/upload-url";
import { fetchMedia } from "./utils/mediaCache";
import { mediaAtTime } from "./utils/nativePlayback";
import type { Clip } from "./utils/clipMeta";

/** HTML media fallback for origins without WebCodecs / OPFS (including public HTTP). */
export function NativeMediaPreview({ muted }: { muted: boolean }) {
  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);
  const elements = useRef(new Map<string, HTMLMediaElement>());
  const [error, setError] = useState("");
  const [buffering, setBuffering] = useState(false);
  const media = tracks.flatMap((track) => track.clips.filter((c) =>
    (c.type === "video" || c.type === "audio" || c.type === "bgm") &&
    !!(c.audioUrl || c.url)
  ).map((clip) => ({ clip, track })));
  // Keep nearby elements mounted across cuts so the next clip can buffer before playback.
  const nearby = media.filter(({ clip }) => clip.endTime >= playhead - 1 && clip.startTime <= playhead + 8);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let pendingTime: number | null = null;
    let observedTime = useEditorStore.getState().playhead;
    const playing = new WeakSet<HTMLMediaElement>();
    function tick(now: number) {
      const state = useEditorStore.getState();
      const time = state.playhead;
      const elapsed = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (time !== observedTime) pendingTime = null; // external seek
      let waiting = false;
      for (const { clip, track } of media) {
        const el = elements.current.get(clip.id);
        const position = mediaAtTime(clip, track, time, muted);
        if (!el) { if (position.active) waiting = true; continue; }
        el.volume = position.volume;
        el.muted = position.volume === 0;
        if (!position.active) {
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
            if (!el || !mediaAtTime(clip, track, time, muted).active || playing.has(el)) continue;
            playing.add(el);
            void el.play().catch((e: Error) => {
              playing.delete(el);
              if (e.name === "AbortError") return;
              setError("播放失败，请重新点击播放：" + e.message);
              useEditorStore.getState().setPlaying(false);
            });
          }
          const next = Math.min(state.totalDuration(), time + elapsed);
          pendingTime = next;
          state.setPlayhead(next);
          if (next >= state.totalDuration()) state.setPlaying(false);
        }
      }
      observedTime = pendingTime ?? time;
      setBuffering(waiting && state.isPlaying);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const el of elements.current.values()) el.pause();
    };
  }, [tracks, muted]);

  return <div className="absolute inset-0 bg-black">
    {nearby.map(({ clip }) => <MediaElement key={clip.id} clip={clip}
      active={playhead >= clip.startTime && playhead < clip.endTime}
      register={(el) => { if (el) elements.current.set(clip.id, el); else elements.current.delete(clip.id); }}
      onError={(message) => { setError(message); useEditorStore.getState().setPlaying(false); }} />)}
    {(error || buffering) && <div role="status" className="absolute top-3 left-3 rounded bg-black/75 px-3 py-2 text-xs text-white">
      {error || "素材缓冲中…"}
    </div>}
  </div>;
}

function MediaElement({ clip, active, register, onError }: {
  clip: Clip; active: boolean; register: (el: HTMLMediaElement | null) => void; onError: (message: string) => void;
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
  const props = { ref: register, src: src || undefined, preload: "auto", onError: () => errorRef.current(`素材无法播放：${clip.name}`) };
  return clip.type === "video"
    ? <video {...props} playsInline className="absolute inset-0 h-full w-full object-contain" style={{ visibility: active ? "visible" : "hidden" }} />
    : <audio {...props} />;
}
