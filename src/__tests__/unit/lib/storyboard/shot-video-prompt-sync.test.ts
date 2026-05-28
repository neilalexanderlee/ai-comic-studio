import { describe, it, expect, vi, beforeEach } from "vitest";
import * as readiness from "@/lib/storyboard/shot-video-readiness.server";

vi.mock("fs", () => ({
  default: {
    statSync: vi.fn().mockReturnValue({ mtimeMs: 1700000000000 }),
  },
  statSync: vi.fn().mockReturnValue({ mtimeMs: 1700000000000 }),
}));

import {
  computeVideoPromptFrameFingerprint,
  shouldRefreshVideoPrompt,
} from "@/lib/storyboard/shot-video-prompt-sync.server";

describe("shot-video-prompt-sync fingerprint", () => {
  beforeEach(() => {
    vi.spyOn(readiness, "collectVisionFramePaths").mockReturnValue([
      "/uploads/projects/p1/frame_a.png",
    ]);
  });

  it("should not refresh when no frames on disk", () => {
    vi.mocked(readiness.collectVisionFramePaths).mockReturnValue([]);
    expect(
      shouldRefreshVideoPrompt({
        videoPrompt: "existing",
        videoPromptFrameFingerprint: "x",
        anchorFirst: "/uploads/x.png",
      })
    ).toBe(false);
  });

  it("should refresh when videoPrompt missing and frames exist", () => {
    expect(
      shouldRefreshVideoPrompt({
        videoPrompt: "",
        videoPromptFrameFingerprint: null,
        anchorFirst: "/uploads/x.png",
      })
    ).toBe(true);
  });

  it("should refresh when fingerprint mismatches stored value", () => {
    const fingerprint = computeVideoPromptFrameFingerprint({
      anchorFirst: "/uploads/projects/p1/frame_a.png",
    });
    expect(fingerprint).toContain("frame_a.png");
    expect(
      shouldRefreshVideoPrompt({
        videoPrompt: "existing",
        videoPromptFrameFingerprint: "stale-fingerprint",
        anchorFirst: "/uploads/projects/p1/frame_a.png",
      })
    ).toBe(true);
  });
});
