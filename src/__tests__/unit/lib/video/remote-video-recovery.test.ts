import { describe, it, expect } from "vitest";
import {
  formatRemoteVideoRecoveryLabels,
  isRecoverableRemoteVideo,
} from "@/lib/video/remote-video-recovery";

describe("isRecoverableRemoteVideo", () => {
  const base = {
    remoteVideoUrl: "https://cdn.example/v.mp4",
    remoteVideoStatus: "available" as string | null,
    remoteVideoExpiresAt: "2099-01-01T00:00:00.000Z",
    hasLocalVideo: false,
    nowMs: Date.parse("2026-05-01T00:00:00.000Z"),
  };

  it("returns true when remote exists, not expired, no local video", () => {
    expect(isRecoverableRemoteVideo(base)).toBe(true);
  });

  it("returns false when local video exists", () => {
    expect(isRecoverableRemoteVideo({ ...base, hasLocalVideo: true })).toBe(false);
  });

  it("returns false when status is expired", () => {
    expect(isRecoverableRemoteVideo({ ...base, remoteVideoStatus: "expired" })).toBe(false);
  });

  it("returns false when past expiry", () => {
    expect(
      isRecoverableRemoteVideo({
        ...base,
        remoteVideoExpiresAt: "2020-01-01T00:00:00.000Z",
      })
    ).toBe(false);
  });
});

describe("formatRemoteVideoRecoveryLabels", () => {
  it("uses download_failed copy", () => {
    const labels = formatRemoteVideoRecoveryLabels({
      remoteVideoStatus: "download_failed",
      remoteVideoExpiresAt: "2099-01-01T00:00:00.000Z",
      remoteVideoLastDownloadAt: "2026-05-01T12:00:00.000Z",
    });
    expect(labels.hintText).toBe("可重下远程结果");
    expect(labels.hintTitle).toContain("重新下载");
  });
});
