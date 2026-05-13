export const MODEL_MAX_DURATIONS: Record<string, number> = {
  "veo-2.0-generate-001": 8,
  "veo-3.0-generate-001": 8,
  "veo-3.0-fast-generate-001": 8,
  "veo-3.1-generate-001": 8,
  "veo-3.1-fast-generate-001": 8,
  "kling-v1": 10,
  "kling-v1-5": 10,
  "kling-v2.5-turbo": 10,
  "kling-v3": 15,
  // Seedance 2.0 Standard: 官方确认支持 5s / 10s / 15s
  "doubao-seedance-2-0-260128": 15,
  // Seedance 2.0 Fast: 官方文档确认支持 4~15s（480p/720p 输出，推理更快）
  // 中国区 Volcengine Ark；BytePlus 国际区对应 dreamina-seedance-2-0-fast-260128
  "doubao-seedance-2-0-fast-260128": 15,
  // Seedance 1.5 Pro: 官方文档确认 4~15s，支持 480p/720p/1080p
  "doubao-seedance-1-5-pro-250528": 15,
  // Seedance 1.5 Lite: 官方文档确认 4~10s，仅支持 480p
  "doubao-seedance-1-5-lite-250601": 10,
  // 即梦 Jimeng 3.0: 仅支持 5s 或 10s
  "jimeng_i2v_v30": 10,
  "jimeng_i2v_v30_1080": 10,
};

/** Family-level fallback: if modelId contains this substring, use this duration */
const FAMILY_MAX_DURATIONS: [string, number][] = [
  ["veo", 8],
  ["kling-v3", 15],
  ["kling", 10],
  ["seedance-2-0-fast", 15],  // fast 变体同样支持最高 15s（官方文档：4~15s）
  ["seedance-2-0", 15],       // Seedance 2.0 标准版支持 15s
  ["seedance-1-5-lite", 10],  // 1.5 Lite 上限 10s（官方确认）
  ["seedance-1-5", 15],       // 1.5 Pro 上限 15s（官方确认）
  ["seedance", 12],           // 兜底：未知 Seedance 版本按 12s
  ["jimeng", 10],             // 即梦系列默认最高 10s
];

export const DEFAULT_MAX_DURATION = 12;

/** Returns the maximum supported video duration (seconds) for the given model ID. Unknown models return 12. */
export function getModelMaxDuration(modelId?: string | null): number {
  if (!modelId) return DEFAULT_MAX_DURATION;

  const lowerModelId = modelId.toLowerCase();

  // Exact match
  if (lowerModelId in MODEL_MAX_DURATIONS) {
    return MODEL_MAX_DURATIONS[lowerModelId];
  }

  // Prefix match
  for (const key of Object.keys(MODEL_MAX_DURATIONS).sort((a, b) => b.length - a.length)) {
    if (lowerModelId.startsWith(key) || key.startsWith(lowerModelId)) {
      return MODEL_MAX_DURATIONS[key];
    }
  }

  // Family substring match (order matters — more specific first)
  for (const [family, duration] of FAMILY_MAX_DURATIONS) {
    if (lowerModelId.includes(family)) {
      return duration;
    }
  }

  return DEFAULT_MAX_DURATION;
}
