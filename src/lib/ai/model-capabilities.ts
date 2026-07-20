export type ModelCapability = "text" | "image" | "video" | "music";

/**
 * Gemini 的 models.list 会同时返回文本、图片、视频、语音等模型。
 * Provider 的 capability 只是用户给 Provider 的分组，不能证明其中每个模型都支持该能力。
 */
export function isGeminiModelCompatible(
  modelId: string,
  capability: ModelCapability
): boolean {
  const id = modelId.replace(/^models\//, "").toLowerCase();

  if (capability === "image") {
    return id.startsWith("gemini-") && /(?:^|[-_.])image(?:[-_.]|$)/.test(id);
  }

  if (capability === "video") {
    return /(?:^|[-_.])veo(?:[-_.]|$)/.test(id);
  }

  if (capability === "text") {
    return (
      id.startsWith("gemini-") &&
      !/(?:^|[-_.])(image|veo|tts|audio|embedding|aqa)(?:[-_.]|$)/.test(id)
    );
  }

  return false;
}
