"use client";

import { useState } from "react";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useEditorStore } from "./hooks/useEditorStore";
import { getTrackEndTime, hasSpaceInTrack } from "./utils/trackHelper";
import { TRANSITION_OPTIONS } from "./utils/transitionHelper";
import { FILTER_OPTIONS, EFFECT_OPTIONS } from "./utils/filterEffect";
import { formatTime } from "./utils/clipMeta";
import type { TransitionType } from "./utils/clipMeta";
import { Film, Music, Type, Layers, Zap, Shuffle, ChevronRight } from "lucide-react";

type Tab = "video" | "audio" | "subtitle" | "transition" | "effect";

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  videoUrl: string | null;
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
  const tracks = useEditorStore((s) => s.tracks);
  const addTrack = useEditorStore((s) => s.addTrack);
  const addClip = useEditorStore((s) => s.addClip);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const addTransition = useEditorStore((s) => s.addTransition);
  const getClipById = useEditorStore((s) => s.getClipById);

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
      url: shot.videoUrl,
      shotId: shot.id,
      thumbnailUrl: shot.anchorFirst ?? undefined,
      startTime,
      duration: shot.duration || 10,
    });
  }

  function addAudioClip(item: AudioItem, type: "audio" | "bgm" = "audio") {
    const track = getOrCreateTrack(type);
    const startTime = getTrackEndTime(track);
    addClip(track.id, {
      type,
      name: item.name,
      audioUrl: item.url,
      startTime,
      duration: item.duration || 30,
      volume: 1,
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
    // 找视频轨的最后两个 clip 之间插入转场
    const videoTrack = tracks.find((t) => t.type === "video");
    if (!videoTrack) return;
    const clips = [...videoTrack.clips]
      .filter((c) => c.type === "video")
      .sort((a, b) => a.startTime - b.startTime);
    if (clips.length < 2) { alert("请先添加至少 2 个视频片段，再添加转场"); return; }
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
            <p className="px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">分镜视频</p>
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
                  {shot.anchorFirst ? (
                    <img
                      src={uploadUrl(shot.anchorFirst)}
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
            <div
              className="flex items-center gap-2 rounded-lg border border-dashed border-[--border-subtle] bg-[--surface]/50 p-2 cursor-pointer hover:border-purple-300 transition-colors"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "audio/*";
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const url = URL.createObjectURL(file);
                  addAudioClip({ id: url, name: file.name, url, duration: 60 }, "bgm");
                };
                input.click();
              }}
            >
              <Music className="h-4 w-4 text-purple-400 shrink-0" />
              <p className="text-[11px] text-[--text-muted]">上传本地 BGM 文件</p>
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
        {tab === "transition" && (
          <>
            <p className="px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">转场效果</p>
            <p className="px-1 text-[10px] text-[--text-muted]">点击后插入到视频轨最后两个片段之间</p>
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {TRANSITION_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  onClick={() => applyTransition(opt.type)}
                  className="rounded-lg border border-[--border-subtle] bg-[--surface] px-2 py-2 text-[11px] font-medium text-[--text-primary] hover:border-primary/40 hover:bg-primary/3 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* 特效 */}
        {tab === "effect" && (
          <>
            <p className="px-1 text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">画面特效</p>
            <p className="px-1 text-[10px] text-[--text-muted] pb-1">选中视频片段后点击应用</p>
            <div className="grid grid-cols-2 gap-1.5">
              {EFFECT_OPTIONS.map((opt) => (
                <button key={opt.type} className="rounded-lg border border-[--border-subtle] bg-[--surface] px-2 py-2 text-[11px] font-medium text-[--text-primary] hover:border-primary/40 hover:bg-primary/3 transition-colors">
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
