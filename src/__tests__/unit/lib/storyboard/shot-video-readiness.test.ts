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
  const characters = [{ id: "c1", name: "龙渊", description: "" }];

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
          prompt: "龙渊站立",
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

  it("DB 有尾帧路径但磁盘缺失时走首帧模式 → 不 blocked", () => {
    shotFrameFileOnDisk.mockImplementation((p) => String(p).includes("first-ok"));

    const blocked = listBatchVideoBlockedShotsOnDisk(
      [
        {
          id: "s1",
          sequence: 2,
          anchorFirst: "/uploads/first-ok.png",
          anchorLastAi: "/uploads/last-missing.png",
          prompt: "龙渊转身",
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

  it("群演镜只需首帧在盘", () => {
    shotFrameFileOnDisk.mockReturnValue(true);

    const r = getShotVideoReadiness(
      { anchorFirst: "/uploads/first.png", anchorLastAi: null },
      true
    );
    expect(r.ready).toBe(true);
  });
});

describe("listBatchVideoBlockedShots (client)", () => {
  const characters = [{ id: "c1", name: "龙渊", description: "" }];

  it("无首帧路径 → 非 eligible，不进入预检列表", () => {
    const blocked = listBatchVideoBlockedShots(
      [{ id: "s1", sequence: 1, anchorFirst: null, prompt: "龙渊", videoUrl: null }],
      characters,
      "new_only"
    );
    expect(blocked).toHaveLength(0);
  });

  it("有首帧路径 → 不 blocked（磁盘由服务端再校验）", () => {
    const blocked = listBatchVideoBlockedShots(
      [
        {
          id: "s1",
          sequence: 1,
          anchorFirst: "/uploads/first.png",
          prompt: "龙渊",
          videoUrl: null,
        },
      ],
      characters,
      "new_only"
    );
    expect(blocked).toHaveLength(0);
  });
});

describe("getShotVideoReadiness (client)", () => {
  it("群演镜有首帧路径即可", () => {
    const r = getShotVideoReadinessClient(
      { anchorFirst: "/uploads/first.png", anchorLastAi: null },
      true
    );
    expect(r.ready).toBe(true);
  });
});
