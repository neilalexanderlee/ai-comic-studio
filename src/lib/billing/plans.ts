/**
 * 套餐与加油包 —— **代码常量，不建表**。
 *
 * 为什么不建 `plans` 表：本项目已经把同类注册表都放在代码里
 * （`VIDEO_CAPABILITIES`、`VISUAL_STYLE_PRESETS`、`pricing.ts`），一致性比"运营改价免部署"
 * 更重要 —— 后者要配一套管理后台才真的成立。可审计性由**订单快照**保证：
 * `orders` 存下单当时的 `planCode` + `amountCents` + `creditsGranted`，
 * 之后改价不影响历史订单。
 *
 * ## 订阅与积分的关系（核心产品决策）
 *
 * 这门生意几乎是纯成本转嫁：Seedance 2.5 · 720p 上游 ¥1.51/秒，一集 100 秒成片
 * 光模型成本 ¥151。也就是说**积分本身就是商品**，不存在一层"零边际成本的功能"能单独卖钱。
 * 所以不做"订阅解锁功能 + 积分另买"（用户会认为是双重收费），而是：
 *
 * - **订阅 = 按月产能承诺**：每月发放积分，**周期末清零**
 * - **加油包 = 额外产能**：一次性积分，**永不过期**
 * - 消费顺序：**先花会过期的**，保护用户的永久积分
 *
 * 订阅积分必须过期，否则订阅会退化成"打折的加油包" —— 用户订一个月囤满积分再退订，
 * MRR 立刻崩掉，积分负债还会无限累积（会计上永远确认不了的递延收入）。
 * 加油包则绝不过期：那是预付款，作废既有法律风险也最伤口碑。
 *
 * ## 功能位
 *
 * 只放**真正零边际成本、且诚实**的几项。⚠️ 全部在 `BILLING_ENABLED != "1"` 时不生效 ——
 * 自部署用户装上就必须能用全部功能（他们用的是自己的 API Key）。
 */

/** 计费面值：1 积分 = ¥0.01 */
export const CREDIT_UNIT_YUAN = 0.01;

export interface PlanFeatures {
  /** 同时进行的生成任务数上限。火山个人账号并发只有 3，这是真实瓶颈 */
  maxConcurrentJobs: number;
  /** 可用的视频模型档位（模型 id 的家族子串）。空数组 = 不限制 */
  allowedVideoFamilies: string[];
  /** 可选的最高输出分辨率 */
  maxResolution: "480p" | "720p" | "1080p";
  /** 项目数量上限。null = 不限 */
  maxProjects: number | null;
}

export interface Plan {
  code: string;
  name: string;
  /** 月费（分）。0 = 免费档 */
  priceCents: number;
  /** 每个周期发放的积分 */
  creditsPerPeriod: number;
  /** 周期天数 */
  periodDays: number;
  features: PlanFeatures;
  /** 展示用的一句话说明 */
  tagline: string;
}

/** 加油包：一次性购买，积分永不过期 */
export interface CreditPack {
  code: string;
  name: string;
  priceCents: number;
  credits: number;
  tagline: string;
}

export const FREE_PLAN_CODE = "free";

/**
 * 套餐。数值依据见 docs/PLAN-2026-09-SEEDANCE25-SAAS.md §3.4
 * （扣费 = 上游成本 × 2.2，覆盖失败重试、存储带宽、支付手续费与毛利）。
 */
export const PLANS: Plan[] = [
  {
    code: FREE_PLAN_CODE,
    name: "体验",
    priceCents: 0,
    creditsPerPeriod: 300,
    periodDays: 30,
    tagline: "每月 300 积分，够把流程跑一遍",
    features: {
      maxConcurrentJobs: 1,
      // 免费档只给最便宜的档位：mini 与 1.5 lite。防止一注册就烧 720p 的钱
      allowedVideoFamilies: ["seedance-2-0-mini", "seedance-1-5-lite"],
      maxResolution: "480p",
      maxProjects: 2,
    },
  },
  {
    code: "starter",
    name: "入门",
    priceCents: 9900,
    creditsPerPeriod: 12000,
    periodDays: 30,
    tagline: "≈ 36 秒 720p 成片，或 240 张分镜图",
    features: {
      maxConcurrentJobs: 2,
      allowedVideoFamilies: [],
      maxResolution: "720p",
      maxProjects: 10,
    },
  },
  {
    code: "pro",
    name: "专业",
    priceCents: 39900,
    creditsPerPeriod: 55000,
    periodDays: 30,
    tagline: "≈ 166 秒 720p 成片",
    features: {
      maxConcurrentJobs: 3,
      allowedVideoFamilies: [],
      maxResolution: "1080p",
      maxProjects: null,
    },
  },
  {
    code: "studio",
    name: "工作室",
    priceCents: 129900,
    creditsPerPeriod: 200000,
    periodDays: 30,
    tagline: "≈ 10 分钟 720p 成片",
    features: {
      maxConcurrentJobs: 6,
      allowedVideoFamilies: [],
      maxResolution: "1080p",
      maxProjects: null,
    },
  },
];

/** 加油包。**积分永不过期** —— 这是预付款，不是订阅赠品。 */
export const CREDIT_PACKS: CreditPack[] = [
  { code: "pack_11k", name: "加油包", priceCents: 10000, credits: 11000, tagline: "随时叠加，永不过期" },
  { code: "pack_60k", name: "大加油包", priceCents: 50000, credits: 60000, tagline: "单价更低，永不过期" },
];

export function findPlan(code: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.code === code);
}

export function findPack(code: string | null | undefined): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.code === code);
}

export function freePlan(): Plan {
  // 免费档必须存在：没有订阅记录的用户一律按它处理
  return PLANS.find((p) => p.code === FREE_PLAN_CODE)!;
}

/**
 * 未启用计费时的"无限制"功能位。
 *
 * 自部署场景下用户带自己的 API Key，任何功能限制都是纯粹的添堵。
 */
export const UNLIMITED_FEATURES: PlanFeatures = {
  maxConcurrentJobs: Number.MAX_SAFE_INTEGER,
  allowedVideoFamilies: [],
  maxResolution: "1080p",
  maxProjects: null,
};
