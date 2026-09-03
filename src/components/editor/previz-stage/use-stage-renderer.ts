"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { applyPose, buildBlock, buildFigure, type FigureHandle } from "./build-figure";
import { POSES, lerpPose } from "@/lib/previz/humanoid";
import {
  resolveCameraPose,
  sampleBlocking,
  type PrevizBlocking,
  type PrevizScene,
} from "@/lib/previz/stage-types";

/**
 * 双视口渲染器。
 *
 * 左：编辑视角（可环绕、缩放），能看到整个场景，以及一个表示"正式机位在哪、拍到多少"的相机视锥。
 * 右：相机视图（所见即所得）—— 导出的构图图就是这一格。
 *
 * 用命令式的 three.js 而不是 react-three-fiber：这里每帧都要跟着滑杆重算位姿，
 * 走 React 的 reconciler 反而绕远，而且能少一个依赖。
 */

/** base64 data URL → Blob。toDataURL 是同步的，这一步也就不用等任何回调。 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export interface StageRendererHandle {
  /** 把相机视图渲染成 PNG blob（导出构图参考图用） */
  captureCameraView: (width: number, height: number) => Promise<Blob | null>;
  /** 射线拾取：返回该屏幕坐标下的演员 id */
  pickFigure: (clientX: number, clientY: number) => string | null;
  /** 把屏幕坐标投影到地面 y=0 上，返回世界坐标（拖动走位用） */
  projectToGround: (clientX: number, clientY: number) => { x: number; z: number } | null;
  /**
   * 按关键帧走一遍时间线，逐帧渲染相机视图，返回 JPEG 序列。
   *
   * ⚠️ 一开始用的是 `canvas.captureStream()` + MediaRecorder，实测在 WebGL canvas 上
   * 只录出 110 字节的空 webm —— 一帧都没抓到。与其去猜浏览器什么时候认为 canvas
   * "脏了"，不如逐帧渲染再截图：
   *  - **帧数严格等于 fps × 时长**，不依赖实时渲染跟不跟得上
   *  - 渲染慢一点也只是导出久一点，不会丢帧或时长漂移
   *  - 编码交给服务端 ffmpeg（那条路径本来就在），顺带继承「禁 B 帧」那条教训
   */
  renderFrames: (
    durationSec: number,
    fps: number,
    width: number,
    height: number,
    onProgress?: (done: number, total: number) => void
  ) => Promise<Blob[]>;
  /** 预览播放：把场面推到某个时刻（不录制） */
  seek: (t: number | null) => void;
}

interface Params {
  scene: PrevizScene;
  blocking: PrevizBlocking;
  aspect: number;
  selectedFigureId: string | null;
}

export function useStageRenderer(
  editorEl: React.RefObject<HTMLDivElement | null>,
  cameraEl: React.RefObject<HTMLDivElement | null>,
  params: Params
) {
  const handleRef = useRef<StageRendererHandle | null>(null);
  // 每帧要读最新的 params，但渲染循环只建一次 —— 用 ref 传递，避免重建整个场景
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const refs = useRef<{
    renderer?: THREE.WebGLRenderer;
    camRenderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    editorCam?: THREE.PerspectiveCamera;
    shotCam?: THREE.PerspectiveCamera;
    frustum?: THREE.CameraHelper;
    figureGroup?: THREE.Group;
    blockGroup?: THREE.Group;
    /** 编辑视角的球坐标 */
    orbit: { theta: number; phi: number; radius: number; target: THREE.Vector3 };
    figureMeshes: Map<string, FigureHandle>;
    raf?: number;
    /** 非 null 时，渲染循环按这个时刻采样关键帧，而不是用编辑态 */
    playTime: number | null;
  }>({
    playTime: null,
    orbit: { theta: Math.PI * 0.25, phi: Math.PI * 0.35, radius: 9, target: new THREE.Vector3(0, 1, 0) },
    figureMeshes: new Map(),
  });

  // ── 初始化：只建一次 ────────────────────────────────────────────────────
  useEffect(() => {
    const editorHost = editorEl.current;
    const cameraHost = cameraEl.current;
    if (!editorHost || !cameraHost) return;

    const scene = new THREE.Scene();
    // 中性灰而不是深色：导出的构图图是要给人和模型看的「布局」，
    // 深背景会被读成"夜景/黑天"，把本该只表达空间关系的图带上了不存在的氛围。
    scene.background = new THREE.Color(0xd6d7db);

    // 光只为了让盒子有体积感，不表达任何叙事布光 —— 布光是 Seedance 的活
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(4, 8, 5);
    scene.add(key);

    const grid = new THREE.GridHelper(40, 40, 0x9a9ba3, 0xc0c1c7);
    scene.add(grid);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ color: 0xcacbd1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001; // 压在网格下面，避免 z-fighting
    scene.add(ground);

    const blockGroup = new THREE.Group();
    const figureGroup = new THREE.Group();
    scene.add(blockGroup, figureGroup);

    const editorCam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const shotCam = new THREE.PerspectiveCamera(40, params.aspect, 0.05, 200);
    const frustum = new THREE.CameraHelper(shotCam);
    scene.add(frustum);

    // ⚠️ 下面的 setSize(w, h, false) 刻意不让 three 改 canvas 的 CSS 尺寸
    //（每帧改 style 会触发布局抖动），代价是必须在这里一次性把 CSS 尺寸钉成 100%。
    // 少了这两行，canvas 会按像素属性撑成自己的尺寸并溢出容器 —— 表现为面板错位。
    function fitCanvas(el: HTMLCanvasElement) {
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.display = "block";
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    fitCanvas(renderer.domElement);
    editorHost.appendChild(renderer.domElement);

    const camRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    camRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    fitCanvas(camRenderer.domElement);
    cameraHost.appendChild(camRenderer.domElement);

    Object.assign(refs.current, {
      renderer, camRenderer, scene, editorCam, shotCam, frustum, figureGroup, blockGroup,
    });

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function ndc(clientX: number, clientY: number) {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1
      );
    }

    handleRef.current = {
      pickFigure(clientX, clientY) {
        raycaster.setFromCamera(ndc(clientX, clientY), editorCam);
        const hits = raycaster.intersectObjects(figureGroup.children, true);
        if (!hits.length) return null;
        // 命中的是身体部件，往上找到挂着 figureId 的那层
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData.figureId) obj = obj.parent;
        return (obj?.userData.figureId as string) ?? null;
      },
      projectToGround(clientX, clientY) {
        raycaster.setFromCamera(ndc(clientX, clientY), editorCam);
        const point = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(groundPlane, point)) return null;
        return { x: point.x, z: point.z };
      },
      seek(t) {
        refs.current.playTime = t;
      },
      async renderFrames(durationSec, fps, width, height, onProgress) {
        const total = Math.max(1, Math.round(durationSec * fps));
        const prevSize = camRenderer.getSize(new THREE.Vector2());
        const prevRatio = camRenderer.getPixelRatio();
        // 导出时把像素比钉成 1：否则在 2x 屏上会渲成 1708×960，
        // 和我们写进 DB 的「480p」对不上，文件也白白大一倍
        camRenderer.setPixelRatio(1);
        camRenderer.setSize(width, height, false);
        shotCam.aspect = width / height;
        frustum.visible = false;
        const frames: Blob[] = [];
        try {
          for (let i = 0; i < total; i++) {
            const t = (i / fps);
            updateScene(paramsRef.current, Math.min(t, durationSec));
            shotCam.aspect = width / height;
            shotCam.updateProjectionMatrix();
            camRenderer.render(scene, shotCam);
            // ⚠️ 用同步的 toDataURL 而不是 toBlob：toBlob 要等一个合成帧才回调，
            // 而标签页被遮挡时浏览器会把合成/定时器节流到 1Hz —— 实测每帧要 1 秒，
            // 84 帧就是一分半。toDataURL 是同步的，完全不受这个调度影响。
            frames.push(dataUrlToBlob(camRenderer.domElement.toDataURL("image/jpeg", 0.85)));
            onProgress?.(i + 1, total);
            // 每隔一批让出主线程，否则长镜头导出期间界面完全僵住
            if (i % 12 === 11) await new Promise((r) => setTimeout(r, 0));
          }
        } finally {
          camRenderer.setPixelRatio(prevRatio);
          camRenderer.setSize(prevSize.x, prevSize.y, false);
          frustum.visible = true;
          refs.current.playTime = null;
        }
        return frames;
      },
      async captureCameraView(width, height) {
        // 用离屏尺寸重渲一帧再截图，导出分辨率就不受面板大小影响
        const prev = camRenderer.getSize(new THREE.Vector2());
        camRenderer.setSize(width, height, false);
        shotCam.aspect = width / height;
        shotCam.updateProjectionMatrix();
        frustum.visible = false;
        camRenderer.render(scene, shotCam);
        const blob = await new Promise<Blob | null>((resolve) =>
          camRenderer.domElement.toBlob((b) => resolve(b), "image/png")
        );
        frustum.visible = true;
        camRenderer.setSize(prev.x, prev.y, false);
        return blob;
      },
    };

    /**
     * 把场面推到某个时刻（t=null 表示用编辑态）。
     * 抽出来是因为逐帧导出要在 rAF 之外同步调用它。
     */
    function updateScene(p: Params, t: number | null) {
      const sampled = t === null ? null : sampleBlocking(p.blocking, t);
      if (sampled) {
        for (const pl of sampled.placements) {
          const handle = refs.current.figureMeshes.get(pl.figureId);
          const figure = p.scene.figures.find((f) => f.id === pl.figureId);
          if (!handle || !figure) continue;
          handle.root.position.set(pl.x, 0, pl.z);
          handle.root.rotation.y = pl.rotY;
          const blended = lerpPose(pl.pose, pl.poseTo, pl.poseBlend);
          applyPose(handle, blended.pose, blended.rootY, blended.rootPitch, figure.height);
        }
      }
      const activeCam = sampled ? sampled.camera : p.blocking.camera;
      const activePlacements = sampled ? sampled.placements : p.blocking.placements;
      const pose = resolveCameraPose(activeCam, activePlacements);
      shotCam.position.set(...pose.pos);
      shotCam.lookAt(...pose.target);
      shotCam.fov = activeCam.fov;
      shotCam.updateProjectionMatrix();
    }

    let disposed = false;
    // effect 顶部已经判过非空；提成常量是为了让 TS 在渲染循环的闭包里也能保住收窄
    const eHost = editorHost;
    const cHost = cameraHost;
    function frame() {
      if (disposed) return;
      refs.current.raf = requestAnimationFrame(frame);
      const p = paramsRef.current;

      // 编辑相机：球坐标环绕
      const o = refs.current.orbit;
      editorCam.position.set(
        o.target.x + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
        o.target.y + o.radius * Math.cos(o.phi),
        o.target.z + o.radius * Math.sin(o.phi) * Math.cos(o.theta)
      );
      editorCam.lookAt(o.target);

      // 播放/录制时按时间线采样，否则用编辑态
      updateScene(p, refs.current.playTime);
      shotCam.aspect = p.aspect;
      shotCam.updateProjectionMatrix();
      frustum.update();

      const ew = eHost.clientWidth, eh = eHost.clientHeight;
      if (ew && eh) {
        renderer.setSize(ew, eh, false);
        editorCam.aspect = ew / eh;
        editorCam.updateProjectionMatrix();
        frustum.visible = true;
        renderer.render(scene, editorCam);
      }
      const cw = cHost.clientWidth, ch = cHost.clientHeight;
      if (cw && ch) {
        camRenderer.setSize(cw, ch, false);
        // 相机视图里不该看到自己的视锥线框
        frustum.visible = false;
        camRenderer.render(scene, shotCam);
      }
    }
    frame();

    return () => {
      disposed = true;
      if (refs.current.raf) cancelAnimationFrame(refs.current.raf);
      renderer.dispose();
      camRenderer.dispose();
      renderer.domElement.remove();
      camRenderer.domElement.remove();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
    };
    // 只建一次：场景内容的变化走下面的 diff effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 场景内容同步（方块） ────────────────────────────────────────────────
  useEffect(() => {
    const g = refs.current.blockGroup;
    if (!g) return;
    g.clear();
    for (const b of params.scene.blocks) {
      const mesh = buildBlock(b.size, b.color);
      mesh.position.set(...b.pos);
      mesh.rotation.y = b.rotY;
      g.add(mesh);
    }
  }, [params.scene.blocks]);

  // ── 演员同步（身形变了要重建，位置/朝向只更新 transform） ───────────────
  useEffect(() => {
    const g = refs.current.figureGroup;
    if (!g) return;
    g.clear();
    refs.current.figureMeshes.clear();
    for (const f of params.scene.figures) {
      const pl = params.blocking.placements.find((p) => p.figureId === f.id);
      const handle = buildFigure(f, pl?.pose ?? "stand");
      handle.root.userData.figureId = f.id;
      g.add(handle.root);
      refs.current.figureMeshes.set(f.id, handle);
    }
  }, [params.scene.figures, params.blocking.placements]);

  // 位置/朝向每帧从 params 读会更顺，但重建代价低且姿态变化必须重建，
  // 所以这里统一在 placements 变化时同步一次 transform
  useEffect(() => {
    for (const pl of params.blocking.placements) {
      const handle = refs.current.figureMeshes.get(pl.figureId);
      if (!handle) continue;
      handle.root.position.set(pl.x, 0, pl.z);
      handle.root.rotation.y = pl.rotY;
      // 姿态改成调关节角度，不重建 mesh —— 重建几十个 mesh 会让拖滑杆变卡
      const figure = params.scene.figures.find((f) => f.id === pl.figureId);
      const p = POSES[pl.pose];
      if (figure) applyPose(handle, p.pose, p.rootY, p.rootPitch, figure.height);
    }
  }, [params.blocking.placements]);

  // 选中高亮：给选中的人偶加一圈地面指示环
  useEffect(() => {
    for (const [id, handle] of refs.current.figureMeshes) {
      const existing = handle.root.getObjectByName("__sel");
      if (existing) handle.root.remove(existing);
      if (id !== params.selectedFigureId) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.36, 32),
        new THREE.MeshBasicMaterial({ color: 0xff5a3c, side: THREE.DoubleSide })
      );
      ring.name = "__sel";
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      handle.root.add(ring);
    }
  }, [params.selectedFigureId, params.scene.figures, params.blocking.placements]);

  return { handle: handleRef, orbit: refs.current.orbit };
}
