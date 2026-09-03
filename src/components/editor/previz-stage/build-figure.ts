import * as THREE from "three";
import {
  JOINT_OFFSET,
  JOINT_PARENT,
  LIMB_SEGMENT,
  POSES,
  type JointName,
  type Pose,
} from "@/lib/previz/humanoid";
import type { FigurePose, StageFigure } from "@/lib/previz/stage-types";

/**
 * 把 humanoid.ts 的骨架数据变成 three.js 的对象树。
 *
 * 造型用胶囊体（四肢）+ 圆润的躯干与头 —— 就是美术用的木头人偶那种感觉。
 * 仍然不引任何外部模型资源：零授权问题，场景 JSON 里也不会出现素材路径
 * （`editor_state` 因为内嵌路径给存储脚本留下扫描盲区，这里不重蹈覆辙）。
 *
 * 返回的 Group 原点在**脚底**，正面朝 -Z。`applyPose` 可以在不重建的前提下改姿态，
 * 这样运镜视频里的姿态过渡才不会每帧重建几十个 mesh。
 */

export interface FigureHandle {
  root: THREE.Group;
  joints: Map<JointName, THREE.Object3D>;
  /** 骨盆下方的整体容器，承担 rootY / rootPitch */
  body: THREE.Group;
}

const ALL_JOINTS = Object.keys(JOINT_PARENT) as JointName[];

function capsule(length: number, radius: number, mat: THREE.Material): THREE.Mesh {
  // CapsuleGeometry 的高度参数指的是两个半球之间的柱体长度
  const cyl = Math.max(0.001, length - radius * 2);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, cyl, 4, 12), mat);
  // 关节在段的顶端，段向 -Y 延伸
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  return mesh;
}

export function buildFigure(figure: StageFigure, pose: FigurePose): FigureHandle {
  const H = figure.height;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mat = new THREE.MeshLambertMaterial({ color: figure.color });
  const darkMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(figure.color).multiplyScalar(0.45),
  });

  const joints = new Map<JointName, THREE.Object3D>();
  for (const name of ALL_JOINTS) {
    const node = new THREE.Object3D();
    node.name = name;
    const off = JOINT_OFFSET[name];
    // pelvis 的竖直偏移由 rootY 统一接管（坐/蹲要把骨盆压下来），这里不重复加
    node.position.set(off[0] * H, name === "pelvis" ? 0 : off[1] * H, off[2] * H);
    joints.set(name, node);
  }
  for (const name of ALL_JOINTS) {
    const parent = JOINT_PARENT[name];
    (parent ? joints.get(parent)! : body).add(joints.get(name)!);
  }

  // 四肢
  for (const [name, seg] of Object.entries(LIMB_SEGMENT) as [JointName, { length: number; radius: number }][]) {
    joints.get(name)!.add(capsule(seg.length * H, seg.radius * H, mat));
  }

  // 躯干：骨盆与胸腔各一个压扁的胶囊，中间靠脊柱连起来
  const pelvisMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075 * H, 0.05 * H, 4, 12), mat);
  pelvisMesh.scale.set(1, 1, 0.72);
  pelvisMesh.position.y = 0.02 * H;
  joints.get("pelvis")!.add(pelvisMesh);

  const chestMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.088 * H, 0.10 * H, 4, 14), mat);
  chestMesh.scale.set(1.12, 1, 0.66);
  chestMesh.position.y = 0.035 * H;
  joints.get("chest")!.add(chestMesh);

  const neckMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.026 * H, 0.03 * H, 4, 8), mat);
  joints.get("neck")!.add(neckMesh);

  // 头：略微前后压扁的球 + 一个鼻尖当朝向指示 ——
  // 没有朝向指示的话，人偶朝哪边全靠猜，而朝向是预演的核心信息之一
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.062 * H, 16, 12), mat);
  headMesh.scale.set(0.92, 1.1, 1);
  headMesh.position.y = 0.05 * H;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016 * H, 0.03 * H, 8), darkMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.045 * H, -0.058 * H);
  headMesh.add(nose);
  joints.get("head")!.add(headMesh);

  // 手脚：小方块，够表达末端在哪
  for (const side of ["L", "R"] as const) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.026 * H, 10, 8), mat);
    hand.position.y = -0.145 * H;
    joints.get(`forearm${side}` as JointName)!.add(hand);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.055 * H, 0.03 * H, 0.115 * H), mat);
    foot.position.set(0, -0.24 * H, -0.03 * H);
    joints.get(`shin${side}` as JointName)!.add(foot);
  }

  const handle: FigureHandle = { root, joints, body };
  applyPose(handle, POSES[pose].pose, POSES[pose].rootY, POSES[pose].rootPitch, H);
  return handle;
}

/**
 * 施加一组关节角度。不重建任何 mesh —— 运镜视频里的姿态过渡靠逐帧调这里，
 * 每帧重建几十个 mesh 会直接卡死。
 */
export function applyPose(
  handle: FigureHandle,
  pose: Pose,
  rootY: number,
  rootPitch: number,
  totalHeight: number
): void {
  handle.body.position.y = rootY * totalHeight;
  handle.body.rotation.x = rootPitch;
  for (const name of ALL_JOINTS) {
    const node = handle.joints.get(name);
    if (!node) continue;
    const r = pose[name] ?? [0, 0, 0];
    node.rotation.set(r[0], r[1], r[2]);
  }
}

/** 场景方块 */
export function buildBlock(size: [number, number, number], color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshLambertMaterial({ color })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
