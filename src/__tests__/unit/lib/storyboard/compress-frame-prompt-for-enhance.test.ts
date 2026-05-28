import { describe, it, expect } from "vitest";
import { compressFramePromptForEnhancement } from "@/lib/storyboard/compress-frame-prompt-for-enhance";

describe("compressFramePromptForEnhancement", () => {
  it("returns short prompts unchanged", () => {
    const short = "视频静帧画面。远景小镇，满月。";
    expect(compressFramePromptForEnhancement(short)).toBe(short);
  });

  it("extracts primary frame section from registry-style prompt", () => {
    const long = [
      "视频静帧画面。【画风硬锁】日本现代2D动漫——",
      "=== 【最高优先级】首帧静止画面（动作开始前）===",
      "本图是视频起始静帧。",
      "远景静谧小镇，满月，篝火，无入侵。",
      "=== 镜头情节上下文（仅供理解地点/场次，禁止画进首帧）===",
      "魔族涌入，村民逃散",
      "=== 渲染标准 ===",
      "x".repeat(800),
    ].join("\n");

    const out = compressFramePromptForEnhancement(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("远景静谧小镇");
    expect(out).toContain("魔族涌入");
    expect(out).not.toContain("x".repeat(100));
  });
});
