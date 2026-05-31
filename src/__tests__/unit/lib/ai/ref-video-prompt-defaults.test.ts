import { describe, expect, it } from "vitest";
import { REF_VIDEO_PROMPT_DEFAULT_SLOTS } from "@/lib/ai/prompts/ref-video-prompt-defaults";
import { BANNED_PLOT_TERMS_IN_TEMPLATES } from "@/lib/ai/prompts/prompt-template-standards";

describe("ref_video_prompt defaults", () => {
  it("seedance slot has generic scene-description rules and example", () => {
    const seedance = REF_VIDEO_PROMPT_DEFAULT_SLOTS.seedance_system;
    expect(seedance).toContain("Scene description field");
    expect(seedance).toContain("角色A（视觉标识）");
    for (const term of BANNED_PLOT_TERMS_IN_TEMPLATES) {
      expect(seedance).not.toContain(term);
    }
  });

  it("kling slot has no plot-specific scene examples", () => {
    const kling = REF_VIDEO_PROMPT_DEFAULT_SLOTS.kling_system;
    expect(kling).toContain("Scene description");
    for (const term of BANNED_PLOT_TERMS_IN_TEMPLATES) {
      expect(kling).not.toContain(term);
    }
  });
});
