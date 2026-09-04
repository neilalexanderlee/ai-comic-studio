/**
 * 视频模型能力注册表 —— 视频侧「一个模型能做什么」的唯一事实来源。
 *
 * 为什么需要它：各家视频 API 的能力天然不等价（支持的生成模式、时长、比例、参考素材上限、
 * 是否支持音色克隆…），这些差异原先散落在 4 个地方靠条件分支硬扛：
 *   - `model-limits.ts`                只抽出了「时长」一项
 *   - `generate/route.ts` 的函数内局部常量 `MAX_MULTIMODAL_REFS=9` / `MAX_AUDIO_REFS=3`（写死 Seedance 2.0）
 *   - `generate/route.ts` 的 `isSeedanceProtocol` 判断（决定 prompt 方言）
 *   - `resolveSingleVideoMode()`       只看分镜数据，完全不知道 provider 支不支持算出来的模式
 *
 * 收编到这里之后，新增一个品牌/版本 = 在本表加一条 capability + 在 provider-factory 加一个 case，
 * **不需要改通用路由**。`video-capability-consistency.test.ts` 会守住这个约束。
 *
 * ⚠️ 本文件被客户端组件引用（shot-card / shot-drawer / prompt-editor 通过 getModelMaxDuration），
 * 必须保持纯数据 + 纯函数：不要引入 `server-only`、node 内置模块或任何有副作用的 import。
 */

/** 单镜视频生成模式。与 `shot-video-readiness.server.ts` 的 SingleVideoMode 是同一套语义。 */
export type VideoMode = "initialImage" | "keyframe" | "multimodal";

/** `provider-factory.ts` 的 `createVideoProvider` 支持的协议（一致性测试会校验两者对齐）。 */
export type VideoProtocol =
  | "seedance"
  | "gemini"
  | "kling"
  | "jimeng-video"
  | "minimax-video";

/** 视频提示词方言：决定 route 走哪个 prompt builder。 */
export type PromptDialect = "seedance-multi-param" | "generic";

/** 参考素材的传输方式。`assetId` 指火山私域素材库的 `asset://<id>` 引用。 */
export type RefTransport = "local" | "url" | "assetId";

export interface VideoModelCapability {
  protocol: VideoProtocol;
  /** 人类可读标识，仅用于日志和 UI 提示 */
  label: string;
  /** 精确 model id（小写）。优先于 families 匹配。 */
  modelIds: string[];
  /** 家族级子串匹配（小写）。数组内顺序无关，跨条目的匹配顺序由 FAMILY_ORDER 决定。 */
  families: string[];

  /** 支持的生成模式。不在此列表里的模式会被 downgradeVideoMode 降级。 */
  modes: VideoMode[];
  /** auto=true 表示支持传 -1 让模型自选时长 */
  duration: { min: number; max: number; auto: boolean };
  /** 支持的宽高比。空数组 = 该 provider 不接受我们的 ratio 参数（自行决定）。 */
  ratios: string[];
  /** 某些模式下比例被 API 强制锁死（例：MiniMax H3 的图生视频恒为 adaptive）。 */
  ratioLockedModes?: Partial<Record<VideoMode, string>>;
  /** 支持的分辨率。空数组 = 不接受我们的 resolution 参数。 */
  resolutions: string[];
  /** 支持的输出容器格式。Seedance 2.5 起支持 mov（H.264+yuv444p+PCM，供后期调色）。 */
  outputFormats: string[];

  /** 各类参考素材数量上限。0 = 不支持该类型。 */
  refs: { image: number; audio: number; video: number };
  /** 各类参考素材可用的传输方式。空数组 = 不支持该类型。 */
  refTransport: { image: RefTransport[]; audio: RefTransport[]; video: RefTransport[] };
  /**
   * 参考**视频**素材的硬限制。只在 `refs.video > 0` 且官方文档写明时声明；
   * 不确定就不写 —— 读取方遇到 undefined 一律放行，宁可让上游报错也不误挡。
   *
   * 为什么在表里而不是「上传校验处」：这个项目**没有**参考视频的上传入口，
   * 唯一的生产者是我们自己的白模预演（Seedance 生成或本地 3D 渲染），
   * 时长等于镜头时长。所以校验只能发生在**使用时**（`decidePrevizReference`），
   * 而那里按约定 7a 不允许写「如果是 seedance 就……」这类协议判断。
   */
  refVideoLimits?: { minDurationSec: number; maxDurationSec: number };

  features: {
    /** 是否支持同步生成音频（人声/音效/BGM） */
    generateAudio: boolean;
    /** 是否支持音频参考做音色克隆 */
    voiceClone: boolean;
    /** 是否返回成片尾帧（`shots.cutPoint` 的镜头衔接依赖它） */
    returnLastFrame: boolean;
    /** 是否拦截含真人人脸的参考图（决定要不要走私域素材库 asset:// 绕过） */
    realFaceBlocked: boolean;
    /**
     * 接受 `service_tier` 参数（弹性档，约省一半成本）的生成模式。空数组 = 完全不接受。
     *
     * ⚠️ 这个参数**按模式**而不是按模型开放。实测：Seedance 2.0 的参考生视频（r2v）
     * 传 service_tier 会被同步拒绝 ——
     * `InvalidParameter: the specified parameter service_tier is not supported for
     *  model doubao-seedance-2-0 in r2v, must be empty`。
     * 首帧/首尾帧模式沿用改造前的行为（`SEEDANCE_SERVICE_TIER` 环境变量一直是这么用的）。
     * 2.5 在 r2v 下是否放开未经实测，按保守假设一并排除；确认放开后改这一行即可。
     */
    serviceTierModes: VideoMode[];
  };

  promptDialect: PromptDialect;
  /** `@参考N` 全局连续编号 / `@图片N`+`@音频N` 按类型编号 / 不使用编号 */
  refNumbering: "global" | "per-type" | "none";
}

/** 未知模型的兜底能力：按最保守的假设填，只保证不崩。 */
export const UNKNOWN_VIDEO_CAPABILITY: VideoModelCapability = {
  protocol: "seedance",
  label: "未知模型（兜底）",
  modelIds: [],
  families: [],
  modes: ["initialImage", "keyframe"],
  duration: { min: 4, max: 12, auto: false },
  ratios: [],
  resolutions: [],
  outputFormats: ["mp4"],
  refs: { image: 0, audio: 0, video: 0 },
  refTransport: { image: [], audio: [], video: [] },
  features: {
    generateAudio: false,
    voiceClone: false,
    returnLastFrame: false,
    realFaceBlocked: false,
    serviceTierModes: [],
  },
  promptDialect: "generic",
  refNumbering: "none",
};

/** Seedance 2.x 系列共享的多模态能力（1.5 系列沿用，见下方注释）。 */
const SEEDANCE_MULTIMODAL = {
  modes: ["initialImage", "keyframe", "multimodal"] as VideoMode[],
  outputFormats: ["mp4"],
  ratios: ["16:9", "9:16", "1:1", "adaptive"],
  // 官方文档硬限制：多模态参考图片 1~9 张；音频独立类型，最多 3 个，不占图片名额。
  refs: { image: 9, audio: 3, video: 0 },
  refTransport: {
    // 本地文件走 data URI；已锁进私域素材库的角色图走 asset://<id> 绕过真人人脸拦截
    image: ["local", "assetId"] as RefTransport[],
    audio: ["local"] as RefTransport[],
    video: [] as RefTransport[],
  },
  features: {
    generateAudio: true,
    voiceClone: true,
    returnLastFrame: true,
    realFaceBlocked: true,
    // r2v（参考生视频）明确不接受 service_tier，见 serviceTierModes 的说明
    serviceTierModes: ["initialImage", "keyframe"] as VideoMode[],
  },
  promptDialect: "seedance-multi-param" as PromptDialect,
  refNumbering: "global" as const,
};

export const VIDEO_CAPABILITIES: VideoModelCapability[] = [
  // ── 火山方舟 Seedance ──────────────────────────────────────────────────────
  {
    ...SEEDANCE_MULTIMODAL,
    protocol: "seedance",
    label: "Doubao Seedance 2.5",
    modelIds: ["doubao-seedance-2-5-260628"],
    families: ["seedance-2-5"],
    // 官方：4~30 秒，或 -1 由模型在有效时长内自选
    duration: { min: 4, max: 30, auto: true },
    // 官方：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / adaptive
    ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"],
    // ⚠️ 首帧 / 首尾帧任务的 ratio **必须**是 adaptive，否则任务创建后异步报错
    // InvalidParameter.TaskTypeConstraint（模型自动保持输出宽高比与首帧图片一致）。
    // 参考生视频（multimodal）无此限制，故不锁。
    ratioLockedModes: { keyframe: "adaptive", initialImage: "adaptive" },
    resolutions: ["480p", "720p", "1080p"],
    outputFormats: ["mp4", "mov"],
    // 官方：单次参考素材上限 50 个 = 30 张图 + 10 段视频 + 10 段音频。
    refs: { image: 30, audio: 10, video: 10 },
    // 官方「使用限制 › 视频要求」：参考音/视频单个 [2,30]s（总时长 ≤ 30s 这条
    // 目前用不上 —— 白模预演每次只传 1 段）
    refVideoLimits: { minDurationSec: 2, maxDurationSec: 30 },
    refTransport: {
      image: ["local", "assetId"],
      audio: ["local"],
      // ⚠️ 参考视频只接受视频 URL 或素材 ID，**不支持 base64**（教程「使用限制 › 视频要求」）。
      // 这就是白模预演必须排在对象存储落地之后的原因。
      video: ["url", "assetId"],
    },
    // 2.5 提示词指南要求按类型分别编号（@图片1 / @视频1 / @音频1），不再用全局连续的 @参考N
    refNumbering: "per-type",
  },
  {
    ...SEEDANCE_MULTIMODAL,
    protocol: "seedance",
    label: "Doubao Seedance 2.0",
    modelIds: ["doubao-seedance-2-0-260128"],
    families: ["seedance-2-0"],
    duration: { min: 4, max: 15, auto: true },
    // 官方文档：480P / 720P / 1080P / 4k。此前表里只写了前两档 ——
    // 少声明的后果是用户在分镜页的分辨率选择器里**根本看不到 1080P**，而它是支持的。
    // ⚠️ 4K 另有独立限流口径（RPM 0.015k、并发独享 1；非 4K 是 0.18k、共享 3）。
    // 本表没有表达限流的字段，超了会拿到上游 429 —— 信息明确，不是静默问题。
    resolutions: ["480p", "720p", "1080p", "4k"],
    outputFormats: ["mp4"],
  },
  {
    ...SEEDANCE_MULTIMODAL,
    protocol: "seedance",
    label: "Doubao Seedance 2.0 Mini",
    modelIds: ["doubao-seedance-2-0-mini-260615"],
    // 必须比 "seedance-2-0" 更长更具体，家族匹配才会优先命中这一条（FAMILY_ORDER 取更长者）
    families: ["seedance-2-0-mini"],
    // 官方文档确认：4~15s / 480P、720P / 24fps —— 与同代 2.0 的时长一致，
    // 但分辨率封顶在 720P（2.0 可到 4k）。
    duration: { min: 4, max: 15, auto: true },
    resolutions: ["480p", "720p"],
    outputFormats: ["mp4"],
    features: {
      ...SEEDANCE_MULTIMODAL.features,
      // 实测明确拒绝：`the specified parameter service_tier is not supported for
      // model doubao-seedance-2-0-mini in t2v, must be empty`
      serviceTierModes: [],
    },
    // 参考视频：模型元数据 input_modalities 含 video、task_type 含 MultimodalToVideo，
    // 且已实测跑通「白模预演作为 reference_video 进正式生成」。
    // 上限按 1 声明 —— 只验证过 1 段（预演场景也只需要 1 段），没有依据写更大的数字。
    refs: { ...SEEDANCE_MULTIMODAL.refs, video: 1 },
    // 只验证过公网 URL；asset:// 形式没试过，不声明。
    refTransport: { ...SEEDANCE_MULTIMODAL.refTransport, video: ["url"] },
    // 参考视频的时长上下限官方文档没写、也没实测过，**故意不声明** ——
    // 编一个数字会把本来能用的预演挡掉，比让上游报一次错更糟。
  },
  {
    ...SEEDANCE_MULTIMODAL,
    protocol: "seedance",
    label: "Doubao Seedance 2.0 Fast",
    modelIds: ["doubao-seedance-2-0-fast-260128"],
    families: ["seedance-2-0-fast"],
    duration: { min: 4, max: 15, auto: true },
    resolutions: ["480p", "720p"],
    outputFormats: ["mp4"],
  },
  {
    // 1.5 系列的参考素材上限官方文档未单独说明，这里沿用 2.0 的 9/3
    // —— 与本次重构前的代码行为一致（旧代码对所有模型都用写死的 9/3）。
    ...SEEDANCE_MULTIMODAL,
    protocol: "seedance",
    label: "Doubao Seedance 1.5 Pro",
    modelIds: ["doubao-seedance-1-5-pro-251215"],
    families: ["seedance-1-5"],
    duration: { min: 4, max: 12, auto: true },
    resolutions: ["480p", "720p", "1080p"],
    outputFormats: ["mp4"],
  },
  {
    ...SEEDANCE_MULTIMODAL,
    protocol: "seedance",
    label: "Doubao Seedance 1.5 Lite",
    modelIds: ["doubao-seedance-1-5-lite-250601"],
    families: ["seedance-1-5-lite"],
    duration: { min: 4, max: 10, auto: true },
    resolutions: ["480p"],
    outputFormats: ["mp4"],
  },
  {
    // 协议兜底：未识别的 Seedance 版本
    ...SEEDANCE_MULTIMODAL,
    protocol: "seedance",
    label: "Doubao Seedance（未知版本）",
    modelIds: [],
    families: ["seedance"],
    duration: { min: 4, max: 12, auto: true },
    resolutions: ["480p", "720p"],
    outputFormats: ["mp4"],
  },

  // ── Google Veo（protocol: gemini）──────────────────────────────────────────
  {
    protocol: "gemini",
    label: "Google Veo",
    modelIds: [
      "veo-2.0-generate-001",
      "veo-3.0-generate-001",
      "veo-3.0-fast-generate-001",
      "veo-3.1-generate-001",
      "veo-3.1-fast-generate-001",
    ],
    families: ["veo"],
    // veo.ts 只处理 anchorFirst / initialImage；收到 multimodalRefs 会直接抛
    // "Veo requires an image input"。referenceImages 是另一条独立参数，不走 multimodalRefs。
    modes: ["initialImage", "keyframe"],
    duration: { min: 4, max: 8, auto: false },
    // veo.ts 的 toAspectRatio() 只映射到 16:9 / 9:16，其余一律落到 16:9
    ratios: ["16:9", "9:16"],
    resolutions: [],
    outputFormats: ["mp4"],
    refs: { image: 0, audio: 0, video: 0 },
    refTransport: { image: [], audio: [], video: [] },
    features: {
      generateAudio: false,
      voiceClone: false,
      // 注：anchorLastAi 仅 Veo 2.x / 3.1+ 支持，3.0 会被 veo.ts 静默跳过
      returnLastFrame: false,
      realFaceBlocked: false,
      serviceTierModes: [],
    },
    promptDialect: "generic",
    refNumbering: "none",
  },

  // ── 快手可灵 Kling ─────────────────────────────────────────────────────────
  {
    protocol: "kling",
    label: "Kling v3",
    modelIds: ["kling-v3"],
    families: ["kling-v3"],
    // kling-video.ts 用 `"anchorFirst" in params` 二分：multimodalRefs 会掉进 else 分支
    // 并对 undefined 的 initialImage 取 base64 而崩溃。
    modes: ["initialImage", "keyframe"],
    duration: { min: 3, max: 15, auto: false },
    ratios: ["16:9", "9:16", "1:1"],
    resolutions: [],
    outputFormats: ["mp4"],
    refs: { image: 0, audio: 0, video: 0 },
    refTransport: { image: [], audio: [], video: [] },
    features: {
      generateAudio: true,
      voiceClone: false,
      returnLastFrame: false,
      realFaceBlocked: false,
      serviceTierModes: [],
    },
    promptDialect: "generic",
    refNumbering: "none",
  },
  {
    protocol: "kling",
    label: "Kling（v1 / v1.5 / v2.5）",
    modelIds: ["kling-v1", "kling-v1-5", "kling-v2.5-turbo"],
    families: ["kling"],
    modes: ["initialImage", "keyframe"],
    duration: { min: 5, max: 10, auto: false },
    ratios: ["16:9", "9:16", "1:1"],
    resolutions: [],
    outputFormats: ["mp4"],
    refs: { image: 0, audio: 0, video: 0 },
    refTransport: { image: [], audio: [], video: [] },
    features: {
      generateAudio: true,
      voiceClone: false,
      returnLastFrame: false,
      realFaceBlocked: false,
      serviceTierModes: [],
    },
    promptDialect: "generic",
    refNumbering: "none",
  },

  // ── 即梦 Jimeng ────────────────────────────────────────────────────────────
  {
    protocol: "jimeng-video",
    label: "Jimeng Video 3.0",
    modelIds: ["jimeng_i2v_v30", "jimeng_i2v_v30_1080"],
    families: ["jimeng"],
    // jimeng-video.ts 只从 anchorFirst / initialImage 收集图片；multimodalRefs 会导致空图列表
    modes: ["initialImage", "keyframe"],
    duration: { min: 5, max: 10, auto: false },
    ratios: ["16:9", "9:16", "1:1"],
    resolutions: [],
    outputFormats: ["mp4"],
    refs: { image: 0, audio: 0, video: 0 },
    refTransport: { image: [], audio: [], video: [] },
    features: {
      generateAudio: false,
      voiceClone: false,
      returnLastFrame: false,
      realFaceBlocked: false,
      serviceTierModes: [],
    },
    promptDialect: "generic",
    refNumbering: "none",
  },

  // ── MiniMax H3 ─────────────────────────────────────────────────────────────
  {
    protocol: "minimax-video",
    label: "MiniMax H3",
    modelIds: ["minimax-h3"],
    families: ["minimax-h3"],
    // minimax-video.ts 三种 body 都实现了（含 reference_image + reference_audio）
    modes: ["initialImage", "keyframe", "multimodal"],
    duration: { min: 4, max: 15, auto: false },
    ratios: ["adaptive"],
    // provider 里三种 body 都硬编码 ratio: "adaptive"
    ratioLockedModes: {
      initialImage: "adaptive",
      keyframe: "adaptive",
      multimodal: "adaptive",
    },
    resolutions: ["768P", "2K"],
    outputFormats: ["mp4"],
    // 官方未公布多模态参考数量上限，暂沿用 Seedance 的 9/3（与重构前行为一致）。
    // 接入真实账号验证后再按实测值收紧。
    refs: { image: 9, audio: 3, video: 0 },
    refTransport: { image: ["local", "url"], audio: ["local"], video: [] },
    features: {
      generateAudio: false,
      voiceClone: true,
      returnLastFrame: false,
      realFaceBlocked: false,
      serviceTierModes: [],
    },
    // 注：H3 的多模态 body 结构与 Seedance 同构，但 route 目前只为 Seedance 组装角色参考图
    // （见 shouldResolveMultimodalCharacterRefs），所以这里保持 generic 以维持现有行为。
    promptDialect: "generic",
    refNumbering: "none",
  },
];

/**
 * 家族匹配顺序：更具体的必须排在前面。
 * 直接从 VIDEO_CAPABILITIES 的声明顺序推导，再按字符串长度降序兜底，
 * 保证 "seedance-2-0-fast" 先于 "seedance-2-0"，"kling-v3" 先于 "kling"。
 */
const FAMILY_INDEX: { family: string; cap: VideoModelCapability }[] = VIDEO_CAPABILITIES.flatMap(
  (cap) => cap.families.map((family) => ({ family, cap }))
).sort((a, b) => b.family.length - a.family.length);

const EXACT_INDEX = new Map<string, VideoModelCapability>(
  VIDEO_CAPABILITIES.flatMap((cap) => cap.modelIds.map((id) => [id, cap] as const))
);

/**
 * 按 model id 解析能力描述符。
 *
 * `protocol` 是可选的消歧参数：同一个 model id 在不同协议下不会重名，所以正常情况下
 * 只靠 modelId 就能定位；传了 protocol 时会优先在该协议内匹配，匹配不到再退回全局。
 * 匹配不到任何条目时返回 UNKNOWN_VIDEO_CAPABILITY（不抛异常，避免因为用户手填了一个
 * 陌生 model id 就让整条生成链路挂掉）。
 */
export function resolveVideoCapability(
  modelId?: string | null,
  protocol?: string | null
): VideoModelCapability {
  if (!modelId) {
    // 只有协议信息时，退回该协议的第一条（通常是主力版本）
    const byProtocol = VIDEO_CAPABILITIES.find((c) => c.protocol === protocol);
    return byProtocol ?? UNKNOWN_VIDEO_CAPABILITY;
  }

  const lower = modelId.toLowerCase();

  const exact = EXACT_INDEX.get(lower);
  if (exact && (!protocol || exact.protocol === protocol)) return exact;

  for (const { family, cap } of FAMILY_INDEX) {
    if (lower.includes(family) && (!protocol || cap.protocol === protocol)) return cap;
  }

  // 协议内匹配不到（例如用户为 seedance provider 手填了一个陌生 id），放宽到全局
  if (protocol) {
    if (exact) return exact;
    for (const { family, cap } of FAMILY_INDEX) {
      if (lower.includes(family)) return cap;
    }
    const byProtocol = VIDEO_CAPABILITIES.find((c) => c.protocol === protocol);
    if (byProtocol) return byProtocol;
  }

  return UNKNOWN_VIDEO_CAPABILITY;
}

/** 未知模型的时长兜底（保持与重构前 `model-limits.ts` 的 DEFAULT_MAX_DURATION 一致）。 */
export const DEFAULT_MAX_DURATION = 12;

/**
 * 返回该模型支持的最大视频时长（秒）。未知模型返回 12。
 * 签名与原 `model-limits.ts` 的同名函数保持一致（客户端组件也在用）。
 */
export function getModelMaxDuration(modelId?: string | null): number {
  if (!modelId) return DEFAULT_MAX_DURATION;
  return resolveVideoCapability(modelId).duration.max;
}

export interface VideoModeDecision {
  mode: VideoMode;
  /** 理想模式不被支持而发生了降级 */
  downgraded: boolean;
  /** 降级前的理想模式（未降级时与 mode 相同） */
  requested: VideoMode;
}

/**
 * 把「按分镜数据算出的理想模式」降级到「当前 provider 真正支持的模式」。
 *
 * 降级链：multimodal → initialImage → keyframe → 该 provider 支持的第一个模式。
 * multimodal 退 initialImage 是因为两者都只需要一张首帧图；keyframe 需要额外的 AI 尾帧，
 * 不能凭空造出来，所以只作为最后兜底（此时 provider 只支持 keyframe，属于异常配置）。
 */
export function downgradeVideoMode(
  requested: VideoMode,
  cap: VideoModelCapability
): VideoModeDecision {
  if (cap.modes.includes(requested)) {
    return { mode: requested, downgraded: false, requested };
  }

  const chain: VideoMode[] =
    requested === "multimodal"
      ? ["initialImage", "keyframe"]
      : requested === "keyframe"
        ? ["initialImage", "multimodal"]
        : ["multimodal", "keyframe"];

  for (const candidate of chain) {
    if (cap.modes.includes(candidate)) {
      return { mode: candidate, downgraded: true, requested };
    }
  }

  return { mode: cap.modes[0] ?? "initialImage", downgraded: true, requested };
}

/**
 * 生成「本次会丢什么」的人类可读说明，供 UI 在生成前告知用户。
 *
 * 设计原则：降级必须在生成前算出来并回显，不能服务端静默处理 —— 否则用户切换品牌后
 * 只会感觉"效果莫名其妙变差了"，无从判断是模型能力差异还是 bug。
 */
export function describeCapabilityLoss(
  cap: VideoModelCapability,
  ctx: {
    decision: VideoModeDecision;
    /** 该镜头希望传入的角色定妆图数量 */
    characterImageCount?: number;
    /** 该镜头希望传入的音色参考数量（0 表示本镜没有台词/音色需求） */
    audioRefCount?: number;
    /** 分镜设定的时长（秒） */
    requestedDuration?: number;
  }
): string[] {
  const notes: string[] = [];

  if (ctx.decision.downgraded && ctx.decision.requested === "multimodal") {
    notes.push(
      `${cap.label} 不支持多模态参考，本次不会用角色定妆图锁定外貌（已降级为首帧模式）`
    );
  } else if (ctx.decision.downgraded) {
    notes.push(`${cap.label} 不支持「${ctx.decision.requested}」模式，已降级为「${ctx.decision.mode}」`);
  }

  if ((ctx.characterImageCount ?? 0) > cap.refs.image && cap.refs.image > 0) {
    notes.push(
      `参考图 ${ctx.characterImageCount} 张超过 ${cap.label} 的上限 ${cap.refs.image} 张，超出部分会按优先级裁剪`
    );
  }

  if ((ctx.audioRefCount ?? 0) > 0 && !cap.features.voiceClone) {
    notes.push(`${cap.label} 不支持音色克隆，台词音色将由模型自由发挥`);
  }

  if (ctx.requestedDuration != null && ctx.requestedDuration > cap.duration.max) {
    notes.push(
      `分镜时长 ${ctx.requestedDuration}s 超过 ${cap.label} 的上限 ${cap.duration.max}s，本次只会生成 ${cap.duration.max}s`
    );
  }

  // 这里刻意不提示 features.returnLastFrame：自动镜头衔接功能已随 migration 0047 移除
  // （`projects.link_shots_via_cut_point` 列已删），现在只剩用户手动点「承接上一镜尾帧」。
  // 无条件提示会让每次用 Kling/Veo 生成都弹一条无关警告，噪音大于价值。
  // 若将来恢复自动衔接，在这里按项目开关补一条即可。

  return notes;
}

/** 某个模式下 API 强制锁定的比例；未锁定时返回 undefined（用调用方传入的比例）。 */
export function resolveRatioForMode(
  cap: VideoModelCapability,
  mode: VideoMode
): string | undefined {
  return cap.ratioLockedModes?.[mode];
}

/** 该 model id 是否命中了注册表里的真实条目（而非兜底）。一致性测试与诊断用。 */
export function isKnownVideoModel(modelId?: string | null): boolean {
  return resolveVideoCapability(modelId) !== UNKNOWN_VIDEO_CAPABILITY;
}
