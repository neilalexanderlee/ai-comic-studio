import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { jsonrepair } from "jsonrepair";
import { stripReasoningFromModelOutput } from "./sanitize-model-output";

export interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  modelId: string;
}

export function createLanguageModel(config: ProviderConfig): LanguageModel {
  switch (config.protocol) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider.chat(config.modelId);
    }
    case "gemini": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
      });
      return provider(config.modelId);
    }
    default:
      throw new Error(`Unsupported protocol: ${config.protocol}`);
  }
}

/**
 * Strip markdown code fences and <think> tags from AI response,
 * then use jsonrepair to fix all common LLM JSON mistakes:
 * unescaped quotes, literal newlines, trailing commas, missing brackets, etc.
 */
export function extractJSON(text: string): string {
  const processed = stripReasoningFromModelOutput(text);
  const match = processed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : processed.trim();
  // Remove non-printable control characters
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  if (!cleaned) {
    throw new Error("AI response was empty after stripping thinking/comments — likely truncated by maxOutputTokens");
  }
  return jsonrepair(findFirstCompleteJsonValue(cleaned) ?? cleaned);
}

/** Ignore trailing model commentary (including a lone `/`) after a complete JSON value. */
function findFirstCompleteJsonValue(text: string): string | null {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const start = objectStart < 0
    ? arrayStart
    : arrayStart < 0
      ? objectStart
      : Math.min(objectStart, arrayStart);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) return null;
      stack.pop();
      if (stack.length === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
