import type { WholeDramaSource } from "./pipeline-resume";

export const WHOLE_DRAMA_SOURCE_LIMITS: Record<WholeDramaSource, number | null> = {
  idea: 5_000,
  novel: 120_000,
  // 成熟剧本不做字符数硬限制。上传文件仍受 20MB 限制，后续分析按块执行。
  script: null,
};

export function validateWholeDramaSourceLength(
  sourceType: WholeDramaSource,
  text: string
): string | null {
  const length = text.trim().length;
  if (length === 0) return "输入内容不能为空";

  const limit = WHOLE_DRAMA_SOURCE_LIMITS[sourceType];
  if (limit === null || length <= limit) return null;

  const label = sourceType === "idea" ? "故事想法" : sourceType === "novel" ? "小说内容" : "剧本内容";
  return `${label}不能超过 ${limit.toLocaleString("zh-CN")} 字，当前为 ${length.toLocaleString("zh-CN")} 字`;
}
