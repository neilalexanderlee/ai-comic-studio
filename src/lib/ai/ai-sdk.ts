import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

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
 * Walk a raw JSON string character by character and escape any literal
 * newlines / carriage returns / tabs that appear INSIDE a string value.
 * These are the most common cause of JSON.parse failures when an LLM
 * generates multi-line description fields.
 */
function repairJSONStrings(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
    }
    out += ch;
  }
  return out;
}

/**
 * Strip markdown code fences and <think> tags from AI response,
 * then repair common JSON issues (unescaped newlines inside strings).
 */
export function extractJSON(text: string): string {
  // Strip <think>...</think> blocks (extended thinking from reasoning models)
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const match = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : withoutThink.trim();
  // Remove non-printable control characters (except \n \r \t which repairJSONStrings handles)
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  return repairJSONStrings(cleaned);
}
