/**
 * 人形代理的骨架与姿态。
 *
 * ## 为什么是骨骼层级，而不是摆一堆盒子
 *
 * 第一版用互不相干的盒子拼人形，姿态靠硬写每个部件的位置 —— 丑，而且**姿态之间没法过渡**：
 * 「站」和「蹲」是两组毫无关系的坐标。改成关节角度之后：
 *  - 造型能用胶囊体做出有肉感的四肢，比方块像人得多
 *  - 姿态就是一组关节角度，**两组角度之间可以线性插值** —— 这是运镜视频里
 *    「站起来」「蹲下去」能平滑演出来的前提，也是 P3 的地基
 *
 * 比例按 7.5 头身，全部以身高 H 为单位，所以儿童（1.2m）和成人（1.7m）
 * 在画面里的比例关系是对的，景别换算才成立。
 *
 * 这个文件是纯数据 + 纯函数，不 import three —— 单测可以直接跑，
 * 渲染层（build-figure.ts）负责把它变成 Object3D。
 */

/** 关节名。层级见 JOINT_PARENT。 */
export type JointName =
  | "pelvis" | "spine" | "chest" | "neck" | "head"
  | "shoulderL" | "upperArmL" | "forearmL"
  | "shoulderR" | "upperArmR" | "forearmR"
  | "hipL" | "thighL" | "shinL"
  | "hipR" | "thighR" | "shinR";

export const JOINT_PARENT: Record<JointName, JointName | null> = {
  pelvis: null,
  spine: "pelvis",
  chest: "spine",
  neck: "chest",
  head: "neck",
  shoulderL: "chest", upperArmL: "shoulderL", forearmL: "upperArmL",
  shoulderR: "chest", upperArmR: "shoulderR", forearmR: "upperArmR",
  hipL: "pelvis", thighL: "hipL", shinL: "thighL",
  hipR: "pelvis", thighR: "hipR", shinR: "thighR",
};

/** 关节相对父关节的静止偏移，单位为身高 H 的比例 */
export const JOINT_OFFSET: Record<JointName, [number, number, number]> = {
  pelvis: [0, 0.50, 0],
  spine: [0, 0.06, 0],
  chest: [0, 0.10, 0],
  neck: [0, 0.13, 0],
  head: [0, 0.055, 0],
  shoulderL: [-0.085, 0.10, 0], upperArmL: [-0.035, 0, 0], forearmL: [0, -0.155, 0],
  shoulderR: [0.085, 0.10, 0], upperArmR: [0.035, 0, 0], forearmR: [0, -0.155, 0],
  hipL: [-0.048, -0.02, 0], thighL: [0, 0, 0], shinL: [0, -0.235, 0],
  hipR: [0.048, -0.02, 0], thighR: [0, 0, 0], shinR: [0, -0.235, 0],
};

/** 挂在某个关节上的肢体段：胶囊的长度与半径（同样按 H 的比例），向 -Y 延伸 */
export const LIMB_SEGMENT: Partial<Record<JointName, { length: number; radius: number }>> = {
  upperArmL: { length: 0.155, radius: 0.028 },
  forearmL: { length: 0.145, radius: 0.024 },
  upperArmR: { length: 0.155, radius: 0.028 },
  forearmR: { length: 0.145, radius: 0.024 },
  thighL: { length: 0.235, radius: 0.042 },
  shinL: { length: 0.225, radius: 0.034 },
  thighR: { length: 0.235, radius: 0.042 },
  shinR: { length: 0.225, radius: 0.034 },
};

/** 每个关节的欧拉角（弧度），只写非零项 */
export type Pose = Partial<Record<JointName, [number, number, number]>>;

export type FigurePose = "stand" | "sit" | "crouch" | "lie" | "run";

const D = Math.PI / 180;

/**
 * 姿态库。
 *
 * 只做粗分类：预演要判断的是"站着还是坐着、朝哪、在哪"，不是表演。
 * 每个姿态额外带一个 `rootY`（骨盆离地高度相对 H 的比例）和 `rootPitch`（整体前倾/放倒），
 * 因为蹲和坐必须把骨盆压下来，光靠关节角度会让人悬空。
 */
export const POSES: Record<FigurePose, { pose: Pose; rootY: number; rootPitch: number }> = {
  stand: {
    rootY: 0.50, rootPitch: 0,
    pose: {
      upperArmL: [6 * D, 0, 7 * D], forearmL: [10 * D, 0, 0],
      upperArmR: [6 * D, 0, -7 * D], forearmR: [10 * D, 0, 0],
    },
  },
  run: {
    rootY: 0.49, rootPitch: 10 * D,
    pose: {
      thighL: [-38 * D, 0, 0], shinL: [42 * D, 0, 0],
      thighR: [30 * D, 0, 0], shinR: [55 * D, 0, 0],
      upperArmL: [-55 * D, 0, 8 * D], forearmL: [75 * D, 0, 0],
      upperArmR: [50 * D, 0, -8 * D], forearmR: [70 * D, 0, 0],
      spine: [6 * D, 0, 0],
    },
  },
  sit: {
    rootY: 0.27, rootPitch: 0,
    pose: {
      thighL: [-88 * D, 0, 3 * D], shinL: [85 * D, 0, 0],
      thighR: [-88 * D, 0, -3 * D], shinR: [85 * D, 0, 0],
      upperArmL: [-18 * D, 0, 10 * D], forearmL: [35 * D, 0, 0],
      upperArmR: [-18 * D, 0, -10 * D], forearmR: [35 * D, 0, 0],
      spine: [4 * D, 0, 0],
    },
  },
  crouch: {
    rootY: 0.24, rootPitch: 22 * D,
    pose: {
      thighL: [-105 * D, 0, 8 * D], shinL: [115 * D, 0, 0],
      thighR: [-105 * D, 0, -8 * D], shinR: [115 * D, 0, 0],
      upperArmL: [-30 * D, 0, 12 * D], forearmL: [55 * D, 0, 0],
      upperArmR: [-30 * D, 0, -12 * D], forearmR: [55 * D, 0, 0],
      spine: [10 * D, 0, 0], chest: [8 * D, 0, 0],
    },
  },
  lie: {
    // 整体放倒：rootPitch -90°，骨盆贴地
    rootY: 0.055, rootPitch: -88 * D,
    pose: {
      upperArmL: [0, 0, 22 * D], upperArmR: [0, 0, -22 * D],
      thighL: [-6 * D, 0, 5 * D], thighR: [-6 * D, 0, -5 * D],
      spine: [4 * D, 0, 0],
    },
  },
};

const ALL_JOINTS = Object.keys(JOINT_PARENT) as JointName[];

/** 姿态插值。两组关节角度逐分量线性插值 —— 这是"站起来/蹲下去"能平滑演出来的关键。 */
export function lerpPose(a: FigurePose, b: FigurePose, t: number): {
  pose: Pose; rootY: number; rootPitch: number;
} {
  const A = POSES[a], B = POSES[b];
  const k = Math.min(1, Math.max(0, t));
  const pose: Pose = {};
  for (const j of ALL_JOINTS) {
    const pa = A.pose[j] ?? [0, 0, 0];
    const pb = B.pose[j] ?? [0, 0, 0];
    if (pa[0] === 0 && pa[1] === 0 && pa[2] === 0 && pb[0] === 0 && pb[1] === 0 && pb[2] === 0) continue;
    pose[j] = [
      pa[0] + (pb[0] - pa[0]) * k,
      pa[1] + (pb[1] - pa[1]) * k,
      pa[2] + (pb[2] - pa[2]) * k,
    ];
  }
  return {
    pose,
    rootY: A.rootY + (B.rootY - A.rootY) * k,
    rootPitch: A.rootPitch + (B.rootPitch - A.rootPitch) * k,
  };
}

/** 该姿态下眼睛离地高度（米）—— 相机默认落点、以及「平视/俯拍/仰拍」的判据 */
export function eyeHeight(totalHeight: number, pose: FigurePose): number {
  const p = POSES[pose];
  // 骨盆 → 脊柱 → 胸 → 颈 → 头，竖直方向的静止偏移之和，再按整体前倾折算
  const stack = JOINT_OFFSET.spine[1] + JOINT_OFFSET.chest[1] + JOINT_OFFSET.neck[1] + JOINT_OFFSET.head[1];
  return totalHeight * (p.rootY + stack * Math.cos(p.rootPitch));
}

/** 该姿态下胸口离地高度（米） */
export function chestHeight(totalHeight: number, pose: FigurePose): number {
  const stack = JOINT_OFFSET.spine[1] + JOINT_OFFSET.chest[1];
  return totalHeight * (POSES[pose].rootY + stack * Math.cos(POSES[pose].rootPitch));
}
