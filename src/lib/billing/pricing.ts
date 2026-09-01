/**
 * 积分报价 —— 生成前算出这次要扣多少积分。
 *
 * 单位约定：`1 积分 = ¥0.01 面值`。
 *
 * 定价 = 上游成本 × MARKUP。这个倍数的主要构成是**失败重试与毛利**，
 * 不是基础设施：按实测口径，一集 50 镜的存储 + 流量成本约 ¥1.7，
 * 而同一集的视频生成上游成本在 ¥500 量级（占比 ~0.3%）。
 * 定价时不要因为「怕带宽贵」去调高倍数——真正需要对冲的是生成失败率。
 *
 * ⚠️ 本文件是**纯函数 + 纯数据**，被服务端计费闸门和前端预估共用，
 * 不要引入 server-only 或 node 内置模块。
 */

import { resolveVideoCapability } from "@/lib/ai/video-capabilities";

/** 扣费倍数：覆盖失败重试、支付手续费、退款损耗与毛利 */
export const CREDIT_MARKUP = 2.2;

/** 1 积分对应的人民币面值（元） */
export const CREDIT_UNIT_YUAN = 0.01;

export type BillableKind = "image" | "video" | "music" | "text";

/**
 * 各上游的成本口径（元）。这些数字来自官方计价页换算，**会变**，
 * 改动时请同步更新 docs 里的成本模型并复核 CREDIT_MARKUP 是否仍然成立。
 */
const VIDEO_COST_PER_SECOND_YUAN: { match: string; cost: number }[] = [
  // 更具体的排前面（与 video-capabilities 的家族匹配同一原则）
  { match: "seedance-2-5", cost: 2.0 },
  { match: "seedance-2-0-fast", cost: 0.5 },
  { match: "seedance-2-0", cost: 1.0 },
  { match: "seedance-1-5-lite", cost: 0.4 },
  { match: "seedance-1-5", cost: 0.8 },
  { match: "kling", cost: 1.0 },
  { match: "veo", cost: 3.0 },
  { match: "jimeng", cost: 0.6 },
  { match: "minimax-h3", cost: 1.0 },
];

/** 分辨率对成本的倍率（token 量与像素数成正比） */
const RESOLUTION_MULTIPLIER: Record<string, number> = {
  "480p": 1,
  "720p": 2.25,   // (1280×720) / (854×480)
  "1080p": 5.06,  // (1920×1080) / (854×480)
  "768P": 2.4,
  "2K": 9,
};

/** 单张图片的上游成本（元） */
const IMAGE_COST_YUAN = 0.25;

/** 音乐按秒计（火山「生成纯音乐」后付费 ¥0.002/秒） */
const MUSIC_COST_PER_SECOND_YUAN = 0.002;

export interface QuoteInput {
  kind: BillableKind;
  modelId?: string | null;
  /** 视频/音乐：秒数 */
  durationSeconds?: number;
  /** 视频：分辨率 */
  resolution?: string | null;
  /** 图片：张数，默认 1 */
  imageCount?: number;
}

export interface Quote {
  /** 应扣积分（已向上取整） */
  credits: number;
  /** 估算的上游成本（元），用于事后对账 */
  upstreamCostYuan: number;
  /** 人类可读的计价说明，回传前端展示 */
  explain: string;
}

function videoCostPerSecond(modelId?: string | null): number {
  const lower = (modelId ?? "").toLowerCase();
  for (const { match, cost } of VIDEO_COST_PER_SECOND_YUAN) {
    if (lower.includes(match)) return cost;
  }
  return 1.0; // 未知模型按中位价，避免报价为 0 导致白嫖
}

/**
 * 生成前报价。**永不返回 0**（除非明确是免费操作）——报价为 0 意味着可以无限白嫖。
 */
export function quoteCredits(input: QuoteInput): Quote {
  const toCredits = (yuan: number) =>
    Math.max(1, Math.ceil((yuan * CREDIT_MARKUP) / CREDIT_UNIT_YUAN));

  switch (input.kind) {
    case "video": {
      const cap = resolveVideoCapability(input.modelId);
      // 时长按能力表 clamp，避免用户传一个夸张值把报价撑爆或压低
      const raw = input.durationSeconds ?? cap.duration.min;
      const seconds = Math.min(cap.duration.max, Math.max(cap.duration.min, Math.ceil(raw)));
      const perSec = videoCostPerSecond(input.modelId);
      const resMul = RESOLUTION_MULTIPLIER[input.resolution ?? "480p"] ?? 1;
      const cost = seconds * perSec * resMul;
      return {
        credits: toCredits(cost),
        upstreamCostYuan: cost,
        explain: `${cap.label} · ${seconds}s · ${input.resolution ?? "480p"}`,
      };
    }
    case "image": {
      const n = Math.max(1, input.imageCount ?? 1);
      const cost = n * IMAGE_COST_YUAN;
      return {
        credits: toCredits(cost),
        upstreamCostYuan: cost,
        explain: `图片生成 × ${n}`,
      };
    }
    case "music": {
      const seconds = Math.max(30, Math.ceil(input.durationSeconds ?? 30));
      const cost = seconds * MUSIC_COST_PER_SECOND_YUAN;
      return {
        credits: toCredits(cost),
        upstreamCostYuan: cost,
        explain: `BGM · ${seconds}s`,
      };
    }
    case "text":
      // 文本生成成本相对视频可忽略（分镜拆解一次 < ¥0.1），一期不计费。
      // 若将来滥用严重再单独计价，届时改这里即可。
      return { credits: 0, upstreamCostYuan: 0, explain: "文本生成（当前不计费）" };
  }
}
