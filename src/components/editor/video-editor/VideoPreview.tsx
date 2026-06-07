"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditorStore } from "./hooks/useEditorStore";
import { formatTime } from "./utils/clipMeta";
import {
  Play, Pause, SkipBack, SkipForward, Download, Loader2, RefreshCw,
} from "lucide-react";
import { uploadUrl } from "@/lib/utils/upload-url";

// @webav/av-canvas + @webav/av-cliper — 动态 import（防止 SSR 崩溃）
type AVCanvasType = import("@webav/av-canvas").AVCanvas;

export function VideoPreview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const avCvsRef = useRef<AVCanvasType | null>(null);

  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const totalDuration = useEditorStore((s) => s.totalDuration);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [spriteCount, setSpriteCount] = useState(0);
  const total = totalDuration();

  // ── 初始化 / 重建 AVCanvas ────────────────────────────────────────────────

  const buildCanvas = useCallback(async () => {
    if (!containerRef.current) return;
    setLoading(true);

    // 销毁旧实例
    if (avCvsRef.current) {
      try { (avCvsRef.current as unknown as { destroy?: () => void }).destroy?.(); } catch { /* noop */ }
      containerRef.current.innerHTML = "";
      avCvsRef.current = null;
    }

    // 动态 import（浏览器端）
    const { AVCanvas } = await import("@webav/av-canvas");
    const { MP4Clip, AudioClip, VisibleSprite, renderTxt2ImgBitmap } = await import("@webav/av-cliper");

    const avCvs = new AVCanvas(containerRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      bgColor: "#000000",
    });
    avCvsRef.current = avCvs;

    // 播放时间同步
    avCvs.on("timeupdate", (time: number) => {
      setPlayhead(time / 1e6);
    });
    avCvs.on("paused", () => {
      setPlaying(false);
    });
    avCvs.on("playing", () => {
      setPlaying(true);
    });

    // 加载所有 clip 到 AVCanvas
    let loaded = 0;
    const allClips = tracks.flatMap((t) =>
      t.clips.filter((c) => c.type !== "transition")
    );

    for (const clip of allClips) {
      try {
        if (clip.type === "video" && clip.url) {
          const resp = await fetch(uploadUrl(clip.url));
          if (!resp.ok || !resp.body) continue;
          const mp4Clip = new MP4Clip(resp.body, {
            audio: { volume: 1 },
          });
          await mp4Clip.ready;
          const sprite = new VisibleSprite(mp4Clip);
          sprite.time.offset = clip.startTime * 1e6;
          sprite.time.duration = clip.duration * 1e6;
          await avCvs.addSprite(sprite);
          loaded++;
        } else if ((clip.type === "audio" || clip.type === "bgm") && clip.audioUrl) {
          const resp = await fetch(clip.audioUrl);
          if (!resp.ok || !resp.body) continue;
          const audioClip = new AudioClip(resp.body, {
            volume: clip.volume ?? 1,
            loop: clip.type === "bgm",
          });
          const sprite = new VisibleSprite(audioClip);
          sprite.time.offset = clip.startTime * 1e6;
          sprite.time.duration = clip.duration * 1e6;
          await avCvs.addSprite(sprite);
          loaded++;
        } else if (clip.type === "subtitle" && clip.text) {
          const style = clip.subtitleStyle ?? {};
          const cssText = [
            `font-size: ${style.fontSize ?? 32}px`,
            `color: ${style.color ?? "#ffffff"}`,
            `font-weight: ${style.fontWeight ?? "bold"}`,
            `text-align: ${style.textAlign ?? "center"}`,
            `background: ${style.background ?? "rgba(0,0,0,0.55)"}`,
            "padding: 4px 10px",
            "border-radius: 4px",
            `width: ${Math.round((style.width ?? 0.8) * canvasWidth)}px`,
            "white-space: pre-wrap",
            "word-break: break-all",
          ].join("; ");

          const bitmap = await renderTxt2ImgBitmap(clip.text, cssText);
          const { ImgClip } = await import("@webav/av-cliper");
          const imgClip = new ImgClip(bitmap);
          const sprite = new VisibleSprite(imgClip);
          sprite.time.offset = clip.startTime * 1e6;
          sprite.time.duration = clip.duration * 1e6;
          // 位置：居中下方
          const x = Math.round((style.x ?? 0.1) * canvasWidth);
          const y = Math.round((style.y ?? 0.82) * canvasHeight);
          sprite.rect.x = x;
          sprite.rect.y = y;
          await avCvs.addSprite(sprite);
          loaded++;
        }
      } catch (e) {
        console.warn("[VideoPreview] Failed to load clip:", clip.id, e);
      }
    }

    setSpriteCount(loaded);
    setLoading(false);

    // 预览第 0 帧
    if (loaded > 0) {
      try { await avCvs.previewFrame(0); } catch { /* noop */ }
    }
  }, [tracks, canvasWidth, canvasHeight, setPlayhead, setPlaying]);

  // tracks 变化时重建
  useEffect(() => {
    buildCanvas();
  }, [buildCanvas]);

  // ── 播放控制 ─────────────────────────────────────────────────────────────

  async function handlePlay() {
    const avCvs = avCvsRef.current;
    if (!avCvs) return;
    if (isPlaying) {
      avCvs.pause();
      setPlaying(false);
    } else {
      avCvs.play({
        start: Math.round(playhead * 1e6),
        end: Math.round(total * 1e6),
      });
      setPlaying(true);
    }
  }

  async function handleSeek(time: number) {
    const avCvs = avCvsRef.current;
    setPlaying(false);
    avCvs?.pause();
    setPlayhead(time);
    try { await avCvs?.previewFrame(Math.round(time * 1e6)); } catch { /* noop */ }
  }

  async function handleSkipBack() {
    handleSeek(0);
  }

  async function handleSkipEnd() {
    handleSeek(total);
  }

  // ── 导出 MP4 ─────────────────────────────────────────────────────────────

  async function handleExport() {
    const avCvs = avCvsRef.current;
    if (!avCvs || total === 0) return;
    setExporting(true);
    try {
      const combinator = await avCvs.createCombinator({
        width: canvasWidth,
        height: canvasHeight,
      });
      // combinator.output() 返回 ReadableStream，用 reader 手动读取
      const reader = combinator.output().getReader();
      const chunks: ArrayBuffer[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // value 是 Uint8Array，复制到 ArrayBuffer 避免类型冲突
        chunks.push(value.buffer instanceof ArrayBuffer ? value.buffer : value.slice().buffer);
      }
      const blob = new Blob(chunks, { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `editor-export-${Date.now()}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[VideoPreview] Export failed:", e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#111] items-center justify-between">
      {/* AVCanvas 容器 */}
      <div className="relative flex flex-1 items-center justify-center w-full overflow-hidden p-2">
        <div
          ref={containerRef}
          className="max-h-full max-w-full rounded-lg shadow-2xl overflow-hidden"
          style={{
            aspectRatio: `${canvasWidth}/${canvasHeight}`,
            width: "100%",
            maxWidth: `${(canvasWidth / canvasHeight) * 400}px`,
            background: "#000",
          }}
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-[11px] text-white/70">加载媒体素材…</p>
            </div>
          </div>
        )}
        {!loading && spriteCount === 0 && total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[12px] text-white/40">从左侧媒体库添加视频片段</p>
          </div>
        )}
      </div>

      {/* 控制栏 */}
      <div className="w-full bg-[#1a1a1a] px-4 py-2 flex items-center gap-3">
        {/* 时间 */}
        <span className="font-mono text-[11px] text-white/70 w-28 shrink-0">
          {formatTime(playhead)} / {formatTime(total)}
        </span>

        {/* 进度条 */}
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.01}
          value={playhead}
          onChange={(e) => handleSeek(parseFloat(e.target.value))}
          className="flex-1 accent-red-500"
        />

        {/* 按钮组 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleSkipBack}
            className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handlePlay}
            disabled={loading || total === 0}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 disabled:opacity-40"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
          </button>
          <button
            onClick={handleSkipEnd}
            className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => buildCanvas()}
            disabled={loading}
            title="重新加载素材"
            className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <div className="mx-1 h-4 w-px bg-white/20" />
          <button
            onClick={handleExport}
            disabled={exporting || total === 0 || loading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
          >
            {exporting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />导出中…</>
              : <><Download className="h-3.5 w-3.5" />导出 MP4</>
            }
          </button>
        </div>

        {/* 素材计数 */}
        {spriteCount > 0 && (
          <span className="text-[10px] text-white/40 shrink-0">{spriteCount} 个素材</span>
        )}
      </div>
    </div>
  );
}
