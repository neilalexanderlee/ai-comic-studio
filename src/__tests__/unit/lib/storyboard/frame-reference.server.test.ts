import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

const TEST_FRAME_DIR = path.join(process.cwd(), "src/__tests__/fixtures/tmp-frames");
const mockDbLimit = vi.fn();

function writeTestFrame(name: string): string {
  fs.mkdirSync(TEST_FRAME_DIR, { recursive: true });
  const file = path.join(TEST_FRAME_DIR, name);
  fs.writeFileSync(file, "x");
  return file;
}

beforeEach(() => {
  vi.mocked(fs.existsSync).mockImplementation(
    (p) => typeof p === "string" && p.includes("tmp-frames")
  );
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: mockDbLimit,
      })),
    })),
  } as never);
});

import {
  resolveShotFrameByType,
  resolveFrameReferenceForProject,
  frameReferenceContinuityLabel,
} from "@/lib/storyboard/frame-reference.server";

describe("resolveShotFrameByType", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = writeTestFrame(`frame-ref-${Date.now()}-${Math.random()}.png`);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it("返回磁盘上存在的 anchor_first", () => {
    expect(resolveShotFrameByType({ anchorFirst: tmpFile }, "anchor_first")).toBe(tmpFile);
  });

  it("路径不存在时返回 undefined", () => {
    expect(resolveShotFrameByType({ anchorFirst: "/nonexistent/frame.png" }, "anchor_first")).toBeUndefined();
  });

  it("按类型选择 cut_point / anchor_last_ai", () => {
    expect(resolveShotFrameByType({ cutPoint: tmpFile }, "cut_point")).toBe(tmpFile);
    expect(resolveShotFrameByType({ anchorLastAi: tmpFile }, "anchor_last_ai")).toBe(tmpFile);
  });
});

describe("resolveFrameReferenceForProject", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = writeTestFrame(`frame-ref-db-${Date.now()}.png`);
    mockDbLimit.mockReset();
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it("解析同 project 内指定镜与帧类型", async () => {
    mockDbLimit.mockResolvedValue([
      {
        id: "shot-a",
        projectId: "proj-1",
        sequence: 5,
        anchorFirst: tmpFile,
        anchorLastAi: null,
        cutPoint: null,
      },
    ]);

    const resolved = await resolveFrameReferenceForProject("proj-1", {
      shotId: "shot-a",
      frameType: "anchor_first",
    });

    expect(resolved).toEqual({
      path: tmpFile,
      shotId: "shot-a",
      frameType: "anchor_first",
      sourceSequence: 5,
    });
  });

  it("分镜不存在或文件不在磁盘时返回 null", async () => {
    mockDbLimit.mockResolvedValue([]);
    expect(
      await resolveFrameReferenceForProject("proj-1", {
        shotId: "missing",
        frameType: "cut_point",
      })
    ).toBeNull();

    mockDbLimit.mockResolvedValue([
      {
        id: "shot-b",
        projectId: "proj-1",
        sequence: 2,
        anchorFirst: "/nonexistent.png",
        anchorLastAi: null,
        cutPoint: null,
      },
    ]);
    expect(
      await resolveFrameReferenceForProject("proj-1", {
        shotId: "shot-b",
        frameType: "anchor_first",
      })
    ).toBeNull();
  });
});

describe("frameReferenceContinuityLabel", () => {
  it("生成镜号与帧类型标签", () => {
    expect(frameReferenceContinuityLabel(3, "cut_point")).toBe("镜3·视频尾帧");
  });
});
