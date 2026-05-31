import { describe, expect, it } from "vitest";
import {
  SINGLE_SHOT_REWRITE_DEFAULT_SLOTS,
  assembleSingleShotRewriteSystem,
} from "@/lib/ai/prompts/single-shot-rewrite-defaults";
import { BANNED_PLOT_TERMS_IN_TEMPLATES } from "@/lib/ai/prompts/prompt-template-standards";

describe("single_shot_rewrite defaults", () => {
  it("syncs scene description into motionScript without plot-specific examples", () => {
    const system = assembleSingleShotRewriteSystem(SINGLE_SHOT_REWRITE_DEFAULT_SLOTS);
    expect(system).toContain("场景描述 vs 动作脚本");
    expect(system).toContain("远景/建立");
    for (const term of BANNED_PLOT_TERMS_IN_TEMPLATES) {
      expect(system).not.toContain(term);
    }
  });
});
