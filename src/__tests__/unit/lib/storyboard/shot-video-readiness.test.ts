import { describe, it, expect, vi, beforeEach } from "vitest";

const shotFrameUsable = vi.fn();

vi.mock("@/lib/storyboard/frame-reference.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storyboard/frame-reference.server")>();
  return {
    ...actual,
    shotFrameUsable: (path: string | null | undefined) => shotFrameUsable(path),
  };
});

import {
  getShotVideoReadiness,
  listBatchVideoBlockedShotsOnDisk,
  resolveSingleVideoMode,
} from "@/lib/storyboard/shot-video-readiness.server";
import {
  getShotVideoReadiness as getShotVideoReadinessClient,
  listBatchVideoBlockedShots,
} from "@/lib/storyboard/shot-video-readiness";

describe("listBatchVideoBlockedShotsOnDisk", () => {
  const characters = [{ id: "c1", name: "角色甲", description: "" }];

  beforeEach(() => {
    shotFrameUsable.mockReset();
  });

  it("无 video 且有 DB 首帧路径但磁盘缺失 → 列入 blocked", () => {
    shotFrameUsable.mockReturnValue(false);

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
    shotFrameUsable.mockReturnValue(false);

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
    shotFrameUsable.mockImplementation((p) => String(p).includes("first-ok"));

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
    shotFrameUsable.mockReset();
  });

  it("无首帧路径 → not ready", () => {
    shotFrameUsable.mockReturnValue(false);
    const r = getShotVideoReadiness({ anchorFirst: null });
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.issue).toBe("missing_anchor_first");
  });

  it("有首帧路径且磁盘存在 → ready（含群演）", () => {
    shotFrameUsable.mockReturnValue(true);
    const r = getShotVideoReadiness(
      { anchorFirst: "/uploads/first.png", anchorLastAi: null }
    );
    expect(r.ready).toBe(true);
  });
});

describe("resolveSingleVideoMode", () => {
  beforeEach(() => {
    shotFrameUsable.mockReset();
  });

  it("尾帧文件存在 → keyframe", () => {
    shotFrameUsable.mockImplementation((p) => p === "/uploads/last-ok.png");
    expect(resolveSingleVideoMode({ anchorLastAi: "/uploads/last-ok.png" })).toBe("keyframe");
  });

  it("无尾帧但 strict_start → initialImage", () => {
    shotFrameUsable.mockReturnValue(false);
    expect(
      resolveSingleVideoMode({
        anchorLastAi: null,
        chainSourceShotId: "prev-shot",
        anchorFirstContinuityMode: "strict_start",
      })
    ).toBe("initialImage");
  });

  it("参考图重绘首帧即使有来源追溯 → multimodal", () => {
    shotFrameUsable.mockReturnValue(false);
    expect(
      resolveSingleVideoMode({
        anchorLastAi: null,
        chainSourceShotId: "ref-shot",
        anchorFirstContinuityMode: "reference_redraw",
      })
    ).toBe("multimodal");
  });

  it("历史链源数据没有 continuity mode → initialImage", () => {
    shotFrameUsable.mockReturnValue(false);
    expect(resolveSingleVideoMode({ anchorLastAi: null, chainSourceShotId: "legacy-prev-shot" })).toBe("initialImage");
  });

  it("普通只生成首帧镜头 → multimodal", () => {
    shotFrameUsable.mockReturnValue(false);
    expect(resolveSingleVideoMode({ anchorLastAi: null, chainSourceShotId: null })).toBe("multimodal");
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

  it("无首帧路径但落在 multimodal 模式（无尾帧、无严格首帧承接）→ ready（服务端会优雅降级为纯文字提示词生成）", () => {
    const r = getShotVideoReadinessClient({ anchorFirst: null });
    expect(r.ready).toBe(true);
  });

  it("无首帧路径且有尾帧（keyframe 模式）→ not ready", () => {
    const r = getShotVideoReadinessClient({ anchorFirst: null, anchorLastAi: "/uploads/last.png" });
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.issue).toBe("missing_anchor_first");
  });

  it("无首帧路径且 strict_start 严格首帧承接（initialImage 模式）→ not ready", () => {
    const r = getShotVideoReadinessClient({
      anchorFirst: null,
      anchorLastAi: null,
      anchorFirstContinuityMode: "strict_start",
    });
    expect(r.ready).toBe(false);
  });

  it("无首帧路径但 continuity mode 是 reference_redraw（multimodal 模式）→ ready", () => {
    const r = getShotVideoReadinessClient({
      anchorFirst: null,
      anchorLastAi: null,
      chainSourceShotId: "ref-shot",
      anchorFirstContinuityMode: "reference_redraw",
    });
    expect(r.ready).toBe(true);
  });

  it("无首帧路径且历史链源数据没有 continuity mode（initialImage 模式）→ not ready", () => {
    const r = getShotVideoReadinessClient({
      anchorFirst: null,
      anchorLastAi: null,
      chainSourceShotId: "legacy-prev-shot",
    });
    expect(r.ready).toBe(false);
  });
});
