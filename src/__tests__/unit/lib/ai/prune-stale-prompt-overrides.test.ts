import { describe, expect, it } from "vitest";
import {
  collectStalePromptTemplateIds,
  REMOVED_PROMPT_KEYS,
  RESET_WIRED_PROMPT_KEYS,
} from "@/lib/ai/prompts/prune-stale-prompt-overrides";

describe("collectStalePromptTemplateIds", () => {
  it("removes deleted registry keys", () => {
    const ids = collectStalePromptTemplateIds([
      { id: "1", promptKey: "scene_frame_generate", slotKey: "role_definition" },
      { id: "2", promptKey: "shot_split", slotKey: "role_definition" },
    ]);
    expect(ids).toEqual(["1"]);
  });

  it("removes orphan slots on active prompts", () => {
    // shot_split 是仍在 registry 里注册的活跃 prompt key（见 registry.ts shotSplitDef.slots），
    // "role_definition" 是其真实 slot，"motion_rules" 不是 —— 用真实活跃 key 而非已废弃的
    // ref_video_prompt（现已整体归入 REMOVED_PROMPT_KEYS，见 prune-stale-prompt-overrides.ts）。
    const ids = collectStalePromptTemplateIds([
      {
        id: "a",
        promptKey: "shot_split",
        slotKey: "motion_rules",
      },
      {
        id: "b",
        promptKey: "shot_split",
        slotKey: "role_definition",
      },
    ]);
    expect(ids).toEqual(["a"]);
    expect(ids).not.toContain("b");
  });

  it("removes all overrides for a fully-retired prompt key (ref_video_prompt)", () => {
    const ids = collectStalePromptTemplateIds([
      { id: "a", promptKey: "ref_video_prompt", slotKey: "motion_rules" },
      { id: "b", promptKey: "ref_video_prompt", slotKey: "seedance_system" },
    ]);
    expect(ids).toEqual(["a", "b"]);
  });

  it("resetWired clears all overrides for rewired keys", () => {
    const ids = collectStalePromptTemplateIds(
      [
        { id: "x", promptKey: "character_extract", slotKey: "scope_rules" },
        { id: "y", promptKey: "character_extract", slotKey: null },
      ],
      { resetWired: true }
    );
    expect(ids).toEqual(["x", "y"]);
    expect(RESET_WIRED_PROMPT_KEYS.has("character_extract")).toBe(true);
    expect(REMOVED_PROMPT_KEYS.has("scene_frame_generate")).toBe(true);
  });
});
