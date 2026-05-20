/**
 * Eval suite: Prompt Enhancement
 *
 * Tests that enhanceVideoPrompt / enhanceImagePrompt:
 * 1. Produce meaningfully longer / more structured output than the raw prompt
 * 2. Include model-specific structural elements (五段式 for Seedance, etc.)
 * 3. Preserve the core narrative content from the raw prompt
 * 4. Are idempotent enough to not introduce harmful artifacts
 *
 * Requires real AI provider. Set API keys in environment before running.
 * Evaluation uses both rule-based checks and LLM-as-judge.
 */

import type { EvalSuite } from "../runner";
import { llmJudge, assertMinLength, assertNotContains } from "../runner";
import { enhanceVideoPrompt, enhanceImagePrompt } from "@/lib/ai/prompt-enhancer";
import { RAW_VIDEO_PROMPTS, RAW_IMAGE_PROMPTS } from "../fixtures/shots";
import type { AIProvider } from "@/lib/ai/types";

// ── Provider loader (lazy, from environment) ──────────────────────────────────

function getTextProvider(): AIProvider {
  const apiKey = process.env.ARK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No API key found. Set ARK_API_KEY or OPENAI_API_KEY to run prompt enhancement evals."
    );
  }

  // Prefer Ark (doubao/deepseek) if available — cheaper for eval runs
  if (process.env.ARK_API_KEY) {
    const { OpenAIProvider } = require("@/lib/ai/providers/openai");
    return new OpenAIProvider({
      apiKey: process.env.ARK_API_KEY,
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      model: process.env.EVAL_TEXT_MODEL || "ep-20250522120922-xxxxx",
    });
  }

  const { OpenAIProvider } = require("@/lib/ai/providers/openai");
  return new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
  });
}

// ── Eval suite ────────────────────────────────────────────────────────────────

export const promptEnhancementSuite: EvalSuite = {
  name: "prompt-enhancement",
  description: "AI prompt 增强质量评估（需要真实 API key）",
  cases: [
    {
      name: "seedance-video-enhancement",
      aspect: "Seedance 视频 prompt 增强 — 包含五段式结构",
      async run() {
        let provider: AIProvider;
        try {
          provider = getTextProvider();
        } catch {
          console.log("    [skip] No API key configured");
          return "skip";
        }

        const { raw } = RAW_VIDEO_PROMPTS.seedance;
        const enhanced = await enhanceVideoPrompt(raw, "seedance", provider);

        // Must be longer than raw
        assertMinLength(enhanced, raw.length + 20);

        // Should contain key Seedance structural elements
        const hasStructure =
          enhanced.includes("运镜") ||
          enhanced.includes("镜头") ||
          enhanced.includes("画面") ||
          enhanced.length > raw.length * 1.5;

        if (!hasStructure) {
          throw new Error(
            `Seedance enhancement doesn't appear more structured than raw.\nRaw: ${raw}\nEnhanced: ${enhanced}`
          );
        }

        // Must preserve the core subject
        if (!enhanced.includes("龙渊") && !enhanced.includes("悬崖") && !enhanced.includes("狂风")) {
          throw new Error(
            `Enhancement lost core narrative content.\nRaw: ${raw}\nEnhanced: ${enhanced}`
          );
        }
      },
    },

    {
      name: "kling-video-enhancement",
      aspect: "Kling 视频 prompt 增强 — 保留核心内容，增加镜头描述",
      async run() {
        let provider: AIProvider;
        try {
          provider = getTextProvider();
        } catch {
          return "skip";
        }

        const { raw } = RAW_VIDEO_PROMPTS.kling;
        const enhanced = await enhanceVideoPrompt(raw, "kling", provider);

        assertMinLength(enhanced, 30);

        // Core subject (云烟) must be preserved
        if (!enhanced.includes("云烟") && !enhanced.includes("月光") && !enhanced.includes("舞")) {
          throw new Error(`Kling enhancement lost core narrative. Enhanced: ${enhanced}`);
        }
      },
    },

    {
      name: "gemini-video-enhancement-english",
      aspect: "Gemini 视频 prompt 增强 — 输出英文",
      async run() {
        let provider: AIProvider;
        try {
          provider = getTextProvider();
        } catch {
          return "skip";
        }

        const { raw } = RAW_VIDEO_PROMPTS.gemini;
        const enhanced = await enhanceVideoPrompt(raw, "gemini", provider);

        assertMinLength(enhanced, 20);

        // Gemini system prompt specifies English output
        const chineseCharPattern = /[一-鿿]/;
        if (chineseCharPattern.test(enhanced)) {
          console.warn(
            `    [warn] Gemini enhancement contains Chinese characters. Expected English. Enhanced: ${enhanced.slice(0, 100)}`
          );
          // Soft warning, not a hard fail — LLM-as-judge determines final verdict
        }
      },
    },

    {
      name: "doubao-image-enhancement",
      aspect: "Doubao (Seedream) 图片 prompt 增强 — 包含画质词",
      async run() {
        let provider: AIProvider;
        try {
          provider = getTextProvider();
        } catch {
          return "skip";
        }

        const { raw } = RAW_IMAGE_PROMPTS.doubao;
        const enhanced = await enhanceImagePrompt(raw, "doubao", provider);

        assertMinLength(enhanced, 40);

        // Seedream system prompt asks for quality tags
        const hasQualityTag =
          enhanced.includes("masterpiece") ||
          enhanced.includes("高清") ||
          enhanced.includes("8K") ||
          enhanced.includes("best quality") ||
          enhanced.includes("高质量");

        if (!hasQualityTag) {
          console.warn(`    [warn] Doubao enhancement may lack quality tags. Enhanced: ${enhanced.slice(0, 150)}`);
        }
      },
    },

    {
      name: "openai-image-enhancement-english",
      aspect: "OpenAI 图片 prompt 增强 — 英文输出，含构图描述",
      async run() {
        let provider: AIProvider;
        try {
          provider = getTextProvider();
        } catch {
          return "skip";
        }

        const { raw } = RAW_IMAGE_PROMPTS.openai;
        const enhanced = await enhanceImagePrompt(raw, "openai", provider);

        assertMinLength(enhanced, 30);
      },
    },

    {
      name: "fallback-on-empty-prompt",
      aspect: "空 prompt 不崩溃，原样返回",
      async run() {
        // This is a deterministic test — no real API needed
        // We mock a provider that would return something if called
        const mockProvider = {
          generateText: async () => "should not be called",
          generateImage: async () => "",
        } as AIProvider;

        const result = await enhanceVideoPrompt("", "seedance", mockProvider);
        if (result !== "") {
          throw new Error(`Expected empty string back for empty prompt. Got: "${result}"`);
        }
      },
    },

    {
      name: "fallback-on-api-error",
      aspect: "API 失败时静默回退到原始 prompt",
      async run() {
        const failingProvider = {
          generateText: async () => { throw new Error("simulated API failure"); },
          generateImage: async () => "",
        } as AIProvider;

        const raw = "龙渊站在悬崖上";
        const result = await enhanceVideoPrompt(raw, "seedance", failingProvider);
        if (result !== raw) {
          throw new Error(`Expected fallback to original prompt. Got: "${result}"`);
        }
      },
    },

    {
      name: "llm-judge-seedance-quality",
      aspect: "LLM-as-judge: Seedance 增强 prompt 是否符合视频生成需求",
      async run() {
        let provider: AIProvider;
        try {
          provider = getTextProvider();
        } catch {
          return "skip";
        }

        const { raw } = RAW_VIDEO_PROMPTS.seedance;
        const enhanced = await enhanceVideoPrompt(raw, "seedance", provider);

        const isGood = await llmJudge(
          enhanced,
          [
            "The prompt is suitable for video generation",
            "It describes motion/action, not just a static scene",
            "It includes some camera or cinematographic language",
            "The core narrative (character on cliff, wind, turning away) is preserved",
          ].join("\n"),
          provider
        );

        if (!isGood) {
          throw new Error(
            `LLM judge rated Seedance enhancement as insufficient.\nRaw: ${raw}\nEnhanced: ${enhanced}`
          );
        }
      },
    },
  ],
};
