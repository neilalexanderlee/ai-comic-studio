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
  | { mode: "pick"; references: Array<{ shotId: string; frameType: FrameReferenceType }> };

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

/** Seedream API 总参考图上限，用于 tooltip 提示 */
const API_MAX_REF_IMAGES = 14;

interface FrameReferencePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shots: FrameRefPickerShot[];
  currentShotId: string;
  title?: string;
  frameTarget?: "first" | "last";
  onConfirm: (choice: FrameReferenceChoice) => void;
  /**
   * 用户最多可手选的参考图数量。
   * 由父组件根据本镜命名角色数动态计算（Seedream API 上限 14 减去自动注入的角色定妆图数）。
   * 默认 14（0 个角色时全额可选）。
   */
  maxSelectable?: number;
}

export function FrameReferencePicker({
  open,
  onOpenChange,
  shots,
  currentShotId,
  title,
  frameTarget = "first",
  onConfirm,
  maxSelectable = 10,
}: FrameReferencePickerProps) {
  const defaultTitle = frameTarget === "last" ? "选择尾帧参考图" : "选择首帧参考图";
  const resolvedTitle = title ?? defaultTitle;

  // 多选状态：key = `${shotId}::${frameType}`
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const options = useMemo(
    () =>
      collectFrameOptions(shots.filter((s) => s.id !== currentShotId)).sort(
        (a, b) => a.sequence - b.sequence || a.frameType.localeCompare(b.frameType)
      ),
    [shots, currentShotId]
  );

  function makeKey(shotId: string, frameType: FrameReferenceType) {
    return `${shotId}::${frameType}`;
  }

  function toggleOption(opt: FrameOption) {
    const key = makeKey(opt.shotId, opt.frameType);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < maxSelectable) {
        next.add(key);
      }
      return next;
    });
  }

  function handleSelectNone() {
    setSelectedKeys(new Set());
  }

  function handleConfirm() {
    if (selectedKeys.size === 0) {
      onConfirm({ mode: "none" });
    } else {
      const references = options
        .filter((opt) => selectedKeys.has(makeKey(opt.shotId, opt.frameType)))
        .map((opt) => ({ shotId: opt.shotId, frameType: opt.frameType }));
      onConfirm({ mode: "pick", references });
    }
    onOpenChange(false);
  }

  // 重置选择状态当弹窗关闭
  function handleOpenChange(open: boolean) {
    if (!open) setSelectedKeys(new Set());
    onOpenChange(open);
  }

  const isNoneMode = selectedKeys.size === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <p className="text-sm text-[--text-secondary]">
            {frameTarget === "last"
              ? `勾选一张或多张参考图（最多 ${maxSelectable} 张，角色定妆图自动注入不占此数）发给 AI 生成尾帧，第一张优先用于镜间衔接。`
              : `勾选一张或多张参考图（最多 ${maxSelectable} 张，角色定妆图自动注入不占此数）发给 AI 生成首帧，第一张优先用于镜间衔接。`}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* 独立生成选项 */}
          <button
            type="button"
            onClick={handleSelectNone}
            className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
              isNoneMode
                ? "border-primary bg-primary/5 text-primary"
                : "border-[--border-subtle] hover:border-primary/30"
            }`}
          >
            <span className="font-medium">独立生成（不参考其他分镜）</span>
            <p className="mt-1 text-xs text-[--text-muted]">
              {frameTarget === "last"
                ? "仅使用本镜描述与角色定妆图生成尾帧，不读取其他分镜画面。"
                : "仅使用本镜描述与角色定妆图生成首帧，不读取其他分镜画面。"}
            </p>
          </button>

          {options.length === 0 ? (
            <p className="text-sm text-[--text-muted] py-4 text-center">
              当前版本中没有其他分镜的可选参考图
            </p>
          ) : (
            <>
              {/* 已选计数 */}
              {selectedKeys.size > 0 && (
                <p className="text-xs text-primary font-medium">
                  已选 {selectedKeys.size} 张参考图（上限 {maxSelectable} 张，API 总上限 {API_MAX_REF_IMAGES} 张含角色定妆图）
                  {selectedKeys.size >= maxSelectable && (
                    <span className="ml-1 text-amber-500">· 已达上限</span>
                  )}
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Set 维护插入顺序，第一个元素即用户最先点击的那张 */}
                {(() => {
                  const firstSelectedKey = selectedKeys.size > 0 ? [...selectedKeys][0] : undefined;
                  return options.map((opt) => {
                  const key = makeKey(opt.shotId, opt.frameType);
                  const isChecked = selectedKeys.has(key);
                  const isDisabled = !isChecked && selectedKeys.size >= maxSelectable;
                  // 主参考 = 用户最先点击的那张（Set 插入顺序）
                  const isPrimary = isChecked && key === firstSelectedKey;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => !isDisabled && toggleOption(opt)}
                      disabled={isDisabled}
                      className={`rounded-xl border overflow-hidden text-left transition-colors relative ${
                        isChecked
                          ? "border-primary ring-2 ring-primary/30"
                          : isDisabled
                            ? "border-[--border-subtle] opacity-40 cursor-not-allowed"
                            : "border-[--border-subtle] hover:border-primary/30"
                      }`}
                    >
                      <div className="aspect-video bg-[--surface] relative">
                        <img
                          src={uploadUrl(opt.src, { w: 320 })}
                          alt={opt.label}
                          className="h-full w-full object-cover"
                        />
                        {/* 勾选角标 */}
                        {isChecked && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow">
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        {/* 主参考角标 */}
                        {isPrimary && (
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-primary/90 text-white text-[10px] font-medium leading-none">
                            主参考
                          </div>
                        )}
                      </div>
                      <p className="px-2 py-1.5 text-[11px] text-[--text-secondary] truncate">
                        {opt.label}
                      </p>
                    </button>
                  );
                });
                })()}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm}>
            {selectedKeys.size > 0
              ? `确认并生成（${selectedKeys.size} 张参考图）`
              : "确认并生成"}
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
  return <img src={uploadUrl(src, { w: 320 })} alt="" className={`object-cover ${className ?? ""}`} />;
}
