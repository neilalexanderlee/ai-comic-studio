"use client";

import { RectangleHorizontal, Square, RectangleVertical, Maximize } from "lucide-react";

// 全部可能的比例。实际展示哪几个由 allowedRatios（来自能力表）决定：
// Seedance 2.5 支持 21:9 / 4:3 / 3:4，2.0 系列和其他家不支持。
const RATIOS = [
  { value: "21:9", label: "21:9", icon: RectangleHorizontal },
  { value: "16:9", label: "16:9", icon: RectangleHorizontal },
  { value: "4:3", label: "4:3", icon: RectangleHorizontal },
  { value: "1:1", label: "1:1", icon: Square },
  { value: "3:4", label: "3:4", icon: RectangleVertical },
  { value: "9:16", label: "9:16", icon: RectangleVertical },
  { value: "adaptive", label: "Auto", icon: Maximize },
] as const;

interface VideoRatioPickerProps {
  value: string;
  onChange: (ratio: string) => void;
  /**
   * 当前视频模型支持的比例（`VIDEO_CAPABILITIES[].ratios`）。
   * 省略时展示全部——用于尚未接入能力表的调用点。
   */
  allowedRatios?: string[];
}

export function VideoRatioPicker({ value, onChange, allowedRatios }: VideoRatioPickerProps) {
  const visible =
    allowedRatios && allowedRatios.length > 0
      ? RATIOS.filter((r) => allowedRatios.includes(r.value))
      : RATIOS;

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-[--border-subtle] bg-white p-0.5">
      {visible.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            value === v
              ? "bg-primary/10 text-primary"
              : "text-[--text-muted] hover:text-[--text-primary]"
          }`}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      ))}
    </div>
  );
}
