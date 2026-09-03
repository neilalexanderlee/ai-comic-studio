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
import { fetchMedia } from "./utils/mediaCache";
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
   * 当前这轮 syncSprites 的 promise —— **整轮**素材就绪。
   *
   * 播放不再等它（见 readyGateRef）：导出、以及需要"全部素材都在场"的操作才 await 它。
   */
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  /**
   * 渐进可播的门：只等**播放头附近**的素材就绪，其余在后台继续加载。
   *
   * 为什么需要一道门（而不是直接放开播放）：素材还没 addSprite 就 play()，
   * 那几秒会是黑屏/无声；更早还出现过"第一次点播放，播一会儿进度归零并停止"——
   * 那个是 syncSprites 结尾用 stale 闭包值调 previewFrame 造成的（见该处注释），
   * 已单独修掉，不再靠"整轮加载完才准播"来掩盖。
   */
  const readyGateRef = useRef<Promise<void> | null>(null);
  /** clipId → 该 clip 的构建 promise（供 stall guard 精确等待某一条） */
  const clipLoadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  /** 播放追上加载时的兜底：正在等待缓冲，避免重入 */
  const stallGuardRef = useRef(false);
  /** 播放头前瞻窗口（秒）：门只等这个窗口内的素材 */
  const READY_LOOKAHEAD_SECONDS = 8;
  /** 用户每次 play / pause / seek 自增；stall guard 用它判断"缓冲期间用户是否已另有动作" */
  const userActionRef = useRef(0);
  const [buffering, setBuffering] = useState(false);
  /**
   * 并发构建数。
   *
   * 开销是「网络下载 + mp4box 解析」，解析在主线程上本来就串行，加大并发只增加内存驻留
   * （MP4Clip 会把整段素材的 sample 全留在内存），不增加吞吐。4 条并行下载足以喂饱
   * 主线程解析，又低于浏览器单域连接上限；万一某集没有预览代理、回落到源片，
   * 4 × 几十 MB 的驻留也还安全。
   */
  const BUILD_CONCURRENCY = 4;
  /** 播放按钮的门：false = 播放头附近素材尚未就绪 */
  const [playable, setPlayable] = useState(true);
  /** 后台加载进度，仅用于提示文案（done/total），不阻塞任何操作 */
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number } | null>(null);

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
      guardAgainstStall(t / 1e6);
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
        "previewUrl" in c ? c.previewUrl : "",
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

  /**
   * 把 tracks 的当前状态同步成 AVCanvas 上的 sprite 集合。
   *
   * ## 为什么是有限并发 + 渐进可播
   *
   * 每个 clip 的构建都是「fetch → new MP4Clip(stream) → await ready」，而 `MP4Clip.ready`
   * 要等**整个流下载并解析完**才 resolve（av-cliper 1.2.8）。原先这些构建是串行的，
   * 一集十几条素材串起来要一分多钟，期间播放按钮全程禁用。
   *
   * 现在分两步：
   *  1. **diff 是同步的**（删除、纯 timing/volume 更新就地完成），只有真需要重建的进队列；
   *  2. 队列按「离播放头的距离」排序，由 BUILD_CONCURRENCY 个 worker 并发消费。
   *
   * 播放的门只等**播放头附近**那几条（readyGateRef），其余边播边补。加载速度
   * （代理约 0.8MB/条）远快于实时播放（5~10s/条），正常情况下加载始终跑在播放头前面；
   * 万一被追上，timeupdate 里的 stall guard 会暂停等待而不是放任黑屏。
   */
  async function syncSprites() {
    const avCanvas = avCanvasRef.current;
    if (!avCanvas) return;

    syncAbortRef.current?.abort();
    const abort = new AbortController();
    syncAbortRef.current = abort;
    clipLoadPromisesRef.current = new Map();

    const startedAt = performance.now();
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

    // ── 第一遍（全同步）：diff。能就地更新的当场更新，剩下的进构建队列 ──────────
    const queue: { clip: Clip; snapKey: string }[] = [];
    for (const clip of renderableClips) {
      const snapKey = [
        clip.startTime, clip.duration,
        // 解码源是 previewUrl || url，两者任一变化都要重建 sprite
        "url" in clip ? (clip.previewUrl || clip.url) : "",
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

      queue.push({ clip, snapKey });
    }

    // ── 第二遍：排序 + 开门条件 ────────────────────────────────────────────────
    // 播放头位置读 store 的**当前**值，不用组件闭包里的 playhead（这轮 sync 可能是
    // 上一次渲染排队过来的，闭包值已经过期）。
    const headAt = useEditorStore.getState().playhead;
    const priority = (c: Clip): number => {
      if (c.startTime <= headAt && headAt < c.endTime) return -1;   // 正压在播放头上
      if (c.startTime >= headAt) return c.startTime - headAt;       // 播放头之后，越近越先
      return 1e6 + (headAt - c.endTime);                            // 播放头之前，最后补
    };
    queue.sort((a, b) => priority(a.clip) - priority(b.clip));

    // 门只等「与 [播放头, 播放头+前瞻] 有交集」的 clip
    const gateIds = new Set(
      queue
        .filter((q) => q.clip.startTime < headAt + READY_LOOKAHEAD_SECONDS && q.clip.endTime > headAt)
        .map((q) => q.clip.id)
    );
    let gateRemaining = gateIds.size;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    readyGateRef.current = gate;
    if (gateRemaining === 0) releaseGate();
    setPlayable(gateRemaining === 0);
    setLoadProgress(queue.length > 0 ? { done: 0, total: queue.length } : null);

    let done = 0;
    const isCurrentRound = () => syncAbortRef.current === abort;
    /** 门打开时：解禁播放按钮，并（若未在播放）立刻画出播放头那一帧 */
    const openGate = () => {
      releaseGate();
      if (!isCurrentRound()) return;
      setPlayable(true);
      console.log(
        `[VideoPreview] playable in ${Math.round(performance.now() - startedAt)}ms ` +
          `(${gateIds.size}/${queue.length} clips)`
      );
      if (!isPlayingRef.current && !abort.signal.aborted) {
        avCanvas.previewFrame(useEditorStore.getState().playhead * 1e6).catch(() => {});
      }
    };

    const runTask = async (task: { clip: Clip; snapKey: string }) => {
      const work = (async () => {
        const sprite = await buildSprite(task.clip, abort.signal);
        if (!sprite) return;
        if (abort.signal.aborted) { sprite.destroy(); return; }
        await avCanvas.addSprite(sprite);
        if (abort.signal.aborted) { avCanvas.removeSprite(sprite); return; }
        spriteMap.set(task.clip.id, sprite);
        snapshotMap.set(task.clip.id, task.snapKey);
      })();
      // 留在 map 里不删：stall guard 会 await 它，已完成的 promise await 是零成本
      clipLoadPromisesRef.current.set(task.clip.id, work);
      try {
        await work;
      } finally {
        done++;
        if (isCurrentRound()) setLoadProgress({ done, total: queue.length });
        if (gateIds.has(task.clip.id) && --gateRemaining === 0) openGate();
      }
    };

    try {
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(BUILD_CONCURRENCY, queue.length) }, async () => {
          while (!abort.signal.aborted) {
            const index = cursor++;
            if (index >= queue.length) break;
            await runTask(queue[index]);
          }
        })
      );

      // 结尾补一帧。⚠️ 这里必须读 isPlayingRef / store 的**当前**值：
      // previewFrame 内部会先 pause() 再把时间强设为传入值，用 stale 的闭包值调用
      // 就是老 bug「第一次点播放，播一会儿进度归零并停止」的真正成因 ——
      // sync 期间用户点了播放，sync 结束时却以为自己还处在暂停态、还停在 0 秒。
      if (!abort.signal.aborted && !isPlayingRef.current) {
        await avCanvas.previewFrame(useEditorStore.getState().playhead * 1e6).catch(() => {});
      }
      if (queue.length > 0 && isCurrentRound()) {
        console.log(
          `[VideoPreview] all sprites ready in ${Math.round(performance.now() - startedAt)}ms ` +
            `(${queue.length} clips)`
        );
      }
    } finally {
      // 被 abort 时也要开门，否则 await 这个 gate 的 handlePlay 会永远挂着
      releaseGate();
      if (isCurrentRound()) {
        setPlayable(true);
        setLoadProgress(null);
      }
    }
  }

  // ─── 根据 clip 创建 VisibleSprite ─────────────────────────────────────────

  async function buildSprite(clip: Clip, signal: AbortSignal): Promise<VisibleSprite | null> {
    try {
      if (clip.type === "video" && clip.url) {
        // 浏览器解码一律走低码率代理；clip.url（源片）只留给服务端导出。
        // 直接解 1080p 源片会把音频解码线程饿死（MP4Clip.tick audio timeout），
        // 且每次打开编辑器都要从 OSS 拉几十 MB。
        const videoRef = clip.previewUrl || clip.url;
        const res = await fetchMedia(videoRef, uploadUrl(videoRef), signal);
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
        const res = await fetchMedia(clip.audioUrl, uploadUrl(clip.audioUrl), signal);
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

  /**
   * 播放追上加载时的兜底。
   *
   * 渐进可播只保证播放头附近就绪，理论上播放头可能跑到还没构建的 clip 上。
   * 正常情况下不会发生（一条 480p 代理约 0.2~0.5s 就绪，而一个镜头要播 5~10s，
   * 加载始终跑在前面），但真发生时，"黑屏若干秒"是最糟的表现形式 ——
   * 这里改成像普通播放器那样暂停缓冲、就绪后从原处续播。
   */
  function guardAgainstStall(currentSec: number) {
    if (!isPlayingRef.current || stallGuardRef.current) return;
    const avCanvas = avCanvasRef.current;
    if (!avCanvas) return;

    const lookAt = currentSec + 0.5;
    const pending = useEditorStore
      .getState()
      .tracks.flatMap((t) => t.clips)
      .filter(
        (c) =>
          (c.type === "video" || c.type === "bgm" || c.type === "audio") &&
          c.startTime <= lookAt &&
          lookAt < c.endTime &&
          !spriteMapRef.current.has(c.id) &&
          clipLoadPromisesRef.current.has(c.id)
      );
    if (pending.length === 0) return;

    stallGuardRef.current = true;
    setBuffering(true);
    const token = userActionRef.current;
    const resumeAt = currentSec;
    avCanvas.pause();
    isPlayingRef.current = false;

    Promise.all(pending.map((c) => clipLoadPromisesRef.current.get(c.id)))
      .catch(() => {})
      .then(() => {
        stallGuardRef.current = false;
        setBuffering(false);
        // 缓冲期间用户自己按了播放/暂停/拖了进度条 → 尊重用户的操作，不抢回控制权
        if (userActionRef.current !== token) return;
        const cvs = avCanvasRef.current;
        if (!cvs) return;
        const end = totalDuration();
        if (resumeAt >= end) return;
        cvs.play({ start: resumeAt * 1e6, end: end * 1e6 });
        isPlayingRef.current = true;
        setPlaying(true);
      });
  }

  // ── 播放控制 ────────────────────────────────────────────────────────────────
  async function handlePlay() {
    const avCanvas = avCanvasRef.current;
    if (!avCanvas || total === 0) return;
    userActionRef.current++;

    if (isPlaying) {
      avCanvas.pause();
      isPlayingRef.current = false;
      setPlaying(false);
    } else {
      // 只等播放头附近的素材（渐进可播），不等整轮加载完。
      // 循环是为了处理"等门的过程中又开了新一轮 sync"——那时旧门已被 finally 释放，
      // 但真正该等的是新门。
      for (let i = 0; i < 3; i++) {
        const gate = readyGateRef.current;
        if (!gate) break;
        await gate;
        if (readyGateRef.current === gate) break;
      }
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
    userActionRef.current++;
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
    syncPromiseRef.current = syncSprites();
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
            disabled={total === 0 || !playable}
            title={!playable ? "播放头附近的素材加载中…" : undefined}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 disabled:opacity-40"
          >
            {!playable ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              // lucide 的 Play 路径本身就偏右（x 5→20.008，几何中心 12.5 vs viewBox 的 12），
              // 再推 2px 会明显偏出圆心；1px 刚好补上三角形视觉重心偏左的错觉
              <Play className="h-4 w-4 translate-x-px" />
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
          {buffering && (
            <span className="flex items-center gap-1 text-[10px] text-white/70">
              <Loader2 className="h-3 w-3 animate-spin" />
              缓冲中
            </span>
          )}
          {/* 后台加载进度：已可播放，只是还有素材在补 —— 纯提示，不挡任何操作 */}
          {!buffering && loadProgress && loadProgress.done < loadProgress.total && (
            <span className="flex items-center gap-1 text-[10px] tabular-nums text-white/50">
              <Loader2 className="h-3 w-3 animate-spin" />
              {loadProgress.done}/{loadProgress.total}
            </span>
          )}
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
