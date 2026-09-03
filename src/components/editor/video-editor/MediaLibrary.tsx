"use client";

import { useState } from "react";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useEditorStore } from "./hooks/useEditorStore";
import { getTrackEndTime, hasSpaceInTrack } from "./utils/trackHelper";
import { TRANSITION_OPTIONS } from "./utils/transitionHelper";
import { FILTER_OPTIONS, EFFECT_OPTIONS } from "./utils/filterEffect";
import { formatTime } from "./utils/clipMeta";
import type { Clip, TransitionType } from "./utils/clipMeta";
import { Film, Music, Type, Zap, Shuffle, ChevronRight, Loader2 } from "lucide-react";

type Tab = "video" | "audio" | "subtitle" | "transition" | "effect";

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  videoUrl: string | null;
  /** 低码率预览代理；编辑器优先用它，导出仍用 videoUrl */
  previewUrl?: string | null;
  /** 视频封面帧；anchorFirst 为空的分镜靠它显示缩略图 */
  posterUrl?: string | null;
  duration: number;
  anchorFirst?: string | null;
}

interface AudioItem {
  id: string;
  name: string;
  url: string;
  duration?: number;
}

interface MediaLibraryProps {
  shots: Shot[];
  audioItems?: AudioItem[];
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "video", label: "视频", icon: <Film className="h-3.5 w-3.5" /> },
  { id: "audio", label: "音频", icon: <Music className="h-3.5 w-3.5" /> },
  { id: "subtitle", label: "字幕", icon: <Type className="h-3.5 w-3.5" /> },
  { id: "transition", label: "转场", icon: <Shuffle className="h-3.5 w-3.5" /> },
  { id: "effect", label: "特效", icon: <Zap className="h-3.5 w-3.5" /> },
];

export function MediaLibrary({ shots, audioItems = [] }: MediaLibraryProps) {
  const [tab, setTab] = useState<Tab>("video");
  const [bgmUploading, setBgmUploading] = useState(false);

  const tracks = useEditorStore((s) => s.tracks);
  const addTrack = useEditorStore((s) => s.addTrack);
  const addClip = useEditorStore((s) => s.addClip);
  const addTransition = useEditorStore((s) => s.addTransition);
  const updateClip = useEditorStore((s) => s.updateClip);
  const getSelectedClip = useEditorStore((s) => s.getSelectedClip);

  function getOrCreateTrack(type: "video" | "audio" | "subtitle" | "bgm") {
    const existing = tracks.find((t) => t.type === type);
    if (existing) return existing;
    return addTrack(type);
  }

  function addVideoClip(shot: Shot) {
    if (!shot.videoUrl) return;
    const track = getOrCreateTrack("video");
    const startTime = getTrackEndTime(track);
    addClip(track.id, {
      type: "video",
      name: `分镜 ${shot.sequence}`,
      // url 必须是源片：render 路由是按 clip.url 去 ffmpeg concat 的，
      // 把代理写进 url 会让这条 clip 的导出画质降级成 480p。
      // 浏览器解码走 previewUrl（直接解 1080p 源片会把音频解码线程饿死并严重卡顿）。
      url: shot.videoUrl,
      previewUrl: shot.previewUrl ?? undefined,
      shotId: shot.id,
      thumbnailUrl: shot.anchorFirst ?? shot.posterUrl ?? undefined,
      startTime,
      duration: shot.duration || 10,
    });
  }

  function addAllVideoClips() {
    // 已在时间线上的 shotId
    const existingShots = new Set(
      tracks.flatMap((t) => t.clips.map((c) => c.shotId).filter(Boolean))
    );
    const toAdd = shots
      .filter((s) => s.videoUrl && !existingShots.has(s.id))
      .sort((a, b) => a.sequence - b.sequence);
    if (!toAdd.length) return;

    // 只创建一次轨道，手动追踪 cursor 避免读取 stale state
    const track = getOrCreateTrack("video");
    let cursor = getTrackEndTime(track);

    for (const shot of toAdd) {
      const duration = shot.duration || 10;
      addClip(track.id, {
        type: "video",
        name: `分镜 ${shot.sequence}`,
        url: shot.videoUrl!,
        previewUrl: shot.previewUrl ?? undefined,
        shotId: shot.id,
        thumbnailUrl: shot.anchorFirst ?? shot.posterUrl ?? undefined,
        startTime: cursor,
        duration,
      });
      cursor += duration;
    }
  }

  function addAudioClip(item: AudioItem, type: "audio" | "bgm" = "audio", atStartTime?: number) {
    const track = getOrCreateTrack(type);
    const startTime = atStartTime ?? getTrackEndTime(track);
    addClip(track.id, {
      type,
      name: item.name,
      audioUrl: item.url,
      startTime,
      duration: item.duration || 30,
      volume: 0.3,
    });
  }

  function addSubtitleClip() {
    const track = getOrCreateTrack("subtitle");
    const startTime = getTrackEndTime(track);
    addClip(track.id, {
      type: "subtitle",
      name: "新字幕",
      text: "在这里输入字幕文字",
      startTime,
      duration: 3,
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
  }

  function applyTransition(type: TransitionType) {
    // 找视频轨所有视频 clip，按时间排序
    const videoTrack = tracks.find((t) => t.type === "video");
    if (!videoTrack) return;
    const clips = [...videoTrack.clips]
      .filter((c) => c.type === "video")
      .sort((a, b) => a.startTime - b.startTime);
    if (clips.length < 2) { alert("请先添加至少 2 个视频片段，再添加转场"); return; }

    // 优先：在当前选中 clip 和下一个 clip 之间插入
    const selected = getSelectedClip();
    if (selected && selected.type === "video") {
      const idx = clips.findIndex((c) => c.id === selected.id);
      if (idx >= 0 && idx < clips.length - 1) {
        addTransition(clips[idx].id, clips[idx + 1].id, type, 1);
        return;
      }
      // 选中的是最后一个：找上一个
      if (idx === clips.length - 1 && idx > 0) {
        addTransition(clips[idx - 1].id, clips[idx].id, type, 1);
        return;
      }
    }

    // 未选中 clip：插入到最后两个之间（兜底）
    const last = clips[clips.length - 1];
    const prev = clips[clips.length - 2];
    addTransition(prev.id, last.id, type, 1);
  }

  return (
    <div className="flex h-full flex-col border-r border-[--border-subtle] bg-white">
      {/* 标签栏 */}
      <div className="flex border-b border-[--border-subtle] overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-1 px-3 py-2 text-[11px] font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-primary text-primary"
                : "text-[--text-muted] hover:text-[--text-primary]"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">

        {/* 视频素材 */}
        {tab === "video" && (
          <>
            <div className="flex items-center justify-between px-1">
              <p className="text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">分镜视频</p>
              {shots.filter((s) => s.videoUrl).length > 0 && (
                <button
                  onClick={addAllVideoClips}
                  className="flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                  title="按顺序把所有分镜视频加入时间线（已在时间线上的跳过）"
                >
                  <ChevronRight className="h-2.5 w-2.5" />
                  全部加入
                </button>
              )}
            </div>
            {shots.filter((s) => s.videoUrl).length === 0 && (
              <p className="py-4 text-center text-[11px] text-[--text-muted]">暂无已生成的分镜视频</p>
            )}
            {shots
              .filter((s) => s.videoUrl)
              .map((shot) => (
                <div
                  key={shot.id}
                  className="flex items-center gap-2 rounded-lg border border-[--border-subtle] bg-[--surface] p-1.5 cursor-pointer hover:border-primary/40 hover:bg-primary/3 transition-colors"
                  onClick={() => addVideoClip(shot)}
                  title="点击添加到时间线"
                >
                  {(shot.anchorFirst ?? shot.posterUrl) ? (
                    <img
                      src={uploadUrl((shot.anchorFirst ?? shot.posterUrl)!)}
                      className="h-10 w-16 shrink-0 rounded object-cover"
                      alt=""
                    />
                  ) : (
                    <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-[--border-subtle]">
                      <Film className="h-4 w-4 text-[--text-muted]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-[--text-primary]">
                      分镜 {shot.sequence}
                    </p>
                    <p className="truncate text-[10px] text-[--text-muted]">{shot.prompt?.slice(0, 30)}</p>
                    <p className="text-[9px] text-[--text-muted]">{shot.duration}s</p>
                  </div>
                  <ChevronRight className="h-3 w-3 text-[--text-muted] shrink-0" />
                </div>
              ))}
          </>
        )}

        {/* 音频素材 */}
        {tab === "audio" && (
          <>
            <p className="px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">音效轨道</p>
            {audioItems.length === 0 && (
              <p className="py-4 text-center text-[11px] text-[--text-muted]">暂无音频素材</p>
            )}
            {audioItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-[--border-subtle] bg-[--surface] p-2 cursor-pointer hover:border-primary/40 transition-colors"
              >
                <Music className="h-4 w-4 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[11px] font-medium">{item.name}</p>
                  {item.duration && <p className="text-[9px] text-[--text-muted]">{formatTime(item.duration)}</p>}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => addAudioClip(item, "audio")}
                    className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary hover:bg-primary/20"
                  >
                    音效
                  </button>
                  <button
                    onClick={() => addAudioClip(item, "bgm")}
                    className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-700 hover:bg-purple-200"
                  >
                    BGM
                  </button>
                </div>
              </div>
            ))}
            <p className="mt-3 px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">背景音乐</p>
            <p className="px-1 text-[10px] text-[--text-muted]">在时间线多选分镜片段，即可在顶部工具栏生成并放置 BGM。</p>

            <div
              className={`flex items-center gap-2 rounded-lg border border-dashed border-[--border-subtle] bg-[--surface]/50 p-2 transition-colors ${bgmUploading ? "opacity-60 cursor-wait" : "cursor-pointer hover:border-purple-300"}`}
              onClick={async () => {
                if (bgmUploading) return;
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac";
                input.onchange = async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  setBgmUploading(true);
                  try {
                    // 先读真实时长
                    const audioDuration = await new Promise<number>((resolve) => {
                      const a = new Audio();
                      const objUrl = URL.createObjectURL(file);
                      a.addEventListener("loadedmetadata", () => {
                        URL.revokeObjectURL(objUrl);
                        resolve(isFinite(a.duration) ? a.duration : 120);
                      }, { once: true });
                      a.addEventListener("error", () => { URL.revokeObjectURL(objUrl); resolve(120); }, { once: true });
                      a.src = objUrl;
                    });
                    const form = new FormData();
                    form.append("file", file);
                    const res = await fetch("/api/uploads/audio", { method: "POST", body: form });
                    if (!res.ok) throw new Error("上传失败");
                    const { filePath } = await res.json() as { filePath: string };
                    addAudioClip({ id: filePath, name: file.name, url: filePath, duration: audioDuration }, "bgm");
                  } catch (e) {
                    alert("BGM 上传失败：" + (e instanceof Error ? e.message : String(e)));
                  } finally {
                    setBgmUploading(false);
                  }
                };
                input.click();
              }}
            >
              {bgmUploading
                ? <Loader2 className="h-4 w-4 text-purple-400 shrink-0 animate-spin" />
                : <Music className="h-4 w-4 text-purple-400 shrink-0" />
              }
              <p className="text-[11px] text-[--text-muted]">
                {bgmUploading ? "上传中…" : "上传本地 BGM 文件"}
              </p>
            </div>
          </>
        )}

        {/* 字幕 */}
        {tab === "subtitle" && (
          <>
            <p className="px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">添加字幕</p>
            <button
              onClick={addSubtitleClip}
              className="w-full flex items-center gap-2 rounded-lg border border-[--border-subtle] bg-[--surface] p-2 hover:border-primary/40 hover:bg-primary/3 transition-colors text-left"
            >
              <Type className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-[11px] font-medium text-[--text-primary]">添加字幕块</p>
                <p className="text-[10px] text-[--text-muted]">点击后在时间线末尾追加 3s 字幕</p>
              </div>
            </button>
          </>
        )}

        {/* 转场 */}
        {tab === "transition" && (() => {
          const selectedClip = getSelectedClip();
          const isVideoSelected = selectedClip?.type === "video";
          return (
            <>
              <p className="px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">转场效果</p>
              <p className="px-1 text-[10px] text-[--text-muted]">
                {isVideoSelected
                  ? `拖拽到时间线，或点击插入到「${selectedClip.name}」相邻处`
                  : "拖拽到时间线片段接缝处；或先选中片段再点击"}
              </p>
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {TRANSITION_OPTIONS.map((opt) => (
                  <div
                    key={opt.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("x-drag/transition", opt.type);
                      e.dataTransfer.setData("application/json", JSON.stringify({ type: "transition", subType: opt.type, label: opt.label }));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => applyTransition(opt.type)}
                    className="rounded-lg border border-[--border-subtle] bg-[--surface] px-2 py-2 text-[11px] font-medium text-[--text-primary] hover:border-primary/40 hover:bg-primary/3 transition-colors cursor-grab active:cursor-grabbing select-none text-center"
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* 特效 */}
        {tab === "effect" && (() => {
          const selectedClip = getSelectedClip();
          const isVideoSelected = selectedClip?.type === "video";
          return (
            <>
              <p className="px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">画面特效</p>
              <p className="px-1 text-[10px] text-[--text-muted] pb-1">
                {isVideoSelected
                  ? `拖拽到片段，或点击应用到「${selectedClip.name}」`
                  : "拖拽到时间线的视频片段上；或先选中片段再点击"}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_OPTIONS.map((opt) => {
                  const isActive = selectedClip?.effectType === opt.type;
                  return (
                    <div
                      key={opt.type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("x-drag/effect", opt.type);
                        e.dataTransfer.setData("application/json", JSON.stringify({ type: "effect", subType: opt.type, label: opt.label }));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => {
                        if (!selectedClip) return;
                        updateClip(selectedClip.id, {
                          effectType: isActive ? undefined : opt.type as Clip["effectType"],
                        });
                      }}
                      className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors cursor-grab active:cursor-grabbing select-none text-center ${
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-[--border-subtle] bg-[--surface] text-[--text-primary] hover:border-primary/40 hover:bg-primary/3"
                      }`}
                    >
                      {opt.label}
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}

      </div>
    </div>
  );
}
