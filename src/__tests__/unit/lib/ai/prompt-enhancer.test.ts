/**
 * Unit tests for prompt-enhancer.ts
 *
 * Verifies:
 * - Correct system prompt is selected for each protocol
 * - Enhancement result replaces raw prompt when provider succeeds
 * - Original prompt is returned silently when provider throws
 * - Empty prompts are returned unchanged
 */

import { describe, it, expect, vi } from "vitest";
import { makeTextProvider } from "../../../setup";
import {
  enhanceVideoPrompt,
  enhanceImagePrompt,
} from "@/lib/ai/prompt-enhancer";

// ── enhanceVideoPrompt ───────────────────────────────────────────────────────

describe("enhanceVideoPrompt", () => {
  it("returns enhanced output from text provider", async () => {
    const provider = makeTextProvider("Seedance enhanced prompt");
    const result = await enhanceVideoPrompt("raw prompt", "seedance", provider as never);
    expect(result).toBe("Seedance enhanced prompt");
    expect(provider.generateText).toHaveBeenCalledOnce();
  });

  it("passes Seedance-specific system prompt", async () => {
    const provider = makeTextProvider("ok");
    await enhanceVideoPrompt("raw", "seedance", provider as never);
    const callArgs = provider.generateText.mock.calls[0];
    const options = callArgs[1] as { systemPrompt?: string };
    expect(options?.systemPrompt).toContain("Seedance");
    expect(options?.systemPrompt).toContain("首尾帧模式");
  });

  it("passes systemPrompt for kling protocol", async () => {
    const provider = makeTextProvider("ok");
    await enhanceVideoPrompt("raw", "kling", provider as never);
    const callArgs = provider.generateText.mock.calls[0];
    const options = callArgs[1] as { systemPrompt?: string };
    expect(options?.systemPrompt).toContain("Kling");
  });

  it("uses generic fallback for unknown protocol", async () => {
    const provider = makeTextProvider("ok");
    await enhanceVideoPrompt("raw", "unknown_model_xyz", provider as never);
    const callArgs = provider.generateText.mock.calls[0];
    const options = callArgs[1] as { systemPrompt?: string };
    expect(options?.systemPrompt).toContain("分镜提示词");
  });

  it("returns original prompt when provider throws — silent fallback", async () => {
    const provider = {
      generateText: vi.fn().mockRejectedValue(new Error("API error")),
      generateImage: vi.fn(),
    };
    const result = await enhanceVideoPrompt("my raw prompt", "seedance", provider as never);
    expect(result).toBe("my raw prompt");
  });

  it("returns original prompt when enhanced text is empty", async () => {
    const provider = makeTextProvider("   "); // whitespace only
    const result = await enhanceVideoPrompt("original", "seedance", provider as never);
    expect(result).toBe("original");
  });

  it("returns raw prompt immediately when prompt is empty", async () => {
    const provider = makeTextProvider("should not be called");
    const result = await enhanceVideoPrompt("", "seedance", provider as never);
    expect(result).toBe("");
    expect(provider.generateText).not.toHaveBeenCalled();
  });

  it("uses low temperature (0.3) for deterministic output", async () => {
    const provider = makeTextProvider("ok");
    await enhanceVideoPrompt("raw", "gemini", provider as never);
    const callArgs = provider.generateText.mock.calls[0];
    const options = callArgs[1] as { temperature?: number };
    expect(options?.temperature).toBe(0.3);
  });
});

// ── enhanceImagePrompt ───────────────────────────────────────────────────────

describe("enhanceImagePrompt", () => {
  it("returns enhanced output from text provider", async () => {
    const provider = makeTextProvider("Seedream enhanced image prompt");
    const result = await enhanceImagePrompt("raw", "doubao", provider as never);
    expect(result).toBe("Seedream enhanced image prompt");
  });

  it("passes Seedream-specific system prompt for doubao protocol", async () => {
    const provider = makeTextProvider("ok");
    await enhanceImagePrompt("raw", "doubao", provider as never);
    const callArgs = provider.generateText.mock.calls[0];
    const options = callArgs[1] as { systemPrompt?: string };
    expect(options?.systemPrompt).toContain("Seedream");
  });

  it("passes OpenAI-specific English system prompt for openai protocol", async () => {
    const provider = makeTextProvider("ok");
    await enhanceImagePrompt("raw", "openai", provider as never);
    const callArgs = provider.generateText.mock.calls[0];
    const options = callArgs[1] as { systemPrompt?: string };
    expect(options?.systemPrompt).toContain("DALL-E");
    expect(options?.systemPrompt).toContain("comma-separated");
  });

  it("uses generic fallback for unknown image protocol", async () => {
    const provider = makeTextProvider("ok");
    await enhanceImagePrompt("raw", "some_new_model", provider as never);
    const callArgs = provider.generateText.mock.calls[0];
    const options = callArgs[1] as { systemPrompt?: string };
    expect(options?.systemPrompt).toContain("关键帧");
  });

  it("falls back to original on error", async () => {
    const provider = {
      generateText: vi.fn().mockRejectedValue(new Error("timeout")),
      generateImage: vi.fn(),
    };
    const result = await enhanceImagePrompt("my image prompt", "kling", provider as never);
    expect(result).toBe("my image prompt");
  });
});
