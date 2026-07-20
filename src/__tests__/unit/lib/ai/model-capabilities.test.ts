import { describe, expect, it } from "vitest";
import { isGeminiModelCompatible } from "@/lib/ai/model-capabilities";

describe("isGeminiModelCompatible", () => {
  it("rejects text-only Gemini models for image generation", () => {
    expect(isGeminiModelCompatible("gemini-3.5-flash", "image")).toBe(false);
    expect(isGeminiModelCompatible("gemini-2.5-flash", "image")).toBe(false);
  });

  it("accepts Nano Banana image model IDs", () => {
    expect(isGeminiModelCompatible("gemini-2.5-flash-image", "image")).toBe(true);
    expect(isGeminiModelCompatible("models/gemini-3-pro-image-preview", "image")).toBe(true);
    expect(isGeminiModelCompatible("gemini-3.1-flash-image", "image")).toBe(true);
  });

  it("separates text, image, and Veo models", () => {
    expect(isGeminiModelCompatible("gemini-3.5-flash", "text")).toBe(true);
    expect(isGeminiModelCompatible("gemini-3.1-flash-image", "text")).toBe(false);
    expect(isGeminiModelCompatible("models/veo-3.1-generate-preview", "video")).toBe(true);
  });
});
