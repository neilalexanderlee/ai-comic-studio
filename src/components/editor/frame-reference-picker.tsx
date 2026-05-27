"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadUrl } from "@/lib/utils/upload-url";
import type { FrameReferenceType } from "@/lib/storyboard/frame-reference";
import { frameReferenceTypeLabel } from "@/lib/storyboard/frame-reference";
import { ImageIcon } from "lucide-react";

export type FrameRefPickerShot = {
  id: string;
  sequence: number;
  anchorFirst?: string | null;
  anchorLastAi?: string | null;
  cutPoint?: string | null;
};

export type FrameReferenceChoice =
  | { mode: "none" }
  | { mode: "pick"; shotId: string; frameType: FrameReferenceType };

type FrameOption = {
  shotId: string;
  sequence: number;
  frameType: FrameReferenceType;
  src: string;
  label: string;
};

function collectFrameOptions(shots: FrameRefPickerShot[]): FrameOption[] {
  const options: FrameOption[] = [];
  for (const shot of shots) {
    const entries: Array<{ frameType: FrameReferenceType; src?: string | null }> = [
      { frameType: "anchor_first", src: shot.anchorFirst },
      { frameType: "anchor_last_ai", src: shot.anchorLastAi },
      { frameType: "cut_point", src: shot.cutPoint },
    ];
    for (const { frameType, src } of entries) {
      if (!src) continue;
      options.push({
        shotId: shot.id,
        sequence: shot.sequence,
        frameType,
        src,
        label: `分镜 ${shot.sequence} · ${frameReferenceTypeLabel(frameType)}`,
      });
    }
  }
  return options;
}

interface FrameReferencePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shots: FrameRefPickerShot[];
  currentShotId: string;
  title?: string;
  onConfirm: (choice: FrameReferenceChoice) => void;
}

export function FrameReferencePicker({
  open,
  onOpenChange,
  shots,
  currentShotId,
  title = "选择首帧参考图",
  onConfirm,
}: FrameReferencePickerProps) {
  const [selected, setSelected] = useState<FrameReferenceChoice | null>({ mode: "none" });

  const options = useMemo(
    () =>
      collectFrameOptions(shots.filter((s) => s.id !== currentShotId)).sort(
        (a, b) => a.sequence - b.sequence || a.frameType.localeCompare(b.frameType)
      ),
    [shots, currentShotId]
  );

  function handleConfirm() {
    if (!selected) return;
    onConfirm(selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-[--text-secondary]">
            将所选画面作为构图/连续性参考发给 AI 生成首帧（不是直接复制文件）。可选任意更早分镜的首帧、AI 尾帧或视频真实尾帧。
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <button
            type="button"
            onClick={() => setSelected({ mode: "none" })}
            className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
              selected?.mode === "none"
                ? "border-primary bg-primary/5 text-primary"
                : "border-[--border-subtle] hover:border-primary/30"
            }`}
          >
            <span className="font-medium">独立生成（不参考其他分镜）</span>
            <p className="mt-1 text-xs text-[--text-muted]">
              仅使用本镜描述与角色定妆图生成首帧，不读取上一镜尾帧。
            </p>
          </button>

          {options.length === 0 ? (
            <p className="text-sm text-[--text-muted] py-4 text-center">
              当前版本中没有其他分镜的可选参考图
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {options.map((opt) => {
                const isSelected =
                  selected?.mode === "pick" &&
                  selected.shotId === opt.shotId &&
                  selected.frameType === opt.frameType;
                return (
                  <button
                    key={`${opt.shotId}-${opt.frameType}`}
                    type="button"
                    onClick={() =>
                      setSelected({
                        mode: "pick",
                        shotId: opt.shotId,
                        frameType: opt.frameType,
                      })
                    }
                    className={`rounded-xl border overflow-hidden text-left transition-colors ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-[--border-subtle] hover:border-primary/30"
                    }`}
                  >
                    <div className="aspect-video bg-[--surface] relative">
                      <img
                        src={uploadUrl(opt.src)}
                        alt={opt.label}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <p className="px-2 py-1.5 text-[11px] text-[--text-secondary] truncate">
                      {opt.label}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!selected}>
            确认并生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 缩略图占位 */
export function FrameRefThumb({ src, className }: { src?: string | null; className?: string }) {
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-[--surface] ${className ?? ""}`}>
        <ImageIcon className="h-3.5 w-3.5 text-[--text-muted]" />
      </div>
    );
  }
  return <img src={uploadUrl(src)} alt="" className={`object-cover ${className ?? ""}`} />;
}
