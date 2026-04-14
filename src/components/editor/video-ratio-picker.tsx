"use client";

import { RectangleHorizontal, Square, RectangleVertical, Maximize } from "lucide-react";

const RATIOS = [
  { value: "16:9", label: "16:9", icon: RectangleHorizontal },
  { value: "9:16", label: "9:16", icon: RectangleVertical },
  { value: "1:1", label: "1:1", icon: Square },
  { value: "adaptive", label: "Auto", icon: Maximize },
] as const;

interface VideoRatioPickerProps {
  value: string;
  onChange: (ratio: string) => void;
}

export function VideoRatioPicker({ value, onChange }: VideoRatioPickerProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-[--border-subtle] bg-white p-0.5">
      {RATIOS.map(({ value: v, label, icon: Icon }) => (
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
