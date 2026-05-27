"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import type { FrameReferenceChoice, FrameRefPickerShot } from "@/components/editor/frame-reference-picker";

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
  const [pendingFrameTarget, setPendingFrameTarget] = useState<"first" | "both" | null>(null);

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
    if (choice?.mode === "pick") {
      payload.frameReference = {
        shotId: choice.shotId,
        frameType: choice.frameType,
      };
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

  function openFrameReferencePicker(frameTarget: "first" | "both") {
    if (!imageGuard()) return;
    setPendingFrameTarget(frameTarget);
    setFrameRefPickerOpen(true);
  }

  async function handleFrameReferenceConfirm(choice: FrameReferenceChoice) {
    const target = pendingFrameTarget;
    if (!target) return;
    setGeneratingFrames(true);
    if (target === "first") setGeneratingFrameTarget("first");
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
    openFrameReferencePicker("both");
  }

  async function handleGenerateOneFrame(target: "first" | "last") {
    if (target === "last") {
      if (!imageGuard()) return;
      setGeneratingFrames(true);
      setGeneratingFrameTarget("last");
      try {
        await executeFrameGenerate("last");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
      } finally {
        setGeneratingFrames(false);
        setGeneratingFrameTarget(null);
      }
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
    frameRefShots,
    handleGenerateFrames,
    handleGenerateOneFrame,
    handleFrameReferenceConfirm,
    handleAdoptPrevEpisodeFrame,
    handleAdoptPrevChainFrame,
    openFrameReferencePicker,
  };
}
