import { describe, expect, it } from "vitest";
import { REF_VIDEO_PROMPT_DEFAULT_SLOTS } from "@/lib/ai/prompts/ref-video-prompt-defaults";
import { BANNED_PLOT_TERMS_IN_TEMPLATES } from "@/lib/ai/prompts/prompt-template-standards";

describe("ref_video_prompt defaults", () => {
  it("seedance slot prioritizes frame anchors over scene description", () => {
    const seedance = REF_VIDEO_PROMPT_DEFAULT_SLOTS.seedance_system;
    expect(seedance).toContain("FRAME FIDELITY");
    expect(seedance).toContain("FIRST FRAME is the starting state");
    expect(seedance).toContain("Scene description field");
    expect(seedance).toContain("supplemental context");
    expect(seedance).not.toContain("merge ALL plot/environment beats");
    expect(seedance).toContain("角色A（视觉标识）");
    for (const term of BANNED_PLOT_TERMS_IN_TEMPLATES) {
      expect(seedance).not.toContain(term);
    }
  });

  it("kling slot has no plot-specific scene examples", () => {
    const kling = REF_VIDEO_PROMPT_DEFAULT_SLOTS.kling_system;
    expect(kling).toContain("Scene description");
    expect(kling).toContain("当前首帧/起幅开始");
    expect(kling).not.toContain("全部情节要素写入输出");
    for (const term of BANNED_PLOT_TERMS_IN_TEMPLATES) {
      expect(kling).not.toContain(term);
    }
  });
});
