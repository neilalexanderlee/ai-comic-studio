"use client";

import { use, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { apiFetch } from "@/lib/api-fetch";
import { MediaLibrary } from "@/components/editor/video-editor/MediaLibrary";
import { VideoPreview } from "@/components/editor/video-editor/VideoPreview";
import { Timeline } from "@/components/editor/video-editor/Timeline";
import { PropertyPanel } from "@/components/editor/video-editor/PropertyPanel";
import { useEditorStore } from "@/components/editor/video-editor/hooks/useEditorStore";
import type { Track } from "@/components/editor/video-editor/utils/clipMeta";
import { ArrowLeft, Loader2, Download, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { uploadUrl } from "@/lib/utils/upload-url";

/** 用 <video> 元素探测视频文件的真实时长（秒） */
function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { resolve(v.duration); v.src = ""; };
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

/**
 * 探测所有 video clip 的真实时长，做 ripple edit：
 * - 每个 video clip duration 修正为真实值
 * - 后续所有 clip（BGM/字幕）按累积偏移量平移，相对关系不变
 */
async function fixVideoClipDurations(
  tracks: Track[],
  updateClip: (id: string, patch: Partial<import("@/components/editor/video-editor/utils/clipMeta").Clip>) => void,
) {
  const videoTrack = tracks.find((t) => t.type === "video");
  if (!videoTrack) return;

  const vClips = [...videoTrack.clips]
    .filter((c) => c.type === "video" && c.url)
    .sort((a, b) => a.startTime - b.startTime);
  if (vClips.length === 0) return;

  // 并发探测
  const actualDurations = await Promise.all(
    vClips.map((c) => probeVideoDuration(uploadUrl(c.url!))),
  );

  // 检查是否有任何偏差 > 0.05s（降低阈值，避免 0.1s 边界情况被跳过）
  const hasAnyDiff = actualDurations.some(
    (d, i) => d > 0 && Math.abs(d - vClips[i].duration) > 0.05,
  );
  if (!hasAnyDiff) return;

  // 逐 clip 计算累积偏移并 ripple 更新
  let accumulated = 0; // 到当前 clip 为止，已累积的时长偏差（秒）

  for (let i = 0; i < vClips.length; i++) {
    const clip = vClips[i];
    const actual = actualDurations[i] > 0 ? actualDurations[i] : clip.duration;
    const delta = actual - clip.duration; // 正数：实际更长

    const newStart = clip.startTime + accumulated;
    const newDur = actual;
    const newEnd = newStart + newDur;

    if (Math.abs(delta) > 0.05 || Math.abs(accumulated) > 0.01) {
      updateClip(clip.id, { startTime: newStart, endTime: newEnd, duration: newDur });
    }

    accumulated += delta;
  }

  if (Math.abs(accumulated) < 0.01) return; // 总偏差可忽略，不动其他轨道

  // 对 BGM / 字幕等非视频轨道的 clip：
  // 找到每个 clip 在视频轨上的"插入点"，按该点之前累积的偏移量平移
  for (const track of tracks) {
    if (track.type === "video") continue;
    for (const clip of track.clips) {
      // 累计到该 clip.startTime 之前的视频偏移
      let deltaAtClip = 0;
      for (let i = 0; i < vClips.length; i++) {
        if (vClips[i].startTime > clip.startTime) break;
        const actual = actualDurations[i] > 0 ? actualDurations[i] : vClips[i].duration;
        deltaAtClip += actual - vClips[i].duration;
      }
      if (Math.abs(deltaAtClip) > 0.01) {
        updateClip(clip.id, {
          startTime: clip.startTime + deltaAtClip,
          endTime: clip.endTime + deltaAtClip,
        });
      }
    }
  }
}

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  videoUrl: string | null;
  duration: number;
  anchorFirst?: string | null;
  bgmNote?: string | null;
  dialogues?: Array<{ characterName: string; text: string; type?: string }>;
}

interface ProjectData {
  id: string;
  title: string;
  finalVideoUrl?: string | null;
  shots: Shot[];
}

export default function EditorPage({
  params,
}: {
  params: Promise<{ id: string; episodeId: string }>;
}) {
  const { id: projectId, episodeId } = use(params);
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ProjectData | null>(null);
  const initFromShots = useEditorStore((s) => s.initFromShots);
  const loadFromSnapshot = useEditorStore((s) => s.loadFromSnapshot);
  const updateClip = useEditorStore((s) => s.updateClip);
  const tracks = useEditorStore((s) => s.tracks);
  const reset = useEditorStore((s) => s.reset);
  const globalSubtitleStyle = useEditorStore((s) => s.globalSubtitleStyle);
  const setGlobalSubtitleStyle = useEditorStore((s) => s.setGlobalSubtitleStyle);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);  // 防止初始化时触发自动保存

  // 挂载：先尝试从 DB 恢复快照，无快照则按分镜初始化
  useEffect(() => {
    async function load() {
      try {
        reset();
        initializedRef.current = false;

        // 并发拉取：项目数据 + 编辑器快照
        const [projectData, snapshotData] = await Promise.all([
          apiFetch(`/api/projects/${projectId}/episodes/${episodeId}`).then((r) => r.json()) as Promise<ProjectData>,
          apiFetch(`/api/projects/${projectId}/episodes/${episodeId}/editor-state`).then((r) => r.json()) as Promise<{ editorState: string | null }>,
        ]);

        setProject(projectData);

        if (snapshotData.editorState) {
          const parsed = JSON.parse(snapshotData.editorState) as
            | Track[]                                                       // 旧格式（兼容）
            | { tracks: Track[]; globalSubtitleStyle?: unknown };           // 新格式
          const savedTracks = Array.isArray(parsed) ? parsed : parsed.tracks;
          loadFromSnapshot(savedTracks);
          // 恢复全局字幕样式（新格式才有）
          if (!Array.isArray(parsed) && parsed.globalSubtitleStyle) {
            setGlobalSubtitleStyle(parsed.globalSubtitleStyle as Parameters<typeof setGlobalSubtitleStyle>[0]);
          }
        } else {
          // 首次进入：按分镜初始化，然后探测真实视频时长并 ripple 修正
          initFromShots(
            (projectData.shots ?? []).map((s) => ({
              id: s.id,
              sequence: s.sequence,
              prompt: s.prompt,
              videoUrl: s.videoUrl,
              duration: s.duration,
              bgmNote: s.bgmNote,
              dialogues: s.dialogues,
            }))
          );
          await fixVideoClipDurations(useEditorStore.getState().tracks, updateClip);
        }

        // 标记初始化完成，之后的 tracks 变化才触发自动保存
        setTimeout(() => { initializedRef.current = true; }, 100);
      } catch (err) {
        console.error("Editor load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => {
      reset();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [projectId, episodeId]);

  // tracks 或 globalSubtitleStyle 变化时 debounce 1.5s 自动保存到 DB
  useEffect(() => {
    if (!initializedRef.current || tracks.length === 0) return;
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch(`/api/projects/${projectId}/episodes/${episodeId}/editor-state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tracks, globalSubtitleStyle }),
        });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 1500);
  }, [tracks, globalSubtitleStyle]);


  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
      </div>
    );
  }

  const shots = project?.shots ?? [];
  const shotsWithVideo = shots.filter((s) => !!s.videoUrl);

  const finalVideoUrl = project?.finalVideoUrl;

  return (
    <div className="flex h-screen flex-col bg-white text-[--text-primary] overflow-hidden">
      {/* ── 顶部导航 ── */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[--border-subtle] bg-white px-4">
        <Link
          href={`/${locale}/project/${projectId}/episodes/${episodeId}/storyboard`}
          className="flex items-center gap-1 text-[--text-muted] hover:text-[--text-primary] text-[12px] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回分镜
        </Link>
        <div className="h-4 w-px bg-[--border-subtle]" />
        <span className="text-[13px] font-semibold text-[--text-primary]">{project?.title} · 剪辑导出</span>
        {saveStatus === "saving" && (
          <span className="flex items-center gap-1 text-[10px] text-[--text-muted]">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />保存中…
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-600">
            <CheckCircle2 className="h-2.5 w-2.5" />已保存
          </span>
        )}
        {shotsWithVideo.length < shots.length && (
          <span className="ml-2 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 border border-amber-200">
            {shots.length - shotsWithVideo.length} 个分镜尚未生成视频
          </span>
        )}
        {finalVideoUrl && (
          <a
            href={uploadUrl(finalVideoUrl)}
            download
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[--border-subtle] bg-[--surface] px-2.5 py-1 text-[11px] text-[--text-secondary] hover:border-primary/40 hover:text-primary transition-colors"
          >
            <Download className="h-3 w-3" />
            上次导出
          </a>
        )}
      </header>

      {/* ── 主区域：三栏布局 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：媒体库 200px */}
        <div className="w-52 shrink-0 overflow-hidden">
          <MediaLibrary shots={shots} />
        </div>

        {/* 中：预览 + 时间线（垂直分割） */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* 预览区 60% */}
          <div className="flex-[0_0_60%] overflow-hidden">
            <VideoPreview projectId={projectId} episodeId={episodeId} />
          </div>
          {/* 时间线区 40% */}
          <div className="flex-[0_0_40%] overflow-hidden">
            <Timeline />
          </div>
        </div>

        {/* 右：属性面板 180px */}
        <div className="w-44 shrink-0 overflow-hidden">
          <PropertyPanel />
        </div>
      </div>
    </div>
  );
}
