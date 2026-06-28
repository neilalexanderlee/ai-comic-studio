/**
 * Unit tests: groupShotsIntoTracks / buildShotTrackMap
 *
 * 覆盖点：
 * 1. 基本分组（累计时长 ≤ 15s）
 * 2. 时长恰好等于上限 — 仍在同一组
 * 3. 超出上限 → 新开一组
 * 4. 单镜超出上限 → 独立成组
 * 5. 场景边界（sceneId 变化）→ 强制切断
 * 6. 无 sceneId 的镜头不触发场景切断
 * 7. buildShotTrackMap 正确生成 shotId → trackId 映射
 * 8. 空列表 → 空结果
 * 9. 自定义 maxDuration
 * 10. trackId 顺序 T1、T2、T3…
 */

import { describe, it, expect } from "vitest";
import { groupShotsIntoTracks, buildShotTrackMap, MAX_TRACK_DURATION } from "@/lib/storyboard/track-grouping";

type ShotInput = { id: string; sequence: number; duration: number; sceneId?: string | null };

function makeShots(specs: Array<{ d: number; s?: string }>): ShotInput[] {
  return specs.map((spec, i) => ({
    id: `shot_${i + 1}`,
    sequence: i + 1,
    duration: spec.d,
    sceneId: spec.s ?? null,
  }));
}

// ── 1. 基本分组 ─────────────────────────────────────────────────────────────

describe("基本时长分组", () => {
  it("所有镜头时长之和 ≤ 15s → 归为一组", () => {
    const shots = makeShots([{ d: 5 }, { d: 5 }, { d: 5 }]);
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(1);
    expect(groups[0].shots).toHaveLength(3);
    expect(groups[0].totalDuration).toBe(15);
    expect(groups[0].trackId).toBe("T1");
  });

  it("恰好等于上限时仍在同一组（边界包含）", () => {
    const shots = makeShots([{ d: 7 }, { d: 8 }]);
    const groups = groupShotsIntoTracks(shots, 15);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalDuration).toBe(15);
  });

  it("超出上限 → 拆分为两组", () => {
    const shots = makeShots([{ d: 8 }, { d: 8 }, { d: 5 }]);
    // 第1镜(8) + 第2镜(8) = 16 > 15 → 第2镜开新组；第3镜(5) 和第2镜同组 (8+5=13)
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(2);
    expect(groups[0].shots.map((s) => s.id)).toEqual(["shot_1"]);
    expect(groups[1].shots.map((s) => s.id)).toEqual(["shot_2", "shot_3"]);
  });

  it("每组 trackId 按 T1、T2、T3 顺序递增", () => {
    const shots = makeShots([{ d: 10 }, { d: 10 }, { d: 10 }]);
    const groups = groupShotsIntoTracks(shots);
    expect(groups.map((g) => g.trackId)).toEqual(["T1", "T2", "T3"]);
  });
});

// ── 2. 单镜超限 ─────────────────────────────────────────────────────────────

describe("单镜超过 maxDuration", () => {
  it("单镜 > 15s → 独立成组，totalDuration 准确", () => {
    const shots = makeShots([{ d: 20 }]);
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalDuration).toBe(20);
    expect(groups[0].shots).toHaveLength(1);
  });

  it("超限单镜夹在正常镜头之间 — 各自独立", () => {
    const shots = makeShots([{ d: 5 }, { d: 20 }, { d: 5 }]);
    // shot1(5) + shot2(20)>15 → 切断; shot2 独立; shot3(5) 开新组
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(3);
    expect(groups[1].shots[0].id).toBe("shot_2");
    expect(groups[1].totalDuration).toBe(20);
  });
});

// ── 3. 场景边界切断 ──────────────────────────────────────────────────────────

describe("场景边界（sceneId 变化）→ 强制切断", () => {
  it("sceneId 变化 → 开新 Track（即使时长未超限）", () => {
    const shots = makeShots([
      { d: 3, s: "scene_A" },
      { d: 3, s: "scene_A" },
      { d: 3, s: "scene_B" }, // 场景变化
      { d: 3, s: "scene_B" },
    ]);
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(2);
    expect(groups[0].shots.every((s) => s.sceneId === "scene_A")).toBe(true);
    expect(groups[1].shots.every((s) => s.sceneId === "scene_B")).toBe(true);
  });

  it("三个场景 → 三组（忽略时长）", () => {
    const shots = makeShots([
      { d: 2, s: "A" },
      { d: 2, s: "B" },
      { d: 2, s: "C" },
    ]);
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.trackId)).toEqual(["T1", "T2", "T3"]);
  });
});

// ── 4. null sceneId 不触发切断 ──────────────────────────────────────────────

describe("sceneId 为 null / undefined 不触发场景切断", () => {
  it("全部 null sceneId — 只按时长分组", () => {
    const shots = makeShots([{ d: 5 }, { d: 5 }, { d: 5 }]);
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(1);
  });

  it("null sceneId 夹在有 sceneId 的镜头之间不触发切断", () => {
    const shots = makeShots([
      { d: 3, s: "A" },
      { d: 3 },           // sceneId 未设置 — 不触发切断
      { d: 3, s: "A" },
    ]);
    // sceneId=null 的镜头不应强制切断（规则：两者都非 null 且不同才切）
    const groups = groupShotsIntoTracks(shots);
    // 总时长 9s < 15s，场景无强制切断 → 1 组
    expect(groups).toHaveLength(1);
  });
});

// ── 5. buildShotTrackMap ────────────────────────────────────────────────────

describe("buildShotTrackMap", () => {
  it("正确建立 shotId → trackId 映射", () => {
    const shots = makeShots([{ d: 10 }, { d: 10 }, { d: 10 }]);
    const groups = groupShotsIntoTracks(shots);
    const map = buildShotTrackMap(groups);

    expect(map.get("shot_1")).toBe("T1");
    expect(map.get("shot_2")).toBe("T2");
    expect(map.get("shot_3")).toBe("T3");
  });

  it("同组多镜头都映射到同一 trackId", () => {
    const shots = makeShots([{ d: 5 }, { d: 5 }, { d: 5 }]);
    const groups = groupShotsIntoTracks(shots);
    const map = buildShotTrackMap(groups);

    expect(map.get("shot_1")).toBe("T1");
    expect(map.get("shot_2")).toBe("T1");
    expect(map.get("shot_3")).toBe("T1");
  });

  it("空列表 → 空 Map", () => {
    const map = buildShotTrackMap([]);
    expect(map.size).toBe(0);
  });
});

// ── 6. 边界情况 ─────────────────────────────────────────────────────────────

describe("边界情况", () => {
  it("空镜头列表 → 空结果", () => {
    expect(groupShotsIntoTracks([])).toEqual([]);
  });

  it("单镜头 → 一组", () => {
    const shots = makeShots([{ d: 7 }]);
    const groups = groupShotsIntoTracks(shots);
    expect(groups).toHaveLength(1);
    expect(groups[0].trackId).toBe("T1");
  });

  it("自定义 maxDuration 参数生效", () => {
    const shots = makeShots([{ d: 3 }, { d: 3 }, { d: 3 }]);
    // maxDuration=5: shot1(3)+shot2(3)=6>5 → 切断
    const groups = groupShotsIntoTracks(shots, 5);
    expect(groups).toHaveLength(3);
  });

  it("MAX_TRACK_DURATION 常量值为 15", () => {
    expect(MAX_TRACK_DURATION).toBe(15);
  });
});
