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
    const ids = collectStalePromptTemplateIds([
      {
        id: "a",
        promptKey: "ref_video_prompt",
        slotKey: "motion_rules",
      },
      {
        id: "b",
        promptKey: "ref_video_prompt",
        slotKey: "seedance_system",
      },
    ]);
    expect(ids).toEqual(["a"]);
    expect(ids).not.toContain("b");
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
