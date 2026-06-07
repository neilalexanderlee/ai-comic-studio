/**
 * 滤镜与特效工具（基于 Toonflow-web filterEffect.ts，使用本地类型）
 */

export type FilterType =
  | "blur" | "brightness" | "contrast" | "saturate"
  | "grayscale" | "sepia" | "invert" | "hue-rotate" | "opacity";

export type EffectType =
  | "fadeIn" | "fadeOut" | "flash" | "shake"
  | "zoomIn" | "zoomOut" | "pulse" | "rotateIn";

export interface FilterDef {
  type: FilterType;
  label: string;
  defaultValue: number;
  unit: string;
  min: number;
  max: number;
}

export const FILTER_OPTIONS: FilterDef[] = [
  { type: "brightness", label: "亮度", defaultValue: 1.2, unit: "", min: 0, max: 3 },
  { type: "contrast", label: "对比度", defaultValue: 1.2, unit: "", min: 0, max: 3 },
  { type: "saturate", label: "饱和度", defaultValue: 1.3, unit: "", min: 0, max: 3 },
  { type: "blur", label: "模糊", defaultValue: 2, unit: "px", min: 0, max: 20 },
  { type: "grayscale", label: "灰度", defaultValue: 1, unit: "", min: 0, max: 1 },
  { type: "sepia", label: "复古", defaultValue: 0.8, unit: "", min: 0, max: 1 },
  { type: "hue-rotate", label: "色相旋转", defaultValue: 90, unit: "deg", min: 0, max: 360 },
  { type: "opacity", label: "不透明度", defaultValue: 0.8, unit: "", min: 0, max: 1 },
];

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

/**
 * 将当前活跃滤镜转换为 CSS filter 字符串（供 canvas 2D context 使用）
 */
export function buildCSSFilter(filters: Array<{ type: FilterType; value: number }>): string {
  return filters
    .map(({ type, value }) => {
      const def = FILTER_OPTIONS.find((f) => f.type === type);
      const unit = def?.unit || "";
      return `${type}(${value}${unit})`;
    })
    .join(" ");
}

/**
 * 计算特效在给定进度下的变换（供 canvas 应用）
 */
export function getEffectTransform(
  effectType: EffectType,
  progress: number // 0-1 (clip 内部进度)
): { opacity?: number; scale?: number; rotation?: number; offsetX?: number; offsetY?: number } {
  switch (effectType) {
    case "fadeIn": return { opacity: progress };
    case "fadeOut": return { opacity: 1 - progress };
    case "zoomIn": return { scale: 0.5 + 0.5 * progress };
    case "zoomOut": return { scale: 1.5 - 0.5 * progress };
    case "flash": return { opacity: Math.abs(Math.sin(progress * Math.PI * 4)) };
    case "shake": {
      const shake = Math.sin(progress * Math.PI * 8) * 10 * (1 - progress);
      return { offsetX: shake };
    }
    case "pulse": return { scale: 1 + 0.05 * Math.sin(progress * Math.PI * 6) };
    case "rotateIn": return { rotation: (1 - progress) * 360, opacity: progress };
    default: return {};
  }
}
