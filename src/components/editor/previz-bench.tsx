"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { resolveVideoCapability } from "@/lib/ai/video-capabilities";
import { toast } from "sonner";
import { Loader2, Clapperboard, Check, Trash2, Play, Box } from "lucide-react";
import dynamic from "next/dynamic";

// three.js 约 600KB，只有真的打开导演台才值得加载
const PrevizStage = dynamic(
  () => import("./previz-stage/PrevizStage").then((m) => m.PrevizStage),
  { ssr: false }
);

interface PrevizTake {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  duration: number | null;
  resolution: string | null;
  createdAt: number;
}

interface PrevizBenchProps {
  projectId: string;
  episodeId?: string;
  shotId: string;
  videoRatio: string;
  versionId?: string;
  /** 页面级"有别的生成在跑"标记 */
  anyGenerating?: boolean;
  /** 本镜出场的具名角色，3D 导演台首次打开时据此自动建演员 */
  shotCharacters?: { id: string; name: string }[];
  /** 已存在的构图参考图（3D 导演台导出的相机视图） */
  layoutUrl?: string | null;
  /** 镜头时长（秒），决定运镜时间线的长度 */
  shotDuration?: number;
  /** 本镜首帧 —— 3D 导演台的背景板默认贴它 */
  anchorFirst?: string | null;
  /** 本集其他分镜的首帧，供换背景 */
  backdropCandidates?: { id: string; sequence: number; url: string }[];
  /** 本镜现有帧描述与运镜说明 —— 导演台把机位与景别回写进它们 */
  startFrameDesc?: string | null;
  cameraDirection?: string | null;
  onPreview: (src: string) => void;
  onUpdate: () => void;
}

/**
 * 预演台 —— 正式出片前先用白模验证运镜。
 *
 * 一条正式视频要跑 5~10 分钟并按秒计费，运镜不对就整条作废。这里先出一段 480p 的
 * 灰白模（无材质、无颜色、不生成音频、走 flex 档），只看机位/运镜路径/景别变化/走位；
 * 选用之后，正式生成会把这条预演作为参考视频一起传给模型（Seedance 2.5 特性），
 * 让贵的那一次照着已确认的运镜出片。
 */
export function PrevizBench({
  projectId,
  episodeId,
  shotId,
  videoRatio,
  versionId,
  anyGenerating,
  shotCharacters = [],
  layoutUrl,
  shotDuration = 5,
  anchorFirst,
  backdropCandidates,
  startFrameDesc,
  cameraDirection,
  onPreview,
  onUpdate,
}: PrevizBenchProps) {
  const [stageOpen, setStageOpen] = useState(false);
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const videoGuard = useModelGuard("video");

  const [takes, setTakes] = useState<PrevizTake[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 当前视频模型支持不支持参考视频 —— 不支持时预演做出来也送不进正式生成，
  // 与其让用户白花一次钱，不如把入口直接说清楚
  const capability = resolveVideoCapability(getModelConfig().video?.modelId, getModelConfig().video?.protocol);
  const supportsPreviz = capability.modes.includes("multimodal");
  const supportsReferenceVideo =
    capability.refs.video > 0 && capability.refTransport.video.includes("url");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots/${shotId}/previz`);
      if (!res.ok) return;
      const data = (await res.json()) as { takes: PrevizTake[]; selectedId: string | null };
      setTakes(data.takes ?? []);
      setSelectedId(data.selectedId ?? null);
    } finally {
      setLoaded(true);
    }
  }, [projectId, shotId]);

  useEffect(() => {
    setLoaded(false);
    setTakes([]);
    setSelectedId(null);
    load();
  }, [load]);

  async function handleGenerate() {
    if (!videoGuard()) return;
    setGenerating(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "previz_generate",
          payload: { shotId, ratio: videoRatio, versionId },
          modelConfig: getModelConfig(),
        }),
      });
      const data = (await res.json()) as { error?: string; notes?: string[] };
      if (!res.ok) throw new Error(data.error || "预演生成失败");
      data.notes?.forEach((n) => toast.warning(n));
      await load();
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "预演生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelect(previzId: string | null) {
    const prev = selectedId;
    setSelectedId(previzId); // 乐观更新
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots/${shotId}/previz`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previzId }),
      });
      if (!res.ok) throw new Error("选用失败");
      onUpdate();
    } catch {
      setSelectedId(prev);
      toast.error("选用失败");
    }
  }

  async function handleDelete(previzId: string) {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/shots/${shotId}/previz/${previzId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("删除失败");
      await load();
      onUpdate();
    } catch {
      toast.error("删除失败");
    }
  }

  if (!loaded && takes.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
          预演台 · 白模验运镜
        </p>
        {selectedId && supportsReferenceVideo && (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            运镜已确认
          </span>
        )}
      </div>

      {takes.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {takes.map((take, i) => {
            const isSelected = take.id === selectedId;
            return (
              <div
                key={take.id}
                className={`group relative h-16 w-24 overflow-hidden rounded-lg border-2 bg-black ${
                  isSelected ? "border-emerald-500" : "border-[--border-subtle]"
                }`}
              >
                <button
                  type="button"
                  className="h-full w-full"
                  onClick={() => onPreview(uploadUrl(take.videoUrl))}
                  title={`第 ${takes.length - i} 条预演 · ${take.duration ?? "?"}s`}
                >
                  {take.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={uploadUrl(take.posterUrl)}
                      alt="预演"
                      className="h-full w-full object-cover opacity-90"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-white/60">
                      <Play className="h-3 w-3" />
                    </div>
                  )}
                </button>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => handleSelect(isSelected ? null : take.id)}
                    className={`text-[9px] font-medium ${
                      isSelected ? "text-emerald-300" : "text-white/70 hover:text-white"
                    }`}
                  >
                    {isSelected ? (
                      <span className="flex items-center gap-0.5">
                        <Check className="h-2.5 w-2.5" />
                        已选用
                      </span>
                    ) : (
                      "选用"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(take.id)}
                    className="text-white/50 hover:text-red-300"
                    title="删除这条预演"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {episodeId && (
          <Button size="xs" variant="outline" onClick={() => setStageOpen(true)}>
            <Box className="h-3 w-3" />
            3D 导演台
          </Button>
        )}
        {layoutUrl && (
          <button
            type="button"
            onClick={() => onPreview(uploadUrl(layoutUrl))}
            className="h-10 overflow-hidden rounded border border-[--border-subtle]"
            title="3D 导演台导出的构图参考图"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={uploadUrl(layoutUrl)} alt="构图参考" className="h-full w-auto object-cover" />
          </button>
        )}
        <span className="text-[10px] text-[--text-muted]">
          先摆机位与走位（免费、即时），再决定要不要花钱验
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={handleGenerate}
          disabled={generating || anyGenerating || !supportsPreviz}
          title={supportsPreviz ? undefined : `${capability.label} 不支持参考生视频，无法做白模预演`}
        >
          {generating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Clapperboard className="h-3 w-3" />
          )}
          {generating ? "预演中…" : takes.length > 0 ? "再演一条" : "白模预演"}
        </Button>
        <span className="text-[10px] text-[--text-muted]">
          480p · 无声 · 只验机位与运镜
        </span>
      </div>

      {selectedId && !supportsReferenceVideo && (
        <p className="mt-1.5 text-[10px] text-amber-600">
          当前模型不支持参考视频，已选用的运镜不会参与正式生成（需 Seedance 2.5 或 2.0 mini）。
        </p>
      )}

      {stageOpen && episodeId && (
        <PrevizStage
          projectId={projectId}
          episodeId={episodeId}
          shotId={shotId}
          shotCharacters={shotCharacters}
          videoRatio={videoRatio}
          duration={shotDuration}
          anchorFirst={anchorFirst}
          backdropCandidates={backdropCandidates}
          startFrameDesc={startFrameDesc}
          cameraDirection={cameraDirection}
          onClose={() => setStageOpen(false)}
          onUpdate={onUpdate}
        />
      )}
    </section>
  );
}
