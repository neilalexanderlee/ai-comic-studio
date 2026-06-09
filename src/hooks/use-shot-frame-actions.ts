"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import type { FrameReferenceChoice, FrameRefPickerShot } from "@/components/editor/frame-reference-picker";

/** Seedream API 最大参考图数量（与 generate/route.ts 的 MAX_REFERENCE_IMAGES 保持一致） */
const API_MAX_REF_IMAGES = 14;

/**
 * 每个命名角色预估自动注入的参考图数量（每角色 1 张定妆图）
 * 加上可能的场景图 1 张，作为保守预留值。
 */
function estimateAutoRefCount(namedCharacterCount: number): number {
  return namedCharacterCount + 1; // 1 per char (costume ref) + 1 scene
}

export type UseShotFrameActionsOptions = {
  projectId: string;
  shotId: string;
  episodeId?: string;
  videoRatio: string;
  versionId: string | null;
  enhancePrompts?: boolean;
  frameRefShots?: FrameRefPickerShot[];
  prevCutPoint?: string | null;
  prevAnchorLastAi?: string | null;
  /** 本镜命名角色数量，用于动态计算用户可手选的参考图上限 */
  namedCharacterCount?: number;
  onUpdate: () => void;
};

export function useShotFrameActions({
  projectId,
  shotId,
  episodeId,
  videoRatio,
  versionId,
  enhancePrompts = false,
  frameRefShots = [],
  prevCutPoint = null,
  prevAnchorLastAi = null,
  namedCharacterCount = 0,
  onUpdate,
}: UseShotFrameActionsOptions) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const imageGuard = useModelGuard("image");

  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingFrameTarget, setGeneratingFrameTarget] = useState<"first" | "last" | null>(null);
  const [adoptingPrevFrame, setAdoptingPrevFrame] = useState(false);
  const [adoptingPrevEpisode, setAdoptingPrevEpisode] = useState(false);
  const [frameRefPickerOpen, setFrameRefPickerOpen] = useState(false);
  const [pendingFrameTarget, setPendingFrameTarget] = useState<"first" | "last" | "both" | null>(null);

  const prevChainFrame = prevCutPoint ?? prevAnchorLastAi ?? null;
  const prevChainFrameSource: "video" | "ai" | null =
    prevCutPoint ? "video" : prevAnchorLastAi ? "ai" : null;

  async function patchShot(fields: Record<string, unknown>) {
    await apiFetch(`/api/projects/${projectId}/shots/${shotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function executeFrameGenerate(
    frameTarget: "first" | "last" | "both",
    choice?: FrameReferenceChoice
  ) {
    const payload: Record<string, unknown> = {
      shotId,
      ratio: videoRatio,
      versionId,
      frameTarget,
    };
    if (choice?.mode === "pick" && choice.references.length > 0) {
      // 多参考图：发送 frameReferences 数组（第一张为主参考/衔接参考）
      payload.frameReferences = choice.references;
    }
    await apiFetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "single_frame_generate",
        payload,
        modelConfig: getModelConfig(),
        enhancePrompts,
      }),
    });
    onUpdate();
  }

  function openFrameReferencePicker(frameTarget: "first" | "last" | "both") {
    if (!imageGuard()) return;
    setPendingFrameTarget(frameTarget);
    setFrameRefPickerOpen(true);
  }

  async function handleFrameReferenceConfirm(choice: FrameReferenceChoice) {
    const target = pendingFrameTarget;
    if (!target) return;
    setGeneratingFrames(true);
    if (target === "first") setGeneratingFrameTarget("first");
    else if (target === "last") setGeneratingFrameTarget("last");
    try {
      await executeFrameGenerate(target, choice);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingFrames(false);
      setGeneratingFrameTarget(null);
      setPendingFrameTarget(null);
    }
  }

  function handleGenerateFrames() {
    openFrameReferencePicker("first");
  }

  /** 直接从 startFrameDesc + 定妆图生成首帧，不打开参考图选择器（最常见路径）*/
  async function handleGenerateFirstFrameFresh() {
    if (!imageGuard()) return;
    setGeneratingFrames(true);
    setGeneratingFrameTarget("first");
    try {
      await executeFrameGenerate("first"); // no choice = fresh, chainSourceShotId/Type will be cleared
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setGeneratingFrames(false);
      setGeneratingFrameTarget(null);
    }
  }

  async function handleGenerateOneFrame(target: "first" | "last") {
    if (target === "last") {
      openFrameReferencePicker("last");
      return;
    }
    openFrameReferencePicker("first");
  }

  async function handleAdoptPrevEpisodeFrame() {
    if (!episodeId) return;
    setAdoptingPrevEpisode(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/shots/${shotId}/adopt-prev-episode-frame`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "承接失败");
      }
      toast.success("已承接上一集尾帧为本镜首帧");
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "承接上一集尾帧失败");
    } finally {
      setAdoptingPrevEpisode(false);
    }
  }

  async function handleAdoptPrevChainFrame() {
    if (!prevChainFrame) return;
    setAdoptingPrevFrame(true);
    try {
      await patchShot({ anchorFirst: prevChainFrame });
      onUpdate();
      toast.success("已承接上一镜尾帧为本镜首帧");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "承接失败");
    } finally {
      setAdoptingPrevFrame(false);
    }
  }

  const frameActionsBusy =
    generatingFrames || adoptingPrevFrame || adoptingPrevEpisode;

  return {
    generatingFrames,
    generatingFrameTarget,
    adoptingPrevFrame,
    adoptingPrevEpisode,
    frameActionsBusy,
    prevChainFrame,
    prevChainFrameSource,
    frameRefPickerOpen,
    setFrameRefPickerOpen,
    pendingFrameTarget,
    frameRefShots,
    /** 用户最多可手选的跨镜参考图数量（API 上限 14 减去自动注入的角色/场景图预留） */
    crossShotRefLimit: Math.max(1, API_MAX_REF_IMAGES - estimateAutoRefCount(namedCharacterCount)),
    handleGenerateFrames,
    handleGenerateFirstFrameFresh,
    handleGenerateOneFrame,
    handleFrameReferenceConfirm,
    handleAdoptPrevEpisodeFrame,
    handleAdoptPrevChainFrame,
    openFrameReferencePicker,
  };
}
