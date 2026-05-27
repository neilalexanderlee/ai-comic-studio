import { describe, it, expect } from "vitest";
import { resolveDeprecatedGenerateAction } from "@/lib/storyboard/generate-route-deprecations";

describe("resolveDeprecatedGenerateAction", () => {
  it.each([
    "batch_frame_generate",
    "batch_video_generate",
    "batch_chain_generate",
    "single_reference_video",
    "frame_generate",
    "video_generate",
  ])("returns 410 for %s", (action) => {
    const res = resolveDeprecatedGenerateAction(action);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(410);
    expect(res!.error.length).toBeGreaterThan(0);
  });

  it("returns null for active actions", () => {
    expect(resolveDeprecatedGenerateAction("single_frame_generate")).toBeNull();
    expect(resolveDeprecatedGenerateAction("single_video_generate")).toBeNull();
  });
});
