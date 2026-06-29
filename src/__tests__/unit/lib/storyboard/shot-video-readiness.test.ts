import { describe, it, expect, vi, beforeEach } from "vitest";

const shotFrameFileOnDisk = vi.fn();

vi.mock("@/lib/storyboard/frame-reference.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storyboard/frame-reference.server")>();
  return {
    ...actual,
    shotFrameFileOnDisk: (path: string | null | undefined) => shotFrameFileOnDisk(path),
  };
});

import {
  getShotVideoReadiness,
  listBatchVideoBlockedShotsOnDisk,
} from "@/lib/storyboard/shot-video-readiness.server";
import {
  getShotVideoReadiness as getShotVideoReadinessClient,
  listBatchVideoBlockedShots,
} from "@/lib/storyboard/shot-video-readiness";

describe("listBatchVideoBlockedShotsOnDisk", () => {
  const characters = [{ id: "c1", name: "角色甲", description: "" }];

  beforeEach(() => {
    shotFrameFileOnDisk.mockReset();
  });

  it("无 video 且有 DB 首帧路径但磁盘缺失 → 列入 blocked", () => {
    shotFrameFileOnDisk.mockReturnValue(false);

    const blocked = listBatchVideoBlockedShotsOnDisk(
      [
        {
          id: "s1",
          sequence: 1,
          anchorFirst: "/uploads/missing.png",
          videoUrl: null,
        },
      ],
      characters,
      "new_only"
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0].sequence).toBe(1);
    expect(blocked[0].issue).toBe("missing_anchor_first");
  });

  it("已有 video 的镜不参与 new_only 预检", () => {
    shotFrameFileOnDisk.mockReturnValue(false);

    const blocked = listBatchVideoBlockedShotsOnDisk(
      [
        {
          id: "s1",
          sequence: 1,
          anchorFirst: "/uploads/missing.png",
          videoUrl: "/uploads/done.mp4",
        },
      ],
      characters,
      "new_only"
    );

    expect(blocked).toHaveLength(0);
  });

  it("有首帧路径且磁盘存在 → 不 blocked", () => {
    shotFrameFileOnDisk.mockImplementation((p) => String(p).includes("first-ok"));

    const blocked = listBatchVideoBlockedShotsOnDisk(
      [
        {
          id: "s1",
          sequence: 2,
          anchorFirst: "/uploads/first-ok.png",
          anchorLastAi: "/uploads/last-missing.png",
          videoUrl: null,
        },
      ],
      characters,
      "new_only"
    );

    expect(blocked).toHaveLength(0);
  });
});

describe("getShotVideoReadiness (server)", () => {
  beforeEach(() => {
    shotFrameFileOnDisk.mockReset();
  });

  it("无首帧路径 → not ready", () => {
    shotFrameFileOnDisk.mockReturnValue(false);
    const r = getShotVideoReadiness({ anchorFirst: null });
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.issue).toBe("missing_anchor_first");
  });

  it("有首帧路径且磁盘存在 → ready（含群演）", () => {
    shotFrameFileOnDisk.mockReturnValue(true);
    const r = getShotVideoReadiness(
      { anchorFirst: "/uploads/first.png", anchorLastAi: null }
    );
    expect(r.ready).toBe(true);
  });
});

describe("listBatchVideoBlockedShots (client)", () => {
  const characters = [{ id: "c1", name: "角色甲", description: "" }];

  it("无首帧路径 → 非 eligible，不进入预检列表", () => {
    const blocked = listBatchVideoBlockedShots(
      [{ id: "s1", sequence: 1, anchorFirst: null, videoUrl: null }],
      characters,
      "new_only"
    );
    expect(blocked).toHaveLength(0);
  });

  it("有首帧路径 → 不 blocked（磁盘由服务端再校验）", () => {
    const blocked = listBatchVideoBlockedShots(
      [{ id: "s1", sequence: 1, anchorFirst: "/uploads/first.png", videoUrl: null }],
      characters,
      "new_only"
    );
    expect(blocked).toHaveLength(0);
  });
});

describe("getShotVideoReadiness (client)", () => {
  it("有首帧路径即可（含群演）", () => {
    const r = getShotVideoReadinessClient(
      { anchorFirst: "/uploads/first.png", anchorLastAi: null }
    );
    expect(r.ready).toBe(true);
  });

  it("无首帧路径 → not ready", () => {
    const r = getShotVideoReadinessClient({ anchorFirst: null });
    expect(r.ready).toBe(false);
  });
});
