import { describe, it, expect } from "vitest";
import {
  distanceForShotSize,
  shotSizeForDistance,
  fovToFocal,
  focalToFov,
  parseScene,
  parseBlocking,
  emptyScene,
  resolveCameraPose,
  defaultCamera,
  type StageFigure,
} from "@/lib/previz/stage-types";

const H = 1.7; // 成年身高
const FOV = 40;

describe("景别 ↔ 距离换算", () => {
  it("景别越紧，相机越近（单调）", () => {
    const d = (["extremeWide", "wide", "full", "medium", "closeUp", "extremeCloseUp"] as const).map(
      (s) => distanceForShotSize(s, H, FOV)
    );
    for (let i = 1; i < d.length; i++) {
      expect(d[i], `第 ${i} 档应比前一档更近`).toBeLessThan(d[i - 1]);
    }
  });

  it("往返自洽：按景别算出的距离，反推回来还是同一档", () => {
    for (const s of ["extremeWide", "wide", "full", "medium", "closeUp", "extremeCloseUp"] as const) {
      expect(shotSizeForDistance(distanceForShotSize(s, H, FOV), H, FOV)).toBe(s);
    }
  });

  it("同一景别下，主体越高相机越远", () => {
    expect(distanceForShotSize("full", 2.0, FOV)).toBeGreaterThan(
      distanceForShotSize("full", 1.2, FOV)
    );
  });

  it("同一景别下，视场角越大（越广）相机越近", () => {
    expect(distanceForShotSize("medium", H, 60)).toBeLessThan(
      distanceForShotSize("medium", H, 25)
    );
  });

  it("全景的机位距离落在常识范围内（成人 + 40° 视场约 3~5 米）", () => {
    const d = distanceForShotSize("full", H, FOV);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(5);
  });
});

describe("视场角 ↔ 等效焦距", () => {
  it("往返一致（允许取整误差）", () => {
    for (const f of [24, 35, 50, 85]) {
      expect(Math.abs(fovToFocal(focalToFov(f)) - f)).toBeLessThanOrEqual(1);
    }
  });

  it("焦距越长视场角越小", () => {
    expect(focalToFov(85)).toBeLessThan(focalToFov(24));
  });
});

describe("解析容错 —— 打不开导演台比摆位丢失更糟", () => {
  it("空值 / 坏 JSON / 结构不对，一律回落到空场景而不是抛错", () => {
    for (const bad of [null, undefined, "", "{oops", '{"version":1}', "[]"]) {
      expect(parseScene(bad as string | null)).toEqual(emptyScene());
    }
  });

  it("场景里新增的演员会在本镜补一个默认走位，不会凭空消失", () => {
    const figures: StageFigure[] = [
      { id: "a", name: "角色甲", height: 1.7, color: "#888" },
      { id: "b", name: "角色乙", height: 1.6, color: "#999" },
    ];
    const saved = JSON.stringify({
      version: 1,
      camera: { subjectFigureId: "a", azimuthDeg: 0, distance: 3, height: 1.6, targetHeight: 1.2, fov: 40 },
      placements: [{ figureId: "a", x: 0, z: 0, rotY: 0, pose: "stand" }],
    });
    const result = parseBlocking(saved, figures);
    expect(result.placements.map((p) => p.figureId).sort()).toEqual(["a", "b"]);
  });

  it("已从场景里删掉的演员，其走位会被丢弃", () => {
    const figures: StageFigure[] = [{ id: "a", name: "角色甲", height: 1.7, color: "#888" }];
    const saved = JSON.stringify({
      version: 1,
      camera: { subjectFigureId: "a", azimuthDeg: 0, distance: 3, height: 1.6, targetHeight: 1.2, fov: 40 },
      placements: [
        { figureId: "a", x: 0, z: 0, rotY: 0, pose: "stand" },
        { figureId: "ghost", x: 5, z: 5, rotY: 0, pose: "stand" },
      ],
    });
    expect(parseBlocking(saved, figures).placements.map((p) => p.figureId)).toEqual(["a"]);
  });
});

describe("参数化机位 → 绝对位姿", () => {
  const P = (rotY: number) => [{ figureId: "a", x: 0, z: 0, rotY, pose: "stand" as const }];

  it("方位角 0 = 站在主体正前方（主体默认面朝 -Z，相机就在 -Z 侧）", () => {
    const { pos } = resolveCameraPose({ ...defaultCamera("a"), azimuthDeg: 0, distance: 3 }, P(0));
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(-3, 5);
  });

  it("方位角 180 = 绕到主体背后", () => {
    const { pos } = resolveCameraPose({ ...defaultCamera("a"), azimuthDeg: 180, distance: 3 }, P(0));
    expect(pos[2]).toBeCloseTo(3, 5);
  });

  it("主体转身时机位跟着转 —— 方位是相对主体的，不是相对世界的", () => {
    const straight = resolveCameraPose({ ...defaultCamera("a"), azimuthDeg: 0, distance: 3 }, P(0));
    const turned = resolveCameraPose(
      { ...defaultCamera("a"), azimuthDeg: 0, distance: 3 },
      P(Math.PI / 2)
    );
    expect(turned.pos[0]).not.toBeCloseTo(straight.pos[0], 2);
    // 相机始终在主体正前方，距离不变
    expect(Math.hypot(turned.pos[0], turned.pos[2])).toBeCloseTo(3, 5);
  });

  it("主体不存在时回落到原点，不产生 NaN", () => {
    const { pos, target } = resolveCameraPose({ ...defaultCamera("ghost"), distance: 3 }, P(0));
    expect(pos.every(Number.isFinite)).toBe(true);
    expect(target.every(Number.isFinite)).toBe(true);
  });
});
