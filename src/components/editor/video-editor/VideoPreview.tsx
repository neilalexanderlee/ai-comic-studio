"use client";

/**
 * VideoPreview — AVCanvas 架构
 *
 * 能力：
 *  - trimStart / trimEnd：通过 MP4Clip.split() 裁剪素材内部范围
 *  - 转场渲染：tickInterceptor 实现帧级混合（fade / dissolve / slide / wipe / zoom / rotate…）
 *  - 帧缓存：转场的 "beforeClip" 帧缓存供 "afterClip" 混合使用
 */

import { useEffect, useRef, useState } from "react";
import { AVCanvas } from "@webav/av-canvas";
import { MP4Clip, AudioClip, VisibleSprite } from "@webav/av-cliper";
import { useEditorStore } from "./hooks/useEditorStore";
import { formatTime } from "./utils/clipMeta";
import type { Clip } from "./utils/clipMeta";
import { getTransitionRenderer } from "./utils/transitionRenderers";
import { getEffectTransform } from "./utils/filterEffect";
import {
  Play, Pause, SkipBack, SkipForward,
  Download, Loader2, Volume2, VolumeX,
} from "lucide-react";
import { uploadUrl } from "@/lib/utils/upload-url";
import { apiFetch } from "@/lib/api-fetch";

const TRIM_MARGIN = 0.1; // 安全边界（秒），避免 split 边界报错

// ─── 转场信息 ─────────────────────────────────────────────────────────────────

interface TransitionInfo {
  transitionClipId: string;
  beforeClipId: string;
  afterClipId: string;
  transitionType: string;
  startTime: number;  // seconds
  endTime: number;    // seconds
}

interface VideoPreviewProps {
  projectId: string;
  episodeId: string;
}

export function VideoPreview({ projectId, episodeId }: VideoPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const avCanvasRef = useRef<AVCanvas | null>(null);

  // clipId → VisibleSprite
  const spriteMapRef = useRef<Map<string, VisibleSprite>>(new Map());
  // clip 关键属性快照（用于 diff，避免重复 fetch）
  const clipSnapshotRef = useRef<Map<string, string>>(new Map());
  // 防止并发 sync
  const syncAbortRef = useRef<AbortController | null>(null);

  // ─── 转场状态（Refs，供 tickInterceptor 在任何时间读取）────────────────────
  // transitionClipId → TransitionInfo
  const transitionInfoMapRef = useRef<Map<string, TransitionInfo>>(new Map());
  // videoClipId → TransitionInfo[]（一个视频可同时是多个转场的 before/after）
  const clipTransitionsMapRef = useRef<Map<string, TransitionInfo[]>>(new Map());
  // clipId → 最近一帧 ImageBitmap（供转场混合使用）
  const clipFrameCacheRef = useRef<Map<string, ImageBitmap>>(new Map());

  const [muted, setMuted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSeconds, setExportSeconds] = useState(0);
  const [exportStage, setExportStage] = useState("");

  const avCanvasTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  /**
   * 当前这轮 syncSprites 的 promise。
   *
   * syncSprites 是异步的：每个 clip 都要 fetch + 构建 MP4Clip（迁到 OSS 后还要走网络）。
   * 素材尚未全部 addSprite 就调 avCanvas.play()，播放器会播到「已加载内容的末尾」
   * 就触发 ended —— 表现为「第一次点播放，播一会儿进度归零并停止，第二次才正常」。
   * 所以 handlePlay 必须先 await 这个 promise。
   */
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const [spritesLoading, setSpritesLoading] = useState(false);

  const tracks = useEditorStore((s) => s.tracks);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const totalDuration = useEditorStore((s) => s.totalDuration);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const getClipById = useEditorStore((s) => s.getClipById);
  // 画布尺寸：由项目 videoRatio 决定（16:9 → 1920x1080 / 9:16 → 1080x1920 / 1:1 → 1080x1080）
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);

  const total = totalDuration();

  // 字幕叠加（DOM，AVCanvas 不渲染 DOM 文字）
  const allSubtitleClips = tracks.flatMap((t) =>
    t.type === "subtitle" ? t.clips.filter((c) => c.type === "subtitle") : []
  );
  const activeSubtitle = allSubtitleClips.find(
    (c) => playhead >= c.startTime && playhead < c.endTime
  ) ?? null;

  // ── 初始化 AVCanvas ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const avCanvas = new AVCanvas(el, {
      bgColor: "#000000",
      width: canvasWidth,
      height: canvasHeight,
    });
    avCanvasRef.current = avCanvas;

    const unsubTime = avCanvas.on("timeupdate", (t) => {
      avCanvasTimeRef.current = t / 1e6;
      setPlayhead(t / 1e6);
    });
    const unsubPaused = avCanvas.on("paused", () => {
      isPlayingRef.current = false;
      setPlaying(false);
    });

    return () => {
      unsubTime();
      unsubPaused();
      avCanvas.destroy();
      avCanvasRef.current = null;
      spriteMapRef.current.clear();
      clipSnapshotRef.current.clear();
      // 释放帧缓存
      for (const frame of clipFrameCacheRef.current.values()) frame.close();
      clipFrameCacheRef.current.clear();
    };
  }, [canvasWidth, canvasHeight]);

  // ─── 转场检测 ──────────────────────────────────────────────────────────────

  function detectTransitions() {
    transitionInfoMapRef.current.clear();
    clipTransitionsMapRef.current.clear();

    for (const track of tracks) {
      const transitionClips = track.clips.filter((c) => c.type === "transition");
      const videoClips = track.clips.filter((c) => c.type === "video");

      for (const tc of transitionClips) {
        const midPoint = (tc.startTime + tc.endTime) / 2;
        const TOL = 1.0;

        // beforeClip：endTime 落在转场时间区间附近，最接近中点
        let beforeClip: Clip | null = null;
        let bestBefore = -Infinity;
        for (const vc of videoClips) {
          if (vc.endTime >= tc.startTime - TOL && vc.endTime <= tc.endTime + TOL) {
            const score = -Math.abs(vc.endTime - midPoint);
            if (score > bestBefore) { beforeClip = vc; bestBefore = score; }
          }
        }

        // afterClip：startTime 落在转场时间区间附近，最接近中点
        let afterClip: Clip | null = null;
        let bestAfter = -Infinity;
        for (const vc of videoClips) {
          if (vc.startTime >= tc.startTime - TOL && vc.startTime <= tc.endTime + TOL) {
            const score = -Math.abs(vc.startTime - midPoint);
            if (score > bestAfter) { afterClip = vc; bestAfter = score; }
          }
        }

        if (beforeClip && afterClip && beforeClip.id !== afterClip.id) {
          const info: TransitionInfo = {
            transitionClipId: tc.id,
            beforeClipId: beforeClip.id,
            afterClipId: afterClip.id,
            transitionType: tc.transitionType ?? "fade",
            startTime: tc.startTime,
            endTime: tc.endTime,
          };
          transitionInfoMapRef.current.set(tc.id, info);

          const bList = clipTransitionsMapRef.current.get(beforeClip.id) ?? [];
          bList.push(info);
          clipTransitionsMapRef.current.set(beforeClip.id, bList);

          const aList = clipTransitionsMapRef.current.get(afterClip.id) ?? [];
          aList.push(info);
          clipTransitionsMapRef.current.set(afterClip.id, aList);
        }
      }
    }
  }

  // ─── 当前时间点的转场状态（供 tickInterceptor 调用）─────────────────────────

  function getActiveTransitionAtTime(
    clipId: string,
    globalTime: number,
  ): { transition: TransitionInfo; progress: number; isBeforeClip: boolean } | null {
    const transitions = clipTransitionsMapRef.current.get(clipId);
    if (!transitions?.length) return null;

    const clip = getClipById(clipId);
    if (!clip) return null;

    for (const transition of transitions) {
      const isBeforeClip = transition.beforeClipId === clipId;

      if (isBeforeClip) {
        // before clip：从转场开始到 clip 结束
        if (globalTime >= transition.startTime && globalTime <= clip.endTime) {
          const dur = clip.endTime - transition.startTime;
          const progress = dur > 0 ? (globalTime - transition.startTime) / dur : 0;
          return { transition, progress: Math.min(1, Math.max(0, progress)), isBeforeClip: true };
        }
      } else {
        // after clip：从 clip 开始到转场结束
        if (globalTime >= clip.startTime && globalTime <= transition.endTime) {
          const dur = transition.endTime - clip.startTime;
          const progress = dur > 0 ? (globalTime - clip.startTime) / dur : 0;
          return { transition, progress: Math.min(1, Math.max(0, progress)), isBeforeClip: false };
        }
      }
    }
    return null;
  }

  // ─── 帧缓存更新 ────────────────────────────────────────────────────────────

  async function updateFrameCache(clipId: string, frame: VideoFrame | ImageBitmap) {
    try {
      const copy = await createImageBitmap(frame as ImageBitmap);
      const old = clipFrameCacheRef.current.get(clipId);
      old?.close();
      clipFrameCacheRef.current.set(clipId, copy);
    } catch {
      // 部分帧类型不可 createImageBitmap，忽略
    }
  }

  // ─── tickInterceptor 工厂 ──────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createTickInterceptor(
    clipId: string,
    clipStartTime: number,
    playbackRate: number,
    effectType?: Clip["effectType"],
    clipDuration?: number,
  ): (time: number, tickRet: any) => Promise<any> {
    // 每个 clip 独立的 canvas 缓存（避免跨帧重建 OffscreenCanvas）
    let workCanvas: OffscreenCanvas | null = null;
    let workCtx: OffscreenCanvasRenderingContext2D | null = null;
    let transCanvas: OffscreenCanvas | null = null;
    let transCtx: OffscreenCanvasRenderingContext2D | null = null;
    let effectCanvas: OffscreenCanvas | null = null;
    let effectCtx: OffscreenCanvasRenderingContext2D | null = null;

    /** 将特效变换应用到 frame，返回新 ImageBitmap（或 null 若无特效） */
    async function applyEffect(
      src: VideoFrame | ImageBitmap,
      w: number,
      h: number,
      clipRelTimeSec: number,
    ): Promise<ImageBitmap | null> {
      if (!effectType || !clipDuration) return null;
      const progress = Math.min(1, Math.max(0, clipRelTimeSec / clipDuration));
      const t = getEffectTransform(effectType, progress);

      if (!effectCanvas || effectCanvas.width !== w || effectCanvas.height !== h) {
        effectCanvas = new OffscreenCanvas(w, h);
        effectCtx = effectCanvas.getContext("2d");
      }
      if (!effectCtx) return null;

      effectCtx.clearRect(0, 0, w, h);
      effectCtx.save();
      effectCtx.globalAlpha = t.opacity ?? 1;
      // 以画布中心为变换原点
      effectCtx.translate(w / 2 + (t.offsetX ?? 0), h / 2 + (t.offsetY ?? 0));
      effectCtx.scale(t.scale ?? 1, t.scale ?? 1);
      effectCtx.rotate(((t.rotation ?? 0) * Math.PI) / 180);
      effectCtx.drawImage(src, -w / 2, -h / 2);
      effectCtx.restore();

      return createImageBitmap(effectCanvas);
    }

    function closeFrame(f: VideoFrame | ImageBitmap) {
      if ("close" in f && typeof (f as VideoFrame).close === "function") {
        (f as VideoFrame).close();
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (time: number, tickRet: any) => {
      const ret = tickRet as { video?: VideoFrame | ImageBitmap };
      if (!ret.video) return tickRet;

      const frame = ret.video;
      const width = "displayWidth" in frame ? (frame as VideoFrame).displayWidth : (frame as ImageBitmap).width;
      const height = "displayHeight" in frame ? (frame as VideoFrame).displayHeight : (frame as ImageBitmap).height;

      // clip 内部相对时间（秒）
      const clipRelSec = time / 1e6 / playbackRate;
      // clip 内部相对时间（微秒）→ 全局时间轴时间（秒）
      const globalTime = clipStartTime + clipRelSec;

      const transitionState = getActiveTransitionAtTime(clipId, globalTime);

      // ── 无转场：应用特效后透传 ───────────────────────────────────────────
      if (!transitionState) {
        await updateFrameCache(clipId, frame);
        const effected = await applyEffect(frame, width, height, clipRelSec);
        if (effected) {
          closeFrame(frame);
          return { ...ret, video: effected };
        }
        return tickRet;
      }

      const { transition, progress, isBeforeClip } = transitionState;

      // ── afterClip：混合 beforeClip 缓存帧 ─────────────────────────────
      if (!isBeforeClip) {
        const beforeFrame = clipFrameCacheRef.current.get(transition.beforeClipId);
        if (beforeFrame) {
          if (!transCanvas || transCanvas.width !== width || transCanvas.height !== height) {
            transCanvas = new OffscreenCanvas(width, height);
            transCtx = transCanvas.getContext("2d");
          }
          if (transCtx) {
            const renderer = getTransitionRenderer(transition.transitionType);
            renderer.render(transCtx, beforeFrame, frame, progress, width, height);
            closeFrame(frame);
            const blended = await createImageBitmap(transCanvas);
            // 特效叠加在转场结果之上
            const effected = await applyEffect(blended, width, height, clipRelSec);
            if (effected) { blended.close(); return { ...ret, video: effected }; }
            return { ...ret, video: blended };
          }
        }
        return tickRet;
      }

      // ── beforeClip：缓存帧 + 淡出 ─────────────────────────────────────
      if (!workCanvas || workCanvas.width !== width || workCanvas.height !== height) {
        workCanvas = new OffscreenCanvas(width, height);
        workCtx = workCanvas.getContext("2d");
      }
      if (workCtx) {
        workCtx.clearRect(0, 0, width, height);
        workCtx.globalAlpha = 1;
        workCtx.drawImage(frame, 0, 0);

        // 缓存完整亮度帧供 afterClip 使用
        const forCache = await createImageBitmap(workCanvas);
        const old = clipFrameCacheRef.current.get(clipId);
        old?.close();
        clipFrameCacheRef.current.set(clipId, forCache);

        // 淡出重绘
        workCtx.clearRect(0, 0, width, height);
        workCtx.globalAlpha = 1 - progress;
        workCtx.drawImage(frame, 0, 0);
        workCtx.globalAlpha = 1;

        closeFrame(frame);
        const faded = await createImageBitmap(workCanvas);
        const effected = await applyEffect(faded, width, height, clipRelSec);
        if (effected) { faded.close(); return { ...ret, video: effected }; }
        return { ...ret, video: faded };
      }

      return tickRet;
    };
  }

  // ── 同步 tracks → AVCanvas sprites ─────────────────────────────────────────
  const tracksKey = tracks
    .flatMap((t) => t.clips)
    .map((c) =>
      [
        c.id, c.type, c.startTime, c.duration,
        "url" in c ? c.url : "",
        "audioUrl" in c ? c.audioUrl : "",
        c.volume ?? "",
        c.trimStart ?? "",
        c.trimEnd ?? "",
        c.transitionType ?? "",
        c.effectType ?? "",
      ].join(":")
    )
    .join("|");

  useEffect(() => {
    syncPromiseRef.current = syncSprites();
  }, [tracksKey]);

  async function syncSprites() {
    const avCanvas = avCanvasRef.current;
    if (!avCanvas) return;

    syncAbortRef.current?.abort();
    const abort = new AbortController();
    syncAbortRef.current = abort;

    setSpritesLoading(true);
    try {
    const spriteMap = spriteMapRef.current;
    const snapshotMap = clipSnapshotRef.current;

    // 重新检测转场关联
    detectTransitions();

    // 清除帧缓存（转场关系可能变化，旧缓存不再有效）
    for (const frame of clipFrameCacheRef.current.values()) frame.close();
    clipFrameCacheRef.current.clear();

    // 需要渲染的 clip（视频 + 音频）
    const renderableClips = tracks.flatMap((t) =>
      t.clips.filter((c): c is Clip =>
        (c.type === "video" && !!c.url) ||
        ((c.type === "bgm" || c.type === "audio") && !!c.audioUrl)
      )
    );
    const currentIds = new Set(renderableClips.map((c) => c.id));

    // 删除已移除的 clip
    for (const [id, sprite] of spriteMap.entries()) {
      if (!currentIds.has(id)) {
        avCanvas.removeSprite(sprite);
        spriteMap.delete(id);
        snapshotMap.delete(id);
      }
    }

    // 新增或更新 clip
    for (const clip of renderableClips) {
      if (abort.signal.aborted) return;

      const snapKey = [
        clip.startTime, clip.duration,
        "url" in clip ? clip.url : "",
        "audioUrl" in clip ? clip.audioUrl : "",
        clip.volume ?? "",
        clip.trimStart ?? "",
        clip.trimEnd ?? "",
      ].join(":");

      const existing = spriteMap.get(clip.id);

      if (existing && snapshotMap.get(clip.id) === snapKey) continue;

      if (existing) {
        const oldSnap = snapshotMap.get(clip.id) ?? "";
        const oldParts = oldSnap.split(":");
        const newParts = snapKey.split(":");
        const urlChanged = oldParts[2] !== newParts[2] || oldParts[3] !== newParts[3];
        const trimChanged = oldParts[5] !== newParts[5] || oldParts[6] !== newParts[6];

        if (!urlChanged && !trimChanged) {
          // 仅 timing/volume 变化：直接更新 sprite.time
          const isAudio = clip.type === "bgm" || clip.type === "audio";
          const volumeChanged = oldParts[4] !== newParts[4];
          if (isAudio && volumeChanged) {
            // AudioClip 创建后无法修改 volume，必须重建
            avCanvas.removeSprite(existing);
            spriteMap.delete(clip.id);
            snapshotMap.delete(clip.id);
          } else {
            existing.time.offset = clip.startTime * 1e6;
            existing.time.duration = clip.duration * 1e6;
            snapshotMap.set(clip.id, snapKey);
            continue;
          }
        } else {
          avCanvas.removeSprite(existing);
          spriteMap.delete(clip.id);
          snapshotMap.delete(clip.id);
        }
      }

      if (abort.signal.aborted) return;
      const sprite = await buildSprite(clip, abort.signal);
      if (!sprite || abort.signal.aborted) continue;

      await avCanvas.addSprite(sprite);
      spriteMap.set(clip.id, sprite);
      snapshotMap.set(clip.id, snapKey);
    }

    if (!abort.signal.aborted && !isPlaying) {
      await avCanvas.previewFrame(playhead * 1e6).catch(() => {});
    }
    } finally {
      // 只有仍是当前这轮才收起 loading（被后一轮 abort 时不要误清）
      if (syncAbortRef.current === abort) setSpritesLoading(false);
    }
  }

  // ─── 根据 clip 创建 VisibleSprite ─────────────────────────────────────────

  async function buildSprite(clip: Clip, signal: AbortSignal): Promise<VisibleSprite | null> {
    try {
      if (clip.type === "video" && clip.url) {
        const res = await fetch(uploadUrl(clip.url));
        if (!res.ok || !res.body || signal.aborted) return null;

        let mp4Clip = new MP4Clip(res.body);
        await mp4Clip.ready;
        if (signal.aborted) { mp4Clip.destroy?.(); return null; }

        // ── trimStart / trimEnd：用 MP4Clip.split() 切出素材内部范围 ──────────
        const originalDuration = mp4Clip.meta.duration / 1e6; // → 秒
        const trimStart = clip.trimStart ?? 0;
        const trimEnd = clip.trimEnd ?? originalDuration;

        if (trimStart > TRIM_MARGIN && trimStart < originalDuration - TRIM_MARGIN) {
          try {
            const [before, after] = await mp4Clip.split(trimStart * 1e6);
            before.destroy();
            mp4Clip = after;
            await mp4Clip.ready;
          } catch { /* 安全边界保护，忽略分割失败 */ }
        }

        const keepDuration = trimEnd - trimStart;
        const curDuration = mp4Clip.meta.duration / 1e6;
        if (keepDuration > TRIM_MARGIN && keepDuration < curDuration - TRIM_MARGIN) {
          try {
            const [keep, discard] = await mp4Clip.split(keepDuration * 1e6);
            discard.destroy();
            mp4Clip = keep;
            await mp4Clip.ready;
          } catch { /* 忽略 */ }
        }

        if (signal.aborted) { mp4Clip.destroy?.(); return null; }

        // ── 转场 + 特效 tickInterceptor ────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mp4Clip as any).tickInterceptor = createTickInterceptor(
          clip.id, clip.startTime, 1,
          clip.effectType,
          clip.duration,
        );

        const sprite = new VisibleSprite(mp4Clip);
        sprite.time.offset = clip.startTime * 1e6;
        sprite.time.duration = clip.duration * 1e6;

        // contain-fit 到画布
        const { width: vw, height: vh } = mp4Clip.meta;
        if (vw && vh) {
          const vAspect = vw / vh;
          const cAspect = canvasWidth / canvasHeight;
          if (vAspect > cAspect) {
            const h = Math.round(canvasWidth / vAspect);
            sprite.rect.w = canvasWidth; sprite.rect.h = h;
            sprite.rect.x = 0; sprite.rect.y = Math.round((canvasHeight - h) / 2);
          } else {
            const w = Math.round(canvasHeight * vAspect);
            sprite.rect.w = w; sprite.rect.h = canvasHeight;
            sprite.rect.x = Math.round((canvasWidth - w) / 2); sprite.rect.y = 0;
          }
        } else {
          sprite.rect.x = 0; sprite.rect.y = 0;
          sprite.rect.w = canvasWidth; sprite.rect.h = canvasHeight;
        }

        sprite.interactable = "disabled";
        return sprite;

      } else if ((clip.type === "bgm" || clip.type === "audio") && clip.audioUrl) {
        const res = await fetch(uploadUrl(clip.audioUrl));
        if (!res.ok || !res.body || signal.aborted) return null;

        const volume = muted ? 0 : (clip.volume ?? 0.5);
        const audioClip = new AudioClip(res.body, { volume });
        await audioClip.ready;
        if (signal.aborted) { audioClip.destroy?.(); return null; }

        const sprite = new VisibleSprite(audioClip);
        sprite.time.offset = clip.startTime * 1e6;
        sprite.time.duration = clip.duration * 1e6;
        return sprite;
      }
    } catch (e) {
      if (!signal.aborted) console.error("[VideoPreview] buildSprite error:", e);
    }
    return null;
  }

  // 同步 isPlayingRef
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // ── 外部 playhead 跳转检测 ─────────────────────────────────────────────────
  useEffect(() => {
    const diff = Math.abs(playhead - avCanvasTimeRef.current);
    if (diff < 0.3) return;

    const avCanvas = avCanvasRef.current;
    if (!avCanvas) return;

    if (isPlayingRef.current) {
      const totalSec = totalDuration();
      avCanvas.play({ start: playhead * 1e6, end: totalSec * 1e6 });
    } else {
      avCanvas.previewFrame(playhead * 1e6).catch(() => {});
    }
    avCanvasTimeRef.current = playhead;
  }, [playhead]);

  // ── 播放控制 ────────────────────────────────────────────────────────────────
  async function handlePlay() {
    const avCanvas = avCanvasRef.current;
    if (!avCanvas || total === 0) return;

    if (isPlaying) {
      avCanvas.pause();
      isPlayingRef.current = false;
      setPlaying(false);
    } else {
      // 必须等素材全部就绪再播 —— 否则会播到「已加载部分的末尾」就触发 ended，
      // 进度归零并停止（用户看到的是「第一次点播放会中途停下」）
      await syncPromiseRef.current;
      if (!avCanvasRef.current) return;

      const start = playhead >= total ? 0 : playhead;
      if (start === 0 && playhead >= total) {
        avCanvasTimeRef.current = 0;
        setPlayhead(0);
      }
      avCanvas.play({ start: start * 1e6, end: total * 1e6 });
      isPlayingRef.current = true;
      setPlaying(true);
    }
  }

  function handleSeek(time: number) {
    const avCanvas = avCanvasRef.current;
    if (!avCanvas) return;
    avCanvas.pause();
    isPlayingRef.current = false;
    setPlaying(false);
    avCanvasTimeRef.current = time;
    setPlayhead(time);
    avCanvas.previewFrame(time * 1e6).catch(() => {});
  }

  // ── 静音（需重建 AudioClip sprite）────────────────────────────────────────
  useEffect(() => {
    for (const [id, sprite] of spriteMapRef.current.entries()) {
      const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === id);
      if (clip && (clip.type === "bgm" || clip.type === "audio")) {
        avCanvasRef.current?.removeSprite(sprite);
        spriteMapRef.current.delete(id);
        clipSnapshotRef.current.delete(id);
      }
    }
    syncSprites();
  }, [muted]);

  // ── 导出（服务端 ffmpeg：concat libx264 归零 PTS → BGM adelay 精确对齐）────────
  async function handleExport() {
    if (total === 0) return;
    setExporting(true);
    setExportSeconds(0);
    setExportStage("准备中…");
    const timer = setInterval(() => setExportSeconds((s) => s + 1), 1000);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeline: { tracks, canvasWidth, canvasHeight, globalSubtitleStyle: useEditorStore.getState().globalSubtitleStyle } }),
        }
      );
      if (!res.ok || !res.body) throw new Error("Render request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let outputUrl = "";
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as
              | { type: "progress"; message: string }
              | { type: "done"; outputUrl: string }
              | { type: "error"; message: string };
            if (event.type === "progress") {
              setExportStage(event.message);
            } else if (event.type === "done") {
              outputUrl = event.outputUrl;
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (!outputUrl) throw new Error("No output URL received");
      setExportStage("完成！");
      const a = document.createElement("a");
      a.href = uploadUrl(outputUrl);
      a.download = `export-${Date.now()}.mp4`;
      a.click();
    } catch (e) {
      alert("导出失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      clearInterval(timer);
      setExporting(false);
      setExportSeconds(0);
      setExportStage("");
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col bg-[#111] items-center justify-between">
      {/* Canvas 预览区 + 字幕叠加 */}
      <div className="relative flex flex-1 w-full overflow-hidden bg-black items-center justify-center">
        <div
          ref={containerRef}
          className="max-h-full max-w-full"
          style={{ aspectRatio: `${canvasWidth}/${canvasHeight}` }}
        />

        {/* 字幕 DOM 叠加 */}
        {activeSubtitle?.text && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-[85%] text-center pointer-events-none">
            <span
              className="inline-block rounded px-3 py-1 text-[13px] font-medium leading-snug text-white"
              style={{ background: "rgba(0,0,0,0.65)", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
            >
              {activeSubtitle.text}
            </span>
          </div>
        )}

        {tracks.flatMap((t) => t.clips).filter((c) => c.type === "video").length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[12px] text-white/40">从左侧媒体库添加视频片段</p>
          </div>
        )}
      </div>

      {/* 控制栏 */}
      <div className="w-full bg-[#1a1a1a] px-4 py-2 flex items-center gap-3">
        <span className="font-mono text-[11px] text-white/70 w-28 shrink-0">
          {formatTime(playhead)} / {formatTime(total)}
        </span>

        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.05}
          value={playhead}
          onChange={(e) => handleSeek(parseFloat(e.target.value))}
          className="flex-1 accent-red-500"
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => handleSeek(0)}
            className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handlePlay}
            disabled={total === 0 || spritesLoading}
            title={spritesLoading ? "素材加载中…" : undefined}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 disabled:opacity-40"
          >
            {spritesLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 translate-x-0.5" />
            )}
          </button>
          <button
            onClick={() => handleSeek(total)}
            className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10"
            title={muted ? "取消静音" : "静音"}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <div className="mx-1 h-4 w-px bg-white/20" />
          <button
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
          >
            {exporting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{exportStage || "渲染中…"} {exportSeconds}s</>
              : <><Download className="h-3.5 w-3.5" />导出 MP4</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
