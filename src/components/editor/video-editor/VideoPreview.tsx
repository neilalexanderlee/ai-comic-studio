"use client";

import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Download,
} from "lucide-react";
import { useEditorStore } from "./hooks/useEditorStore";
import { formatTime } from "./utils/clipMeta";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { RealtimePreview, type RealtimePreviewHandle } from "./RealtimePreview";
import { canonicalTimeline } from "@/lib/video/timeline-contract";

/** Immediate editing by default; opt-in server preview uses the export renderer. */
export function VideoPreview({
  projectId,
  episodeId,
}: {
  projectId: string;
  episodeId: string;
}) {
  const tracks = useEditorStore((s) => s.tracks);
  const style = useEditorStore((s) => s.globalSubtitleStyle);
  const canvasWidth = useEditorStore((s) => s.canvasWidth),
    canvasHeight = useEditorStore((s) => s.canvasHeight);
  const output = useEditorStore((s) => s.output);
  const playhead = useEditorStore((s) => s.playhead),
    playing = useEditorStore((s) => s.isPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead),
    setPlaying = useEditorStore((s) => s.setPlaying);
  const total = Math.max(
    0,
    ...tracks.flatMap((t) => t.clips.map((c) => c.endTime)),
  );
  const video = useRef<HTMLVideoElement>(null);
  const realtime = useRef<RealtimePreviewHandle>(null);
  const [previewMode, setPreviewMode] = useState<"realtime" | "precise">("realtime");
  const [muted, setMuted] = useState(false),
    [error, setError] = useState("");
  const [mustRefresh, setMustRefresh] = useState(false);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null),
    [stage, setStage] = useState("");
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(
    null,
  );
  const abort = useRef<AbortController | null>(null);
  let key = "";
  let invalid = "";
  try {
    key = JSON.stringify(
      canonicalTimeline({
        tracks,
        canvasWidth,
        canvasHeight,
        globalSubtitleStyle: style,
        output,
      }),
    );
  } catch (e) {
    invalid = e instanceof Error ? e.message : "时间线无效";
  }
  const currentKey = useRef(key);
  currentKey.current = key;
  const ready = !!preview && preview.key === key;
  useEffect(() => {
    setPreviewMode("realtime");
    if (video.current) {
      setPlaying(false);
      video.current.pause();
    }
  }, [key, setPlaying]);
  useEffect(
    () => () => {
      abort.current?.abort();
      useEditorStore.getState().setPlaying(false);
    },
    [],
  );
  useEffect(() => {
    const el = video.current;
    if (!el || !ready || previewMode !== "precise") return;
    if (!playing) {
      el.pause();
      if (Math.abs(el.currentTime - playhead) > 0.04)
        el.currentTime = Math.min(playhead, Math.max(0, total - 0.001));
    }
  }, [playhead, playing, ready, total, previewMode]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        video.current?.pause();
        setPlaying(false);
      }
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, [setPlaying]);
  async function render(mode: "preview" | "export", refresh = false) {
    if (busy || invalid || !key) return;
    const controller = new AbortController();
    abort.current = controller;
    const snapshot = key;
    setBusy(mode);
    setError("");
    setStage("排队中…");
    setPlaying(false);
    video.current?.pause();
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timeline: JSON.parse(snapshot),
            mode,
            refresh: refresh || mustRefresh,
          }),
          signal: controller.signal,
        },
      );
      const { taskId } = await res.json();
      if (!taskId) throw new Error("任务创建失败");
      const url = await pollTask(taskId, controller.signal, setStage);
      if (mode === "preview") {
        if (currentKey.current !== snapshot) {
          setError("时间线已修改，请生成最新预览");
          return;
        }
        setPlaying(false);
        setPreview({ key: snapshot, url });
        setPreviewMode("precise");
        setMustRefresh(false);
      } else {
        const a = document.createElement("a");
        a.href = `${uploadUrl(url)}?download=${encodeURIComponent(`export-${Date.now()}.mp4`)}`;
        a.download = "export.mp4";
        a.click();
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "渲染失败");
    } finally {
      if (!controller.signal.aborted) {
        setBusy(null);
        setStage("");
      }
    }
  }
  async function togglePlay() {
    if (previewMode === "realtime") {
      if (playing) { setPlaying(false); return; }
      try {
        await realtime.current?.prepare();
        if (playhead >= total) setPlayhead(0);
        setError("");
        setPlaying(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "播放失败");
      }
      return;
    }
    if (!ready) {
      await render("preview");
      return;
    }
    const el = video.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      setPlaying(false);
      return;
    }
    try {
      setPlaying(true);
      setError("");
      if (playhead >= total) {
        el.currentTime = 0;
        setPlayhead(0);
      }
      await el.play();
    } catch (e) {
      // Seeking/pausing cancels a pending play promise as a normal operation.
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e instanceof Error ? e.message : "播放失败");
      setPlaying(false);
    }
  }
  function seek(time: number) {
    video.current?.pause();
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(total, time)));
  }
  const boundaries = [
    ...new Set(
      tracks.flatMap((t) =>
        t.clips.filter((c) => c.type === "video").map((c) => c.startTime),
      ),
    ),
  ].sort((a, b) => a - b);
  return (
    <div className="flex h-full flex-col bg-[#111] text-white">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {previewMode === "realtime" && !invalid && <RealtimePreview ref={realtime} muted={muted} />}
        {previewMode === "precise" && preview && (
          <video
            ref={video}
            src={uploadUrl(preview.url)}
            playsInline
            preload="auto"
            muted={muted}
            className={`h-full w-full object-contain ${ready ? "" : "opacity-30"}`}
            onLoadedMetadata={() => {
              if (video.current)
                video.current.currentTime = Math.min(
                  playhead,
                  Math.max(0, total - 0.001),
                );
            }}
            onTimeUpdate={() => {
              if (video.current && !video.current.paused)
                setPlayhead(video.current.currentTime);
            }}
            onEnded={() => {
              setPlaying(false);
              setPlayhead(total);
            }}
            onError={() => {
              setError("预览文件加载失败，请重新生成预览");
              setPlaying(false);
              setPreview(null);
              setMustRefresh(true);
            }}
          />
        )}
        {previewMode === "precise" && !ready && !busy && (
          <div className="absolute rounded bg-black/80 p-4 text-center text-sm">
            <p>
              {preview
                ? "时间线已修改，预览需要更新"
                : "生成精准预览后，可查看字幕、转场、特效和全部音轨"}
            </p>
            <button
              className="mt-3 rounded bg-orange-600 px-4 py-2 disabled:opacity-40"
              disabled={!total || !!invalid}
              onClick={() => void render("preview")}
            >
              生成精准预览
            </button>
          </div>
        )}
        {busy && (
          <div
            role="status"
            className="absolute rounded bg-black/80 p-4 text-sm"
          >
            {busy === "preview" ? "生成预览" : "导出 MP4"}：{stage}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="absolute top-3 left-3 right-3 rounded bg-red-950 p-3 text-sm"
          >
            {error}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 p-3 text-xs">
        <span className="w-24 shrink-0 font-mono">
          {formatTime(playhead)} / {formatTime(total)}
        </span>
        <input
          aria-label="播放位置"
          className="min-w-0 flex-1 accent-orange-600"
          type="range"
          min={0}
          max={total || 1}
          step={0.01}
          value={playhead}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <button
          aria-label="上一镜"
          onClick={() =>
            seek(boundaries.filter((t) => t < playhead - 0.05).at(-1) ?? 0)
          }
        >
          <SkipBack size={18} />
        </button>
        <button
          aria-label={playing ? "暂停" : "播放"}
          disabled={!!busy || !total || !!invalid}
          onClick={() => void togglePlay()}
          className="rounded-full bg-white p-2 text-black disabled:opacity-40"
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button
          aria-label="下一镜"
          onClick={() =>
            seek(boundaries.find((t) => t > playhead + 0.05) ?? total)
          }
        >
          <SkipForward size={18} />
        </button>
        <button
          aria-label={muted ? "取消静音" : "静音"}
          onClick={() => setMuted((v) => !v)}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button
          className={`shrink-0 rounded px-2 py-1 ${previewMode === "realtime" ? "bg-orange-700" : "bg-neutral-800"}`}
          aria-pressed={previewMode === "realtime"}
          onClick={() => { video.current?.pause(); setPlaying(false); setError(""); setPreviewMode("realtime"); }}
        >实时预览</button>
        <button
          className={`shrink-0 rounded px-2 py-1 ${previewMode === "precise" ? "bg-orange-700" : "bg-neutral-800"}`}
          aria-pressed={previewMode === "precise"}
          title="生成并查看与导出一致的转场、特效和混音"
          disabled={!!busy || !total || !!invalid}
          onClick={() => {
            if (ready && !mustRefresh) { setPlaying(false); setError(""); setPreviewMode("precise"); }
            else void render("preview");
          }}
        >精准预览</button>
        <select
          aria-label="输出尺寸"
          className="rounded bg-neutral-800 p-1"
          value={output.width ? "canvas" : "source"}
          onChange={(e) =>
            useEditorStore
              .getState()
              .setOutput({
                ...output,
                width: e.target.value === "canvas" ? canvasWidth : undefined,
                height: e.target.value === "canvas" ? canvasHeight : undefined,
              })
          }
        >
          <option value="source">原片尺寸</option>
          <option value="canvas">
            项目画布 {canvasWidth}×{canvasHeight}
          </option>
        </select>
        <select
          aria-label="输出帧率"
          className="rounded bg-neutral-800 p-1"
          value={output.fps ?? 0}
          onChange={(e) =>
            useEditorStore
              .getState()
              .setOutput({
                ...output,
                fps: Number(e.target.value) || undefined,
              })
          }
        >
          <option value={0}>原片帧率</option>
          {[24, 25, 30, 60].map((n) => (
            <option key={n} value={n}>
              {n} fps
            </option>
          ))}
        </select>
        <button
          disabled={!!busy || !total || !!invalid}
          className="flex items-center gap-1 rounded bg-orange-600 px-3 py-2 disabled:opacity-40"
          onClick={() => void render("export")}
        >
          <Download size={16} />
          导出 MP4
        </button>
      </div>
    </div>
  );
}
async function pollTask(
  id: string,
  signal: AbortSignal,
  onStage: (s: string) => void,
): Promise<string> {
  for (let attempt = 0; attempt < 1200; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const res = await apiFetch(`/api/tasks/${id}`, { signal });
    const task = await res.json();
    if (task.status === "failed") throw new Error(task.error || "渲染失败");
    if (task.status === "completed") {
      if (!task.result?.outputUrl) throw new Error("渲染没有生成文件");
      return task.result.outputUrl;
    }
    onStage(task.progress?.message ?? "排队中…");
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("等待超时，任务仍保留在服务器，请稍后重试查看");
}
