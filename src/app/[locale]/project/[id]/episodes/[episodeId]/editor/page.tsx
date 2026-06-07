"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { apiFetch } from "@/lib/api-fetch";
import { MediaLibrary } from "@/components/editor/video-editor/MediaLibrary";
import { VideoPreview } from "@/components/editor/video-editor/VideoPreview";
import { Timeline } from "@/components/editor/video-editor/Timeline";
import { PropertyPanel } from "@/components/editor/video-editor/PropertyPanel";
import { useEditorStore } from "@/components/editor/video-editor/hooks/useEditorStore";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  videoUrl: string | null;
  duration: number;
  anchorFirst?: string | null;
  dialogues?: Array<{ characterName: string; text: string; type?: string }>;
}

interface ProjectData {
  id: string;
  title: string;
  shots: Shot[];
}

export default function EditorPage({
  params,
}: {
  params: Promise<{ id: string; episodeId: string }>;
}) {
  const { id: projectId, episodeId } = use(params);
  const locale = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ProjectData | null>(null);
  const initFromShots = useEditorStore((s) => s.initFromShots);
  const reset = useEditorStore((s) => s.reset);

  useEffect(() => {
    async function load() {
      try {
        const data = (await apiFetch(
          `/api/projects/${projectId}?episodeId=${episodeId}`
        ).then((r) => r.json())) as ProjectData;
        setProject(data);
        // 重置编辑器并用项目分镜初始化
        reset();
        initFromShots(
          (data.shots ?? []).map((s) => ({
            id: s.id,
            sequence: s.sequence,
            prompt: s.prompt,
            videoUrl: s.videoUrl,
            duration: s.duration,
            dialogues: s.dialogues,
          }))
        );
      } catch (err) {
        console.error("Editor load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => reset(); // 离开页面时清空 store
  }, [projectId, episodeId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111]">
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      </div>
    );
  }

  const shots = project?.shots ?? [];
  const shotsWithVideo = shots.filter((s) => !!s.videoUrl);

  return (
    <div className="flex h-screen flex-col bg-[#0d0d0d] text-white overflow-hidden">
      {/* ── 顶部导航 ── */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-white/10 bg-[#1a1a1a] px-4">
        <Link
          href={`/${locale}/project/${projectId}/episodes/${episodeId}/storyboard`}
          className="flex items-center gap-1 text-white/60 hover:text-white text-[12px] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回分镜
        </Link>
        <div className="h-4 w-px bg-white/20" />
        <span className="text-[13px] font-semibold text-white/90">{project?.title} · 视频编辑器</span>
        {shotsWithVideo.length < shots.length && (
          <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">
            {shots.length - shotsWithVideo.length} 个分镜尚未生成视频
          </span>
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
            <VideoPreview />
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
