/** 推理模型常见的思考链标记（中英） */
const CHAIN_OF_THOUGHT_MARKERS = [
  "用户需要我",
  "让我仔细分析",
  "**核心要求**",
  "我需要理解",
  "矛盾点",
  "写作原则：",
  "Your task is to",
  "Let me analyze",
];

const THINKING_BLOCK_RE =
  /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi;

const REDACTED_THINKING_BLOCK_RE =
  /<think>[\s\S]*?<\/redacted_thinking>/gi;

/**
 * 去掉推理模型的思考链、HTML 注释等，保留可发给下游模型的正文。
 */
export function stripReasoningFromModelOutput(text: string): string {
  let processed = text
    .replace(THINKING_BLOCK_RE, "")
    .replace(REDACTED_THINKING_BLOCK_RE, "")
    .trim();

  const redactedOpen = processed.search(/<think>/i);
  if (redactedOpen >= 0) {
    processed = processed.slice(0, redactedOpen).trim();
  }
  const thinkOpen = processed.search(/<think(?:ing)?>/i);
  if (thinkOpen >= 0) {
    processed = processed.slice(0, thinkOpen).trim();
  }

  processed = processed.replace(/<!--[\s\S]*?-->/g, "").trim();
  return processed;
}

function looksLikeChainOfThought(text: string): boolean {
  return CHAIN_OF_THOUGHT_MARKERS.some((m) => text.includes(m));
}

function takeFirstPromptChunk(text: string): string {
  const stop = text.search(/\n\n(?:等等|实际的首帧|我整合|Let me)/);
  const chunk = stop > 0 ? text.slice(0, stop) : text;
  const firstPara = chunk.split(/\n\n+/)[0] ?? chunk;
  return firstPara.replace(/\s+/g, " ").trim();
}

/**
 * 从「AI 增强」类文本输出中抽取最终提示词；若仍是思考链或为空则回退到 fallback。
 */
export function sanitizeEnhancedPromptOutput(
  rawModelText: string,
  fallbackPrompt: string,
  options?: { requiredPrefix?: string }
): string {
  const stripped = stripReasoningFromModelOutput(rawModelText);
  if (!stripped) return fallbackPrompt;

  if (options?.requiredPrefix) {
    const idx = stripped.indexOf(options.requiredPrefix);
    if (idx >= 0) {
      const candidate = takeFirstPromptChunk(stripped.slice(idx));
      if (candidate && !looksLikeChainOfThought(candidate)) {
        return candidate;
      }
    }
  }

  if (looksLikeChainOfThought(stripped)) {
    return fallbackPrompt;
  }

  if (stripped.length <= 800 && !/^#+\s/m.test(stripped)) {
    const candidate = takeFirstPromptChunk(stripped);
    if (candidate && !looksLikeChainOfThought(candidate)) {
      return candidate;
    }
  }

  return fallbackPrompt;
}
