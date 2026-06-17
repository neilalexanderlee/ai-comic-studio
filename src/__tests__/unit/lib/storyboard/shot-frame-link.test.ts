import { describe, it, expect, vi } from "vitest";
import type { shots, episodes } from "@/lib/db/schema";

type ShotRow = typeof shots.$inferSelect;

const mockLimit = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: mockLimit,
          })),
        })),
      })),
    })),
  },
}));

const shotFrameFileOnDisk = vi.fn<(path: string | null | undefined) => boolean>(() => true);
const resolveChainFramePath = vi.fn(
  (shot: { cutPoint?: string | null; anchorLastAi?: string | null }) =>
    shot.cutPoint ?? shot.anchorLastAi ?? undefined
);

vi.mock("@/lib/storyboard/frame-reference.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storyboard/frame-reference.server")>();
  return {
    ...actual,
    shotFrameFileOnDisk: (path: string | null | undefined) => shotFrameFileOnDisk(path),
    resolveChainFramePath: (shot: { cutPoint?: string | null; anchorLastAi?: string | null }) =>
      resolveChainFramePath(shot),
  };
});

import { resolvePreviousEpisodeTailFrame } from "@/lib/storyboard/shot-frame-link";

function makeShot(partial: Partial<ShotRow> & { sequence: number }): ShotRow {
  return {
    id: partial.id ?? `shot-${partial.sequence}`,
    projectId: "proj-1",
    episodeId: "ep-1",
    versionId: "ver-1",
    sequence: partial.sequence,
    prompt: partial.prompt ?? "",
    startFrameDesc: partial.startFrameDesc ?? null,
    endFrameDesc: partial.endFrameDesc ?? null,
    motionScript: partial.motionScript ?? null,
    anchorFirst: partial.anchorFirst ?? null,
    anchorLastAi: partial.anchorLastAi ?? null,
    cutPoint: partial.cutPoint ?? null,
    cameraDirection: "static",
    duration: 10,
    videoUrl: null,
    status: "completed",
  } as ShotRow;
}

describe("resolvePreviousEpisodeTailFrame", () => {
  it("第一集（sequence=1）返回空对象", async () => {
    mockLimit.mockResolvedValueOnce([{ sequence: 1 }]); // currentEp
    const result = await resolvePreviousEpisodeTailFrame({
      projectId: "proj-1",
      episodeId: "ep-1",
    });
    expect(result).toEqual({});
  });

  it("找不到上一集 → 返回空对象", async () => {
    mockLimit
      .mockResolvedValueOnce([{ sequence: 2 }])  // currentEp
      .mockResolvedValueOnce([]);                 // prevEp not found
    const result = await resolvePreviousEpisodeTailFrame({
      projectId: "proj-1",
      episodeId: "ep-2",
    });
    expect(result).toEqual({});
  });

  it("上一集最后一镜有 cut_point → 返回路径和 sourceType=cut_point", async () => {
    const lastShot = makeShot({ sequence: 5, cutPoint: "/uploads/cut-5.png" });
    mockLimit
      .mockResolvedValueOnce([{ sequence: 2 }])         // currentEp
      .mockResolvedValueOnce([{ id: "ep-1" }])          // prevEp
      .mockResolvedValueOnce([lastShot]);                // lastShot
    resolveChainFramePath.mockReturnValueOnce("/uploads/cut-5.png");
    shotFrameFileOnDisk.mockReturnValue(true);

    const result = await resolvePreviousEpisodeTailFrame({
      projectId: "proj-1",
      episodeId: "ep-2",
    });
    expect(result.sourceShotId).toBe(lastShot.id);
    expect(result.sourceType).toBe("cut_point");
  });
});
