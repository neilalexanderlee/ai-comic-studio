/**
 * Unit tests for frame-generation-strategy.ts
 *
 * Only tests the deterministic layer (no LLM calls needed).
 * The LLM layer is tested implicitly via integration tests.
 */
import { describe, it, expect } from "vitest";
import { resolveFrameMode } from "@/lib/storyboard/frame-generation-strategy";

// Helper: call with no textConfig so we stay in deterministic + fallback path
async function decide(
  shot: Partial<Parameters<typeof resolveFrameMode>[0]>,
  hasChars: boolean
) {
  return resolveFrameMode(
    {
      duration: 10,
      cameraDirection: "slow dolly in",
      startFrameDesc: "角色站在门口，侧身看向窗外，逆光轮廓清晰",
      endFrameDesc: "角色转身面向镜头，双手握剑，眉心紧皱",
      prompt: "龙渊走入大殿",
      ...shot,
    },
    hasChars,
    null // no LLM
  );
}

describe("resolveFrameMode — deterministic layer", () => {
  it("crowd shot (no named chars) → first_only", async () => {
    const result = await decide({}, false);
    expect(result.mode).toBe("first_only");
    expect(result.source).toBe("deterministic");
  });

  it("duration < 5s → first_only", async () => {
    const result = await decide({ duration: 4 }, true);
    expect(result.mode).toBe("first_only");
    expect(result.source).toBe("deterministic");
  });

  it("missing endFrameDesc → first_only", async () => {
    const result = await decide({ endFrameDesc: null }, true);
    expect(result.mode).toBe("first_only");
    expect(result.source).toBe("deterministic");
  });

  it("empty endFrameDesc → first_only", async () => {
    const result = await decide({ endFrameDesc: "   " }, true);
    expect(result.mode).toBe("first_only");
    expect(result.source).toBe("deterministic");
  });

  it("near-identical start/end descs (Jaccard > 0.82) → first_only", async () => {
    const desc = "龙渊（黑甲银纹）站在殿中央，剑悬于背，琥珀眼直视前方，侧光勾勒轮廓";
    const result = await decide(
      { startFrameDesc: desc, endFrameDesc: desc },
      true
    );
    expect(result.mode).toBe("first_only");
    expect(result.source).toBe("deterministic");
  });

  it("clearly different start/end descs → falls through to fallback 'both'", async () => {
    const result = await decide(
      {
        startFrameDesc: "龙渊站立，手离剑柄，目光低垂",
        endFrameDesc: "龙渊跪地，剑插土中，仰望天空",
        duration: 10,
      },
      true
    );
    // No LLM → fallback = "both"
    expect(result.mode).toBe("both");
    expect(result.source).toBe("fallback");
  });

  it("named chars + duration=5 (boundary) → passes through to fallback 'both'", async () => {
    const result = await decide({ duration: 5 }, true);
    expect(result.mode).toBe("both");
    expect(result.source).toBe("fallback");
  });

  it("English descriptions work the same way", async () => {
    const result = await decide(
      {
        startFrameDesc: "Hero stands at doorway, backlit silhouette, hand on sword hilt",
        endFrameDesc: null,
        prompt: "Long walks into the throne room",
      },
      true
    );
    expect(result.mode).toBe("first_only"); // missing endFrameDesc
  });
});
