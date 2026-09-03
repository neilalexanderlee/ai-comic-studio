import * as THREE from "three";
import type { FigurePose, StageFigure } from "@/lib/previz/stage-types";

/**
 * 盒体人偶。
 *
 * 刻意只用盒子拼，不引任何外部模型资源：
 *  - 零资源、零授权问题、零加载等待，场景 JSON 里也就不会出现素材路径
 *    （`editor_state` 因为内嵌路径给存储脚本留下扫描盲区，这里不重蹈覆辙）
 *  - 预演要判断的是"人在哪、朝哪、什么姿态"，长相是干扰项 ——
 *    白模预演那张 clay render 已经证明「丑但结构清楚」完全够用
 *
 * 比例按 7 头身近似，以身高为单位缩放，所以儿童（1.2m）和成人（1.7m）
 * 在画面里的比例关系是对的，景别换算才有意义。
 */

/** 各姿态下，人偶的实际视觉高度相对站立身高的比例 */
const POSE_HEIGHT_RATIO: Record<FigurePose, number> = {
  stand: 1,
  run: 0.95,
  sit: 0.62,
  crouch: 0.55,
  lie: 0.28,
};

/** 该姿态下眼睛离地的高度（米）—— 相机看向人时的默认落点 */
export function eyeHeight(figure: StageFigure, pose: FigurePose): number {
  return figure.height * POSE_HEIGHT_RATIO[pose] * 0.93;
}

/** 该姿态下胸口离地的高度（米） */
export function chestHeight(figure: StageFigure, pose: FigurePose): number {
  return figure.height * POSE_HEIGHT_RATIO[pose] * 0.72;
}

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

/**
 * 造一个人偶。返回的 Group 原点在**脚底**，方便直接摆到地面上。
 * 正面朝 -Z（与相机默认看向的方向一致）。
 */
export function buildFigure(figure: StageFigure, pose: FigurePose): THREE.Group {
  const g = new THREE.Group();
  const H = figure.height;
  const mat = new THREE.MeshLambertMaterial({ color: figure.color });
  // 正面标记用更深的颜色 —— 光靠盒子形状看不出人朝哪边，而朝向是预演的核心信息之一
  const faceMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

  const headR = H * 0.07;
  const torsoH = H * 0.30;
  const legH = H * 0.45;
  const shoulderW = H * 0.20;

  const legs = box(shoulderW * 0.8, legH, H * 0.09, mat);
  const torso = box(shoulderW, torsoH, H * 0.11, mat);
  const head = box(headR * 2, headR * 2.2, headR * 2, mat);
  const nose = box(headR * 0.5, headR * 0.5, headR * 0.6, faceMat);
  const armL = box(H * 0.05, H * 0.28, H * 0.05, mat);
  const armR = armL.clone();

  if (pose === "stand" || pose === "run") {
    legs.position.y = legH / 2;
    torso.position.y = legH + torsoH / 2;
    head.position.y = legH + torsoH + headR * 1.1;
    armL.position.set(-shoulderW / 2 - H * 0.03, legH + torsoH * 0.75, 0);
    armR.position.set(shoulderW / 2 + H * 0.03, legH + torsoH * 0.75, 0);
    if (pose === "run") {
      // 跑姿：一腿前一腿后靠整体前倾表达，不做骨骼 —— 预演只需要看出"在移动"
      legs.rotation.x = 0.35;
      torso.rotation.x = -0.25;
      armL.rotation.x = -0.8;
      armR.rotation.x = 0.8;
    }
  } else if (pose === "sit") {
    const seatH = H * 0.26;
    legs.scale.y = 0.55;
    legs.position.set(0, seatH * 0.55, -H * 0.10);
    legs.rotation.x = Math.PI / 2.2;
    torso.position.y = seatH + torsoH / 2;
    head.position.y = seatH + torsoH + headR * 1.1;
    armL.position.set(-shoulderW / 2 - H * 0.03, seatH + torsoH * 0.6, 0);
    armR.position.set(shoulderW / 2 + H * 0.03, seatH + torsoH * 0.6, 0);
    armL.rotation.x = armR.rotation.x = 0.9;
  } else if (pose === "crouch") {
    const hipH = H * 0.20;
    legs.scale.y = 0.5;
    legs.position.y = hipH * 0.5;
    torso.position.y = hipH + torsoH * 0.45;
    torso.rotation.x = 0.3;
    head.position.set(0, hipH + torsoH * 0.85 + headR, -H * 0.04);
    armL.position.set(-shoulderW / 2, hipH + torsoH * 0.4, 0);
    armR.position.set(shoulderW / 2, hipH + torsoH * 0.4, 0);
  } else {
    // lie：整体放倒，沿 -Z 方向躺
    legs.rotation.x = Math.PI / 2;
    legs.position.set(0, H * 0.06, legH / 2);
    torso.rotation.x = Math.PI / 2;
    torso.position.set(0, H * 0.06, -torsoH / 2);
    head.position.set(0, H * 0.06, -torsoH - headR);
    armL.position.set(-shoulderW / 2, H * 0.06, -torsoH * 0.4);
    armR.position.set(shoulderW / 2, H * 0.06, -torsoH * 0.4);
    armL.rotation.x = armR.rotation.x = Math.PI / 2;
  }

  // 鼻子挂在头上，随头一起动，作为朝向指示
  nose.position.set(0, 0, -headR - headR * 0.3);
  head.add(nose);

  for (const part of [legs, torso, head, armL, armR]) {
    part.castShadow = true;
    g.add(part);
  }
  return g;
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
