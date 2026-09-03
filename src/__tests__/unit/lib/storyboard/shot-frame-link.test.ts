import { describe, it, expect, vi, beforeEach } from "vitest";
import type { shots, episodes } from "@/lib/db/schema";

type ShotRow = typeof shots.$inferSelect;

// resolvePreviousEpisodeTailFrame 里三次 db.select() 调用的链路深度不一致：
// currentEp / prevEp 是 `select().from().where()` 直接 await（无 orderBy/limit）；
// lastShot 是 `select().from().where().orderBy().limit()`。
// 用一个 FIFO 队列模拟：where() 返回的对象既可直接 await（thenable），
// 也可继续 .orderBy().limit() 链式调用，两者解析到同一个出队值。
const queuedResults: unknown[] = [];
function queueResult(value: unknown) {
  queuedResults.push(value);
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const value = queuedResults.shift() ?? [];
          return {
            then: (
              onFulfilled: (v: unknown) => unknown,
              onRejected?: (e: unknown) => unknown
            ) => Promise.resolve(value).then(onFulfilled, onRejected),
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(value)),
            })),
          };
        }),
      })),
    })),
  },
}));

beforeEach(() => {
  queuedResults.length = 0;
});

const shotFrameUsable = vi.fn<(path: string | null | undefined) => boolean>(() => true);
const resolveChainFramePath = vi.fn(
  (shot: { cutPoint?: string | null; anchorLastAi?: string | null }) =>
    shot.cutPoint ?? shot.anchorLastAi ?? undefined
);

vi.mock("@/lib/storyboard/frame-reference.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storyboard/frame-reference.server")>();
  return {
    ...actual,
    shotFrameUsable: (path: string | null | undefined) => shotFrameUsable(path),
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
    queueResult([{ sequence: 1 }]); // currentEp
    const result = await resolvePreviousEpisodeTailFrame({
      projectId: "proj-1",
      episodeId: "ep-1",
    });
    expect(result).toEqual({});
  });

  it("找不到上一集 → 返回空对象", async () => {
    queueResult([{ sequence: 2 }]); // currentEp
    queueResult([]);                 // prevEp not found
    const result = await resolvePreviousEpisodeTailFrame({
      projectId: "proj-1",
      episodeId: "ep-2",
    });
    expect(result).toEqual({});
  });

  it("上一集最后一镜有 cut_point → 返回路径和 sourceType=cut_point", async () => {
    const lastShot = makeShot({ sequence: 5, cutPoint: "/uploads/cut-5.png" });
    queueResult([{ sequence: 2 }]);   // currentEp
    queueResult([{ id: "ep-1" }]);    // prevEp
    queueResult([lastShot]);          // lastShot
    resolveChainFramePath.mockReturnValueOnce("/uploads/cut-5.png");
    shotFrameUsable.mockReturnValue(true);

    const result = await resolvePreviousEpisodeTailFrame({
      projectId: "proj-1",
      episodeId: "ep-2",
    });
    expect(result.sourceShotId).toBe(lastShot.id);
    expect(result.sourceType).toBe("cut_point");
  });
});
