import { describe, it, expect } from "vitest";
import {
  sanitizeEnhancedPromptOutput,
  stripReasoningFromModelOutput,
} from "@/lib/ai/sanitize-model-output";

const TRUNCATED_THINKING_ONLY = `<think>
用户需要我为一个Seedream视频模型整理分镜关键帧提示词。让我仔细分析需求：

**核心要求：**
1. 必须以「视频静帧画面。」开头
冷色月光与暖色火光形成对比，烘托出宁静却暗`;

describe("stripReasoningFromModelOutput", () => {
  it("removes complete thinking block and keeps trailing prompt", () => {
    const text = `<think>分析中…</think>
视频静帧画面。远景俯视，满月高悬，masterpiece`;
    expect(stripReasoningFromModelOutput(text)).toBe(
      "视频静帧画面。远景俯视，满月高悬，masterpiece"
    );
  });

  it("drops truncated thinking-only output", () => {
    expect(stripReasoningFromModelOutput(TRUNCATED_THINKING_ONLY)).toBe("");
  });
});

describe("sanitizeEnhancedPromptOutput", () => {
  const fallback = "视频静帧画面。原始构图，masterpiece";

  it("falls back when model returns only truncated thinking (user report)", () => {
    const result = sanitizeEnhancedPromptOutput(TRUNCATED_THINKING_ONLY, fallback, {
      requiredPrefix: "视频静帧画面。",
    });
    expect(result).toBe(fallback);
  });

  it("extracts prompt after thinking block", () => {
    const text = `<think>用户需要我分析…</think>
视频静帧画面。日本山间村落，满月，篝火暖光，masterpiece, 8K`;
    const result = sanitizeEnhancedPromptOutput(text, fallback, {
      requiredPrefix: "视频静帧画面。",
    });
    expect(result).toContain("视频静帧画面。");
    expect(result).not.toContain("用户需要");
  });
});
