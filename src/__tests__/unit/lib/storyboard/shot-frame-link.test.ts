import { describe, it, expect, vi, beforeEach } from "vitest";
import type { shots } from "@/lib/db/schema";

type ShotRow = typeof shots.$inferSelect;

const mockLimit = vi.fn();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);

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
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockUpdateWhere,
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

import {
  isCrowdToCharacterCut,
  linkNextShotAnchorFromCutPoint,
} from "@/lib/storyboard/shot-frame-link";

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
    videoScript: partial.videoScript ?? null,
    anchorFirst: partial.anchorFirst ?? null,
    anchorLastAi: partial.anchorLastAi ?? null,
    cutPoint: partial.cutPoint ?? null,
    cameraDirection: "static",
    duration: 10,
    videoUrl: null,
    status: "completed",
  } as ShotRow;
}

const characters = [
  { id: "c1", name: "龙渊", description: "主角" },
  { id: "c2", name: "灵瑶", description: "女主" },
];

describe("isCrowdToCharacterCut", () => {
  it("上一镜群演、下一镜有命名角色 → true", () => {
    const prev = makeShot({ sequence: 1, prompt: "大殿全景，人群涌动" });
    const next = makeShot({ sequence: 2, prompt: "龙渊站在殿中央" });
    expect(isCrowdToCharacterCut(prev, next, characters)).toBe(true);
  });

  it("两镜都有角色 → false", () => {
    const prev = makeShot({ sequence: 1, prompt: "龙渊在门口" });
    const next = makeShot({ sequence: 2, prompt: "灵瑶转身" });
    expect(isCrowdToCharacterCut(prev, next, characters)).toBe(false);
  });

  it("无上一镜 → false", () => {
    const next = makeShot({ sequence: 1, prompt: "龙渊" });
    expect(isCrowdToCharacterCut(null, next, characters)).toBe(false);
  });
});

describe("linkNextShotAnchorFromCutPoint", () => {
  beforeEach(() => {
    mockLimit.mockReset();
    mockUpdateWhere.mockClear();
    shotFrameFileOnDisk.mockReturnValue(true);
    resolveChainFramePath.mockImplementation(
      (shot: { cutPoint?: string | null }) => shot.cutPoint ?? undefined
    );
  });

  it("有效 cut_point 且存在下一镜 → 直拷并 linked", async () => {
    const source = makeShot({ sequence: 1, cutPoint: "/uploads/cut-1.png", prompt: "龙渊站在殿中" });
    const next = makeShot({ sequence: 2, id: "shot-2", prompt: "灵瑶侧身" });
    mockLimit.mockResolvedValueOnce([next]);

    const result = await linkNextShotAnchorFromCutPoint({
      sourceShot: source,
      characters,
    });

    expect(result).toEqual({
      linked: true,
      nextShotId: "shot-2",
      nextSequence: 2,
    });
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it("无 cut_point 文件 → no_valid_cut_point", async () => {
    shotFrameFileOnDisk.mockReturnValue(false);
    const source = makeShot({ sequence: 1, cutPoint: "/missing.png" });

    const result = await linkNextShotAnchorFromCutPoint({
      sourceShot: source,
      characters,
    });

    expect(result).toEqual({ linked: false, reason: "no_valid_cut_point" });
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });

  it("同集最后一镜 → no_next_shot", async () => {
    const source = makeShot({ sequence: 5, cutPoint: "/uploads/cut-5.png" });
    mockLimit.mockResolvedValueOnce([]);

    const result = await linkNextShotAnchorFromCutPoint({
      sourceShot: source,
      characters,
    });

    expect(result).toEqual({ linked: false, reason: "no_next_shot" });
  });

  it("群演→主角 → crowd_to_character_cut", async () => {
    const source = makeShot({ sequence: 1, cutPoint: "/uploads/cut-1.png", prompt: "人群散去" });
    const next = makeShot({ sequence: 2, id: "shot-2", prompt: "龙渊抬头" });
    mockLimit.mockResolvedValueOnce([next]);

    const result = await linkNextShotAnchorFromCutPoint({
      sourceShot: source,
      characters,
    });

    expect(result).toEqual({ linked: false, reason: "crowd_to_character_cut" });
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });
});

