"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { ImageIcon, Loader2 } from "lucide-react";

type ShotFrameToolbarProps = {
  hasFrame: boolean;
  frameRefShotsCount: number;
  showAdoptPrevEpisode: boolean;
  prevChainFrame: string | null;
  prevChainFrameSource: "video" | "ai" | null;
  generatingFrames: boolean;
  adoptingPrevEpisode: boolean;
  adoptingPrevFrame: boolean;
  disabled?: boolean;
  onGenerateFrames: () => void;
  onPickReference: () => void;
  onAdoptPrevEpisode: () => void;
  onAdoptPrevChain: () => void;
  /** 外链出图等附加按钮（插在主操作条末尾） */
  trailing?: ReactNode;
};

/** 画面步骤主操作条（列表卡 / 抽屉共用） */
export function ShotFrameToolbar({
  hasFrame,
  frameRefShotsCount,
  showAdoptPrevEpisode,
  prevChainFrame,
  prevChainFrameSource,
  generatingFrames,
  adoptingPrevEpisode,
  adoptingPrevFrame,
  disabled = false,
  onGenerateFrames,
  onPickReference,
  onAdoptPrevEpisode,
  onAdoptPrevChain,
  trailing,
}: ShotFrameToolbarProps) {
  const t = useTranslations();
  const blocked = disabled || generatingFrames || adoptingPrevEpisode || adoptingPrevFrame;

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        size="xs"
        variant={!hasFrame ? "default" : "outline"}
        onClick={onGenerateFrames}
        disabled={blocked}
      >
        {generatingFrames ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
        {generatingFrames
          ? t("common.generating")
          : hasFrame
            ? t("shot.regenerateFrames")
            : t("project.generateFrames")}
      </Button>
      {frameRefShotsCount > 0 && (
        <Button size="xs" variant="ghost" onClick={onPickReference} disabled={blocked}>
          <ImageIcon className="h-3 w-3" />
          {t("shot.pickFrameReference")}
        </Button>
      )}
      {showAdoptPrevEpisode && (
        <Button
          size="xs"
          variant="ghost"
          onClick={onAdoptPrevEpisode}
          disabled={blocked}
          title="将上一集最后一镜的视频尾帧直拷为本镜首帧"
        >
          {adoptingPrevEpisode ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[10px]">↑↑</span>}
          承接上一集尾帧
        </Button>
      )}
      {prevChainFrame && (
        <Button
          size="xs"
          variant="ghost"
          onClick={onAdoptPrevChain}
          disabled={blocked}
          title={
            prevChainFrameSource === "video"
              ? "将上一镜视频尾帧直拷为本镜首帧"
              : "将上一镜 AI 尾帧直拷为本镜首帧"
          }
        >
          {adoptingPrevFrame ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[10px]">↑</span>}
          承接上一镜尾帧
          {prevChainFrameSource === "video" ? "（视频尾帧）" : "（AI 尾帧）"}
        </Button>
      )}
      {trailing}
    </div>
  );
}
