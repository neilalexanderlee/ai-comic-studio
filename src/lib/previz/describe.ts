/**
 * 3D 导演台 → 分镜文本的**确定性**回写（导演台 P2）。
 *
 * ## 为什么这层值得存在
 *
 * 约定 14 要求 `startFrameDesc` 的第一要素写成
 * 「摄影机在[主体][方位][距离]，镜头高度[身体部位]」，第二要素写景别与取景范围。
 * 这两条是整份帧描述里**唯一有唯一正确答案**的部分 —— 它们完全由机位决定。
 * 原先却是让 LLM 凭空写的，而空间坐标恰恰是 LLM 最不擅长的东西（约定 15 用了
 * 一整节篇幅去约束它，仍然经常写出"近景 + 机位在 8 米外"这种自相矛盾的描述）。
 *
 * 摆好位之后这些量都是算出来的：距离就是距离，景别由 `shotSizeForDistance` 换算，
 * 机位高度对着身高一比就知道是胸口还是膝盖。所以这里全部是纯函数，没有 LLM。
 *
 * ## 边界：什么不算
 *
 * 只算**要素 1、2** 和 `cameraDirection` 的**起幅/运动/落幅**。
 *
 * - 要素 3（角色姿态）：盒体人偶只有站/坐/蹲/倒/跑五档，写进帧描述会把
 *   "左手扶额、右臂垂落"这种真正有用的细节替换成"站立"，是纯粹的降级
 * - 要素 4（主光）、要素 5（情绪解剖）：3D 台里根本不存在这两样信息
 * - `cameraDirection` 的**叙事目的**：那是"为什么这么运镜"，是导演意图不是几何量
 *
 * 所以回写是**外科手术式的替换**（只换前两个子句，保留其余），并且
 * **必须经用户确认**再落库 —— `startFrameDesc` 是帧生成的唯一事实来源，
 * 静默覆盖掉光影和情绪子句是不可逆的数据损失。
 */

import {
  SHOT_SIZE_LABEL,
  shotSizeForDistance,
  type CameraRig,
  type PrevizBlocking,
  type PrevizScene,
  type ShotSize,
  type FigurePlacement,
  DEFAULT_FIGURE_HEIGHT,
} from "./stage-types";

// ── 方位 ──────────────────────────────────────────────────────────────────
//
// 方位角以**主体自己的朝向**为基准（0 = 主体正前方，正值绕向主体的右手侧），
// 所以措辞也从主体出发说："摄影机在角色右前方"。这与观众视角无关 ——
// 观众视角要说"画面左侧"，那是取景内的位置，属于要素 3。

const AZIMUTH_BUCKETS: { max: number; label: string }[] = [
  { max: 22.5, label: "正前方" },
  { max: 67.5, label: "右前方" },
  { max: 112.5, label: "正右侧" },
  { max: 157.5, label: "右后方" },
  { max: 180, label: "正后方" },
];

export function azimuthLabel(deg: number): string {
  // 归一到 [-180, 180]
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  const right = a >= 0;
  const abs = Math.abs(a);
  const bucket = AZIMUTH_BUCKETS.find((b) => abs <= b.max) ?? AZIMUTH_BUCKETS[4];
  // 正前方/正后方没有左右之分
  if (bucket.label === "正前方" || bucket.label === "正后方") return bucket.label;
  return right ? bucket.label : bucket.label.replace("右", "左");
}

// ── 机位高度落在身体的哪个部位 ────────────────────────────────────────────
//
// 用**相机离地高度 ÷ 主体身高**来判断，而不是相机与目标点的相对关系：
// 前者才是"镜头架在多高"这个物理事实，也是摄影师之间实际交流的说法。

const HEIGHT_BUCKETS: { maxRatio: number; label: string }[] = [
  { maxRatio: 0.18, label: "地面" },
  { maxRatio: 0.34, label: "膝盖" },
  { maxRatio: 0.52, label: "腰部" },
  { maxRatio: 0.72, label: "胸口" },
  { maxRatio: 0.86, label: "肩部" },
  { maxRatio: 1.02, label: "眼睛" },
  { maxRatio: Infinity, label: "头顶以上" },
];

export function heightPartLabel(cameraHeight: number, subjectHeight: number): string {
  const ratio = cameraHeight / (subjectHeight || DEFAULT_FIGURE_HEIGHT);
  return (HEIGHT_BUCKETS.find((b) => ratio <= b.maxRatio) ?? HEIGHT_BUCKETS[6]).label;
}

/**
 * 俯/平/仰。由**俯仰角**决定，不由机位高度决定 ——
 * 相机架在头顶但看向远处的地平线仍然是平视，架得低却抬头看脸就是仰拍。
 */
export function pitchLabel(rig: CameraRig): string {
  const pitchDeg = (Math.atan2(rig.height - rig.targetHeight, Math.max(rig.distance, 0.01)) * 180) / Math.PI;
  if (pitchDeg > 12) return "俯拍";
  if (pitchDeg < -12) return "仰拍";
  return "平视";
}

// ── 景别的取景范围 ────────────────────────────────────────────────────────

const FRAMING_HINT: Record<ShotSize, string> = {
  extremeWide: "取景整片环境，人物在画面中占比很小",
  wide: "取景全身与大片环境",
  full: "取景全身，头顶留有余量",
  medium: "取景腰部以上",
  closeUp: "取景胸口以上",
  extremeCloseUp: "取景面部",
};

// ── 单个机位的描述 ────────────────────────────────────────────────────────

export interface CameraDescription {
  /** 主体显示名。无主体时为"画面中心" */
  subjectName: string;
  shotSize: ShotSize;
  /** "近景平视" */
  sizeWithPitch: string;
  /** 要素 1："摄影机在角色甲正前方约1.5米，镜头高度胸口平视" */
  position: string;
  /** 要素 2："近景平视，取景胸口以上" */
  framing: string;
}

function subjectOf(
  rig: CameraRig,
  scene: PrevizScene,
  placements: FigurePlacement[]
): { name: string; height: number } {
  const fig = scene.figures.find((f) => f.id === rig.subjectFigureId);
  if (fig) return { name: fig.name, height: fig.height || DEFAULT_FIGURE_HEIGHT };
  // 主体缺失（空场景 / 演员被删）时仍要能出一句话，而不是抛错让整个面板打不开
  const fallback = scene.figures.find((f) => placements.some((p) => p.figureId === f.id));
  return fallback
    ? { name: fallback.name, height: fallback.height || DEFAULT_FIGURE_HEIGHT }
    : { name: "画面中心", height: DEFAULT_FIGURE_HEIGHT };
}

/** 距离措辞：近距离精确到 0.1 米，远了就没必要（也没人这么说话） */
function distancePhrase(d: number): string {
  if (d < 10) return `约${d.toFixed(1)}米`;
  return `约${Math.round(d)}米`;
}

export function describeCamera(
  rig: CameraRig,
  scene: PrevizScene,
  placements: FigurePlacement[]
): CameraDescription {
  const subject = subjectOf(rig, scene, placements);
  const size = shotSizeForDistance(rig.distance, subject.height, rig.fov);
  const pitch = pitchLabel(rig);
  const sizeWithPitch = `${SHOT_SIZE_LABEL[size]}${pitch}`;

  return {
    subjectName: subject.name,
    shotSize: size,
    sizeWithPitch,
    position: `摄影机在${subject.name}${azimuthLabel(rig.azimuthDeg)}${distancePhrase(rig.distance)}，镜头高度${heightPartLabel(rig.height, subject.height)}${pitch}`,
    framing: `${sizeWithPitch}，${FRAMING_HINT[size]}`,
  };
}

// ── startFrameDesc 的外科手术式合并 ───────────────────────────────────────

/** 五要素之间用全角分号分隔（约定 14） */
const SEP = "；";

/** 这个子句看起来是不是"机位空间坐标"？ */
function looksLikePosition(clause: string): boolean {
  return /摄影机|摄像机|机位|镜头高度/.test(clause);
}

const SHOT_SIZE_WORD = /大远景|远景|全景|中景|近景|特写/;

export type FramingMergeMode =
  /** 整句都是景别，直接换掉 */
  | "replaced"
  /** 景别与角色姿态写在同一句里，只就地换掉景别词 */
  | "sizeOnly"
  /** 原文里没有景别，插一句新的 */
  | "inserted";

/**
 * 改写"景别"这一句。
 *
 * ⚠️ 真实数据里**绝大多数** startFrameDesc 是这个形状：
 * 「中景平视，角色甲位于画面右侧偏后、右脚前跨左膝微弯、左手垂于体侧……」——
 * 景别（要素 2）和角色位置姿态（要素 3）被 LLM 写在了同一个子句里。
 * 按"这句含景别词就整句替换"去做，会把整段走位描述一并删掉，
 * 而那正是这里算不出来、也最不该丢的内容。
 *
 * 所以分三种形状处理，全部无损：只有确认整句就是景别时才整句换。
 */
function rewriteFramingClause(
  clause: string,
  desc: CameraDescription
): { text: string; mode: Exclude<FramingMergeMode, "inserted"> } | null {
  const m = /^([^，,]{1,12})(?:[，,]([\s\S]*))?$/.exec(clause.trim());
  if (!m || !SHOT_SIZE_WORD.test(m[1])) return null;
  const rest = m[2]?.trim();
  // 纯景别句（"近景平视" / "近景平视，取景胸口以上"）→ 整句换
  if (!rest || /^取景/.test(rest)) return { text: desc.framing, mode: "replaced" };
  // 景别 + 姿态混写 → 只换开头那个景别词，后面一个字都不动
  return { text: `${desc.sizeWithPitch}，${rest}`, mode: "sizeOnly" };
}

/**
 * 把算出来的要素 1、2 合并进已有的 startFrameDesc，**保留要素 3–5**。
 *
 * 认得出就替换，认不出就插入 —— 宁可多出一个子句让人一眼看见，
 * 也不要猜错位置把走位、光影或情绪吃掉。合并结果会先给用户过目再落库。
 */
export function mergeStartFrameDescDetailed(
  existing: string | null | undefined,
  desc: CameraDescription
): { text: string; framingMode: FramingMergeMode } {
  const clauses = (existing ?? "")
    .split(/[；;]/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (clauses.length === 0) {
    return { text: [desc.position, desc.framing].join(SEP), framingMode: "inserted" };
  }

  const out = [...clauses];
  // 要素 1：认得出就替换，否则插到最前面
  if (looksLikePosition(out[0])) out[0] = desc.position;
  else out.unshift(desc.position);

  // 要素 2：紧跟在要素 1 后面的那一句
  const rewritten = out.length > 1 ? rewriteFramingClause(out[1], desc) : null;
  if (rewritten) {
    out[1] = rewritten.text;
    return { text: out.join(SEP), framingMode: rewritten.mode };
  }
  out.splice(1, 0, desc.framing);
  return { text: out.join(SEP), framingMode: "inserted" };
}

export function mergeStartFrameDesc(existing: string | null | undefined, desc: CameraDescription): string {
  return mergeStartFrameDescDetailed(existing, desc).text;
}

// ── cameraDirection ───────────────────────────────────────────────────────

/** 运动量小于这些阈值就当作"没动" —— 拖拽必然有零点几度/厘米的抖动 */
const MOTION_EPS = { distance: 0.25, azimuth: 8, height: 0.15, fov: 4 };

export interface CameraMove {
  /** 运动短语，例如"缓慢推近、顺时针环绕45°"。静止镜头为"固定镜头" */
  phrase: string;
  hasMotion: boolean;
}

/**
 * 速度档。用**归一化后的最大变化率**判断：距离和角度不能直接比较，
 * 各自除以一个"看起来算快"的基准（0.6 米/秒、25 度/秒）之后才可比。
 */
function speedLabel(maxNormalizedRate: number): string {
  if (maxNormalizedRate < 0.55) return "缓慢";
  if (maxNormalizedRate < 1.4) return "平稳";
  return "快速";
}

export function describeCameraMove(from: CameraRig, to: CameraRig, duration: number): CameraMove {
  const secs = Math.max(duration, 0.1);
  const dDist = to.distance - from.distance;
  let dAz = ((to.azimuthDeg - from.azimuthDeg) % 360 + 540) % 360 - 180;
  const dHeight = to.height - from.height;
  const dFov = to.fov - from.fov;

  const parts: string[] = [];
  const rates: number[] = [];

  if (Math.abs(dDist) >= MOTION_EPS.distance) {
    parts.push(dDist < 0 ? "推近" : "拉远");
    rates.push(Math.abs(dDist) / secs / 0.6);
  }
  if (Math.abs(dAz) >= MOTION_EPS.azimuth) {
    // 环绕方向按俯视图说：方位角增大 = 相机绕向主体右手侧
    parts.push(`绕向${dAz > 0 ? "主体右侧" : "主体左侧"}环绕${Math.round(Math.abs(dAz))}°`);
    rates.push(Math.abs(dAz) / secs / 25);
  }
  if (Math.abs(dHeight) >= MOTION_EPS.height) {
    parts.push(dHeight > 0 ? `升高${Math.abs(dHeight).toFixed(1)}米` : `降低${Math.abs(dHeight).toFixed(1)}米`);
    rates.push(Math.abs(dHeight) / secs / 0.4);
  }
  if (Math.abs(dFov) >= MOTION_EPS.fov) {
    // 变焦与推拉是两件事：推拉改变透视，变焦不改变 —— 分开写，别混成"推近"
    parts.push(dFov < 0 ? "同时收窄视角变焦" : "同时放宽视角变焦");
    rates.push(Math.abs(dFov) / secs / 12);
  }

  if (parts.length === 0) return { phrase: "固定镜头", hasMotion: false };
  return {
    phrase: `${speedLabel(Math.max(...rates))}${parts.join("、")}`,
    hasMotion: true,
  };
}

/** 从已有的 cameraDirection 里抠出叙事目的 —— 那部分算不出来，只能原样留住 */
export function extractPurpose(existing: string | null | undefined): string | null {
  // 用 [\s\S] 而不是 . 加 s 标志：tsconfig 的 target 低于 es2018，s 标志编不过
  const m = /目的[：:]\s*([\s\S]+)$/.exec(existing ?? "");
  return m ? m[1].trim() : null;
}

/**
 * 按约定 14 的格式组装：`起幅[景别/机位] → 运动方式+速度 → 落幅[景别/机位]，目的：…`
 *
 * 目的取自已有文本；取不到时留一个显眼的占位，而不是编一个 ——
 * 面板里那两个框是可编辑的，用户会在应用之前把它补上。
 */
export function buildCameraDirection(
  blocking: PrevizBlocking,
  scene: PrevizScene,
  duration: number,
  existing?: string | null
): string {
  const track = [
    { t: 0, camera: blocking.camera, placements: blocking.placements },
    ...(blocking.keyframes ?? []).filter((k) => k.t > 0).sort((a, b) => a.t - b.t),
  ];
  const first = track[0];
  const last = track[track.length - 1];

  const head = describeCamera(first.camera, scene, first.placements);
  const tail = describeCamera(last.camera, scene, last.placements);
  const move = describeCameraMove(first.camera, last.camera, last.t > 0 ? last.t : duration);
  const purpose = extractPurpose(existing) ?? "【待补充：这么运镜是为了揭示/跟随/强调什么】";

  if (!move.hasMotion) {
    return `${head.sizeWithPitch} → 固定镜头 → ${tail.sizeWithPitch}，目的：${purpose}`;
  }
  return `${head.sizeWithPitch} → ${move.phrase} → ${tail.sizeWithPitch}，目的：${purpose}`;
}

// ── 面板一次性拿到的两段结果 ──────────────────────────────────────────────

export interface PrevizWriteback {
  startFrameDesc: string;
  cameraDirection: string;
  /** 计算依据，展示给用户看"为什么是这个数" */
  notes: string[];
}

export function buildPrevizWriteback(params: {
  scene: PrevizScene;
  blocking: PrevizBlocking;
  duration: number;
  existingStartFrameDesc?: string | null;
  existingCameraDirection?: string | null;
}): PrevizWriteback {
  const { scene, blocking, duration } = params;
  const head = describeCamera(blocking.camera, scene, blocking.placements);
  const kfCount = (blocking.keyframes ?? []).filter((k) => k.t > 0).length;
  const merged = mergeStartFrameDescDetailed(params.existingStartFrameDesc, head);

  const FRAMING_NOTE: Record<FramingMergeMode, string> = {
    replaced: "原文的景别句整句换成了新的景别与取景范围",
    sizeOnly: "原文把景别和角色姿态写在同一句里，只就地换掉了景别词，走位描述一字未动",
    inserted: "原文没写景别，新插入了一句",
  };

  return {
    startFrameDesc: merged.text,
    cameraDirection: buildCameraDirection(blocking, scene, duration, params.existingCameraDirection),
    notes: [
      `主体「${head.subjectName}」，起始机位距离 ${blocking.camera.distance.toFixed(1)} 米、` +
        `${Math.round(blocking.camera.azimuthDeg)}°、离地 ${blocking.camera.height.toFixed(2)} 米、` +
        `${Math.round(blocking.camera.fov)}° 视场 → ${SHOT_SIZE_LABEL[head.shotSize]}`,
      kfCount > 0 ? `按 ${kfCount} 个关键帧算出起幅与落幅` : "没有关键帧，按固定镜头写",
      FRAMING_NOTE[merged.framingMode],
      "光影与情绪两个子句原样保留 —— 3D 台里没有这两样信息",
    ],
  };
}
