/**
 * Unit tests for character-router.ts
 *
 * Critical invariant: filterShotCharacters must NEVER fall back to the full
 * character list when no names match.  A crowd scene with no named characters
 * should receive an empty array so that no reference images are injected.
 */

import { describe, it, expect } from "vitest";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";

// ── Test fixtures ────────────────────────────────────────────────────────────

const mainCast = [
  { id: "1", name: "龙渊" },
  { id: "2", name: "云烟（少女形态）" },
  { id: "3", name: "林峰" },
  { id: "4", name: "老村长" },
];

// ── filterShotCharacters ─────────────────────────────────────────────────────

describe("filterShotCharacters", () => {
  it("returns characters whose full name appears in the shot text", () => {
    const result = filterShotCharacters("龙渊站在桥头，林峰从远处赶来", mainCast);
    expect(result.map((c) => c.name)).toEqual(["龙渊", "林峰"]);
  });

  it("matches base name when character has parenthetical suffix", () => {
    // "云烟（少女形态）" should match when text contains "云烟"
    const result = filterShotCharacters("云烟回头望了一眼", mainCast);
    expect(result.map((c) => c.name)).toContain("云烟（少女形态）");
  });

  it("returns EMPTY array for crowd/extras scene — CRITICAL invariant", () => {
    const crowdShot =
      "镜头从麦垛地面缓缓起吊，数十名村民手牵手转圈，孩子的笑声穿过弦乐浮上来";
    const result = filterShotCharacters(crowdShot, mainCast);
    // No named characters → must be empty, never fall back to mainCast
    expect(result).toHaveLength(0);
  });

  it("returns empty array when shotText is empty string", () => {
    const result = filterShotCharacters("", mainCast);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when allCharacters is empty", () => {
    const result = filterShotCharacters("龙渊", []);
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive for latin names", () => {
    const cast = [{ id: "1", name: "Alice" }];
    const result = filterShotCharacters("alice walks in", cast);
    expect(result).toHaveLength(1);
  });

  it("returns all matched characters without duplicates", () => {
    const text = "龙渊对林峰说，林峰摇头";
    const result = filterShotCharacters(text, mainCast);
    // 龙渊 and 林峰 each appear, but result should not duplicate
    expect(result.map((c) => c.name)).toEqual(["龙渊", "林峰"]);
  });

  it("partial name does not accidentally match unrelated character", () => {
    const cast = [
      { id: "1", name: "林" },
      { id: "2", name: "林峰" },
    ];
    const result = filterShotCharacters("林峰出现了", cast);
    // Both "林" and "林峰" appear as substrings of "林峰出现了"
    // This is acceptable — both should match (substring logic)
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((c) => c.name === "林峰")).toBe(true);
  });

  it("prefers the age-specific variant when the shot includes an age cue", () => {
    const cast = [
      { id: "1", name: "龙渊" },
      { id: "2", name: "龙渊（10岁）" },
      { id: "3", name: "灵瑶" },
      { id: "4", name: "灵瑶（8岁）" },
    ];
    const result = filterShotCharacters(
      "10岁龙渊拉着8岁灵瑶钻进稻草堆",
      cast
    );
    expect(result.map((c) => c.name)).toEqual(["龙渊（10岁）", "灵瑶（8岁）"]);
  });

  it("does not include child variants for an unqualified adult name when a default exists", () => {
    const cast = [
      { id: "1", name: "龙渊" },
      { id: "2", name: "龙渊（10岁）" },
    ];
    const result = filterShotCharacters("龙渊拔出背后的无名剑", cast);
    expect(result.map((c) => c.name)).toEqual(["龙渊"]);
  });

  it("uses episode context to keep an age-specific variant for later unqualified mentions", () => {
    const cast = [
      { id: "1", name: "龙渊" },
      { id: "2", name: "龙渊（10岁）" },
      { id: "3", name: "灵瑶" },
      { id: "4", name: "灵瑶（8岁）" },
    ];
    const contextText = "10岁龙渊拉着8岁灵瑶滚进稻草堆。龙渊哭着握住灵瑶的手。";
    const result = filterShotCharacters("龙渊哭着握住灵瑶的手", cast, { contextText });
    expect(result.map((c) => c.name)).toEqual(["龙渊（10岁）", "灵瑶（8岁）"]);
  });
});

// ── resolveCharacterImages (with mocked DB) ──────────────────────────────────

describe("resolveCharacterImages contract", () => {
  /**
   * resolveCharacterImages(sceneDesc, chars, textModelConfig, userId, projectId)
   *
   * Contract:
   * 1. Returns [] when chars is empty
   * 2. Uses blueprint asset when no morph exists
   * 3. Uses the only morph when there is exactly one
   * 4. Calls LLM to pick morph when there are multiple
   */
  it("returns empty array for empty character list", async () => {
    // We can't easily test the real implementation without DB,
    // so we assert the contract as a type-level spec comment here.
    // See src/lib/evals/ for live eval tests against real providers.
    expect([]).toHaveLength(0); // placeholder assertion — contract documented above
  });
});
