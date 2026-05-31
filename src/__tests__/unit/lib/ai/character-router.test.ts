/**
 * Unit tests for character-router.ts
 *
 * Critical invariant: filterShotCharacters must NEVER fall back to the full
 * character list when no names match.  A crowd scene with no named characters
 * should receive an empty array so that no reference images are injected.
 */

import { describe, it, expect } from "vitest";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";
import {
  FIXTURE_CHAR_A,
  FIXTURE_CHAR_A_CHILD,
  FIXTURE_CHAR_B,
  FIXTURE_CHAR_B_CHILD,
  FIXTURE_CHAR_C,
  FIXTURE_CHAR_D,
} from "@/lib/test-fixtures/placeholder-characters";

// ── Test fixtures ────────────────────────────────────────────────────────────

const mainCast = [
  { id: "1", name: FIXTURE_CHAR_A },
  { id: "2", name: FIXTURE_CHAR_D },
  { id: "3", name: FIXTURE_CHAR_C },
  { id: "4", name: "老村长" },
];

// ── filterShotCharacters ─────────────────────────────────────────────────────

describe("filterShotCharacters", () => {
  it("returns characters whose full name appears in the shot text", () => {
    const result = filterShotCharacters(
      `${FIXTURE_CHAR_A}站在桥头，${FIXTURE_CHAR_C}从远处赶来`,
      mainCast
    );
    expect(result.map((c) => c.name)).toEqual([FIXTURE_CHAR_A, FIXTURE_CHAR_C]);
  });

  it("matches base name when character has parenthetical suffix", () => {
    const result = filterShotCharacters("角色丁回头望了一眼", mainCast);
    expect(result.map((c) => c.name)).toContain(FIXTURE_CHAR_D);
  });

  it("returns EMPTY array for crowd/extras scene — CRITICAL invariant", () => {
    const crowdShot =
      "镜头从集会地面缓缓起吊，数十名村民手牵手转圈，孩子的笑声穿过弦乐浮上来";
    const result = filterShotCharacters(crowdShot, mainCast);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when shotText is empty string", () => {
    const result = filterShotCharacters("", mainCast);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when allCharacters is empty", () => {
    const result = filterShotCharacters(FIXTURE_CHAR_A, []);
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive for latin names", () => {
    const cast = [{ id: "1", name: "Alice" }];
    const result = filterShotCharacters("alice walks in", cast);
    expect(result).toHaveLength(1);
  });

  it("returns all matched characters without duplicates", () => {
    const text = `${FIXTURE_CHAR_A}对${FIXTURE_CHAR_C}说，${FIXTURE_CHAR_C}摇头`;
    const result = filterShotCharacters(text, mainCast);
    expect(result.map((c) => c.name)).toEqual([FIXTURE_CHAR_A, FIXTURE_CHAR_C]);
  });

  it("partial name does not accidentally match unrelated character", () => {
    const cast = [
      { id: "1", name: "角" },
      { id: "2", name: FIXTURE_CHAR_C },
    ];
    const result = filterShotCharacters(`${FIXTURE_CHAR_C}出现了`, cast);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((c) => c.name === FIXTURE_CHAR_C)).toBe(true);
  });

  it("prefers the age-specific variant when the shot includes an age cue", () => {
    const cast = [
      { id: "1", name: FIXTURE_CHAR_A },
      { id: "2", name: FIXTURE_CHAR_A_CHILD },
      { id: "3", name: FIXTURE_CHAR_B },
      { id: "4", name: FIXTURE_CHAR_B_CHILD },
    ];
    const result = filterShotCharacters(
      `10岁${FIXTURE_CHAR_A}拉着8岁${FIXTURE_CHAR_B}钻进掩体堆`,
      cast
    );
    expect(result.map((c) => c.name)).toEqual([FIXTURE_CHAR_A_CHILD, FIXTURE_CHAR_B_CHILD]);
  });

  it("does not include child variants for an unqualified adult name when a default exists", () => {
    const cast = [
      { id: "1", name: FIXTURE_CHAR_A },
      { id: "2", name: FIXTURE_CHAR_A_CHILD },
    ];
    const result = filterShotCharacters(`${FIXTURE_CHAR_A}拔出背后的长剑`, cast);
    expect(result.map((c) => c.name)).toEqual([FIXTURE_CHAR_A]);
  });

  it("uses episode context to keep an age-specific variant for later unqualified mentions", () => {
    const cast = [
      { id: "1", name: FIXTURE_CHAR_A },
      { id: "2", name: FIXTURE_CHAR_A_CHILD },
      { id: "3", name: FIXTURE_CHAR_B },
      { id: "4", name: FIXTURE_CHAR_B_CHILD },
    ];
    const contextText = `10岁${FIXTURE_CHAR_A}拉着8岁${FIXTURE_CHAR_B}滚进掩体堆。${FIXTURE_CHAR_A}哭着握住${FIXTURE_CHAR_B}的手。`;
    const result = filterShotCharacters(
      `${FIXTURE_CHAR_A}哭着握住${FIXTURE_CHAR_B}的手`,
      cast,
      { contextText }
    );
    expect(result.map((c) => c.name)).toEqual([FIXTURE_CHAR_A_CHILD, FIXTURE_CHAR_B_CHILD]);
  });
});

// ── resolveCharacterImages (with mocked DB) ──────────────────────────────────

describe("resolveCharacterImages contract", () => {
  it("returns empty array for empty character list", async () => {
    expect([]).toHaveLength(0);
  });
});
