/**
 * 3D 导演台的数据模型。
 *
 * 分两层，对应剧组的分工：
 *  - **场景**（`episodes.previz_scene`，一集一份）：景搭在哪、有哪些演员、各自多高
 *  - **走位与机位**（`shots.previz_blocking`，每镜一份）：这一镜谁站哪、朝哪、相机在哪
 *
 * 单位一律是**米**，Y 轴向上，地面在 y=0。用真实尺度而不是任意单位，是为了让
 * 「摄影机在角色正前方 1.5 米、镜头高度胸口」这类描述能被确定性地算出来 ——
 * 那正是 startFrameDesc 第一要素要求的格式（见 CLAUDE.md 约定 14）。
 */

/** 场景里的一个方块：地形、墙、掩体、道具体块。只有尺寸和位置，没有材质。 */
export interface StageBlock {
  id: string;
  /** 中心点（米）。y 是方块中心离地高度。 */
  pos: [number, number, number];
  /** 长宽高（米） */
  size: [number, number, number];
  /** 绕 Y 轴旋转（弧度） */
  rotY: number;
  /** 仅用于在编辑视图里区分体块，不影响任何生成 */
  color: string;
  label?: string;
}

/** 一个演员代理。盒体人偶：只表达身高、朝向、大致姿态，不表达长相。 */
export interface StageFigure {
  id: string;
  /** 关联到 characters.id；群演可为空 */
  characterId?: string | null;
  name: string;
  /** 身高（米）。默认成年 1.7，儿童 1.2 —— 身高直接决定景别换算。 */
  height: number;
  color: string;
}

/** 一集共用的场景 */
export interface PrevizScene {
  version: 1;
  blocks: StageBlock[];
  figures: StageFigure[];
}

/** 演员在某一镜里的姿态。只做粗分类 —— 预演要的是"站着还是坐着"，不是骨骼动画。 */
export type FigurePose = "stand" | "sit" | "crouch" | "lie" | "run";

export interface FigurePlacement {
  figureId: string;
  /** 脚底在地面的位置（米），y 恒为 0，所以只存 x/z */
  x: number;
  z: number;
  /** 面朝方向，绕 Y 轴弧度。0 = 面朝 -Z（画面纵深方向） */
  rotY: number;
  pose: FigurePose;
}

/**
 * 机位。**刻意不用自由的 6 自由度**，而是相对某个主体的极坐标参数化。
 *
 * 理由：约定 14 要求 startFrameDesc 的第一要素写成
 * 「摄影机在[主体][方位][距离]，镜头高度[身体部位]」—— 这四个量正是这里的四个字段。
 * 存自由位姿的话，回写时还得反解出"它在谁的什么方位"，而反解是有歧义的（多人场景里
 * 同一个位置对不同主体有不同描述）。存参数化机位，回写就只是套模板，不会出错。
 *
 * 副作用是 P3 的相机路径插值也更好做：插值方位角和距离，比插值原始坐标更像真实的运镜。
 */
export interface CameraRig {
  /** 以谁为主体。null = 以原点为主体（空场景时） */
  subjectFigureId: string | null;
  /** 方位角（度）。0 = 主体正前方；正值顺时针绕到主体的右手侧；180 = 背面 */
  azimuthDeg: number;
  /** 相机到主体的水平距离（米） */
  distance: number;
  /** 相机离地高度（米） */
  height: number;
  /** 看向主体身上的哪个高度（米，离地）。默认胸口。 */
  targetHeight: number;
  /** 垂直视场角（度）。35mm 等效焦距由 fovToFocal 换算。 */
  fov: number;
}

/** 一个镜头的走位与机位 */
export interface PrevizBlocking {
  version: 1;
  camera: CameraRig;
  placements: FigurePlacement[];
}

/**
 * 参数化机位 → three.js 需要的绝对位姿。
 *
 * 朝向约定：`rotY = 0` 的人面朝 -Z（three.js 里绕 Y 旋转 θ 会把局部 -Z 映射到
 * 世界 (-sinθ, 0, -cosθ)）。方位角在此基础上再绕 Y 旋转。
 */
export function resolveCameraPose(
  rig: CameraRig,
  placements: FigurePlacement[]
): { pos: [number, number, number]; target: [number, number, number] } {
  const subject = placements.find((p) => p.figureId === rig.subjectFigureId);
  const sx = subject?.x ?? 0;
  const sz = subject?.z ?? 0;
  const facing = subject?.rotY ?? 0;
  const a = facing + (rig.azimuthDeg * Math.PI) / 180;
  // 主体正前方的世界方向
  const dirX = -Math.sin(a);
  const dirZ = -Math.cos(a);
  return {
    pos: [sx + dirX * rig.distance, rig.height, sz + dirZ * rig.distance],
    target: [sx, rig.targetHeight, sz],
  };
}

// ── 景别换算 ──────────────────────────────────────────────────────────────
//
// 景别不该是用户在下拉框里随便选的一个词 —— 它是"相机离主体多远 + 视场角多大"的
// 确定结果。这里把这层关系写死，摆位时选景别就等于把相机放到算出来的距离上，
// 反过来拖动相机也能实时算出当前是什么景别。这样 startFrameDesc 里的景别词
// 与机位坐标永远自洽，不会出现"写着近景、机位却在 8 米外"。

export type ShotSize = "extremeWide" | "wide" | "full" | "medium" | "closeUp" | "extremeCloseUp";

export const SHOT_SIZE_LABEL: Record<ShotSize, string> = {
  extremeWide: "大远景",
  wide: "远景",
  full: "全景",
  medium: "中景",
  closeUp: "近景",
  extremeCloseUp: "特写",
};

/**
 * 每种景别在画面竖直方向上要容纳的高度，按主体身高的倍数计。
 *
 * 例：全景 = 画面竖直方向刚好装下 1.15 个身高（留一点头顶余量）；
 * 近景 = 只装下 0.45 个身高（约胸口以上）。
 */
const SHOT_SIZE_FRAMED_HEIGHT: Record<ShotSize, number> = {
  extremeWide: 6,
  wide: 2.5,
  full: 1.15,
  medium: 0.62,   // 约腰部以上
  closeUp: 0.32,  // 约胸口以上
  extremeCloseUp: 0.16, // 约头部
};

/** 取景框竖直方向覆盖 framedHeight 米时，相机需要离主体多远（米） */
export function distanceForFraming(framedHeight: number, fovDeg: number): number {
  const half = (fovDeg * Math.PI) / 180 / 2;
  return framedHeight / 2 / Math.tan(half);
}

/** 给定主体身高与视场角，某个景别对应的相机距离（米） */
export function distanceForShotSize(
  size: ShotSize,
  subjectHeight: number,
  fovDeg: number
): number {
  return distanceForFraming(SHOT_SIZE_FRAMED_HEIGHT[size] * subjectHeight, fovDeg);
}

/** 反向：相机在这个距离上，画面实际是什么景别（取最接近的一档） */
export function shotSizeForDistance(
  distance: number,
  subjectHeight: number,
  fovDeg: number
): ShotSize {
  const half = (fovDeg * Math.PI) / 180 / 2;
  const framed = 2 * distance * Math.tan(half);
  const ratio = framed / subjectHeight;
  let best: ShotSize = "full";
  let bestDiff = Infinity;
  for (const [size, target] of Object.entries(SHOT_SIZE_FRAMED_HEIGHT) as [ShotSize, number][]) {
    // 在对数尺度上比较：景别是成倍变化的，线性比较会让远景一档吃掉所有差异
    const diff = Math.abs(Math.log(ratio / target));
    if (diff < bestDiff) { bestDiff = diff; best = size; }
  }
  return best;
}

/** 垂直视场角 → 35mm 等效焦距（毫米）。用于在 UI 上显示导演熟悉的数字。 */
export function fovToFocal(fovDeg: number): number {
  const half = (fovDeg * Math.PI) / 180 / 2;
  return Math.round(12 / Math.tan(half)); // 全画幅半高 12mm
}

/** 35mm 等效焦距 → 垂直视场角 */
export function focalToFov(focalMm: number): number {
  return (2 * Math.atan(12 / focalMm) * 180) / Math.PI;
}

// ── 默认值 ────────────────────────────────────────────────────────────────

export const DEFAULT_FIGURE_HEIGHT = 1.7;

export function emptyScene(): PrevizScene {
  return { version: 1, blocks: [], figures: [] };
}

export function defaultCamera(subjectFigureId: string | null = null): CameraRig {
  // 默认：主体正前方、成人视平线高度、中景距离，看向胸口
  return {
    subjectFigureId,
    azimuthDeg: 0,
    distance: distanceForShotSize("medium", DEFAULT_FIGURE_HEIGHT, 40),
    height: 1.6,
    targetHeight: DEFAULT_FIGURE_HEIGHT * 0.72,
    fov: 40,
  };
}

export function defaultBlocking(figures: StageFigure[]): PrevizBlocking {
  return {
    version: 1,
    camera: defaultCamera(figures[0]?.id ?? null),
    // 多人时沿 X 轴均匀排开，避免全部重叠在原点
    placements: figures.map((f, i) => ({
      figureId: f.id,
      x: (i - (figures.length - 1) / 2) * 0.9,
      z: 0,
      rotY: 0,
      pose: "stand" as FigurePose,
    })),
  };
}

// ── 安全解析 ──────────────────────────────────────────────────────────────
// DB 里的 JSON 可能是旧版本、可能被手工改坏。解析失败一律回落到空场景而不是抛错 ——
// 导演台打不开比摆位丢失更糟。

export function parseScene(raw: string | null | undefined): PrevizScene {
  if (!raw) return emptyScene();
  try {
    const parsed = JSON.parse(raw) as PrevizScene;
    if (!Array.isArray(parsed.blocks) || !Array.isArray(parsed.figures)) return emptyScene();
    return { version: 1, blocks: parsed.blocks, figures: parsed.figures };
  } catch {
    return emptyScene();
  }
}

export function parseBlocking(
  raw: string | null | undefined,
  figures: StageFigure[]
): PrevizBlocking {
  if (!raw) return defaultBlocking(figures);
  try {
    const parsed = JSON.parse(raw) as PrevizBlocking;
    if (!parsed.camera || !Array.isArray(parsed.placements)) return defaultBlocking(figures);
    // 场景里新增的演员，本镜还没有走位 —— 补一个默认位置，而不是让它在画面里消失
    const known = new Set(parsed.placements.map((p) => p.figureId));
    const missing = figures.filter((f) => !known.has(f.id));
    // 主体被删掉时机位会失去参照，回落到第一个演员而不是让相机指向虚空
    const subjectAlive = figures.some((f) => f.id === parsed.camera.subjectFigureId);
    return {
      version: 1,
      camera: subjectAlive
        ? parsed.camera
        : { ...parsed.camera, subjectFigureId: figures[0]?.id ?? null },
      placements: [
        ...parsed.placements.filter((p) => figures.some((f) => f.id === p.figureId)),
        ...defaultBlocking(missing).placements,
      ],
    };
  } catch {
    return defaultBlocking(figures);
  }
}
