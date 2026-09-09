import type { EffectName } from "@/lib/video/composition";
export type EffectType = EffectName;
export const EFFECT_OPTIONS: { type: EffectType; label: string }[] = [
  { type: "fadeIn", label: "淡入" },
  { type: "fadeOut", label: "淡出" },
  { type: "zoomIn", label: "放大进入" },
  { type: "zoomOut", label: "缩小进入" },
  { type: "flash", label: "闪烁" },
  { type: "shake", label: "抖动" },
  { type: "pulse", label: "脉冲" },
  { type: "rotateIn", label: "旋转进入" },
];
