import "server-only";
import { NextResponse } from "next/server";
import { and, count, eq, gte } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { usageRecords } from "@/lib/db/schema";
import type { KeySource } from "@/lib/provider-secrets";

/**
 * 平台 Key 的用量刹车。
 *
 * ## 为什么它和 BILLING_ENABLED 解耦
 *
 * 支付还没接，`BILLING_ENABLED` 保持关闭 —— 也就是 `openBillingGate` 是空操作、
 * `checkConcurrency` 直接 return null。**从生成入口到上游之间，一个计数器都没有。**
 * 而 Seedance 2.5 · 720p 上游是 ¥1.51/秒：一个 7 秒分镜 ≈ ¥10.6，一集 15 镜 ≈ ¥159，
 * 凭据泄露后挂着跑一夜是四位数起，且没有任何东西会停下来。
 *
 * 所以这不是「要不要更稳妥」，是「有没有刹车」。
 *
 * ## 为什么它不违反默认值原则
 *
 * **限额只作用于「本次实际用了平台 Key」的请求**（`keySource === "platform"`）。
 * 自部署用户永远没有平台 Key（管理员没配）→ 走的永远是 BYOK 分支 →
 * 行为一行不变。与 BILLING_ENABLED / WORKER_IN_WEB / REQUIRE_AUTH 同一条原则。
 *
 * ## 为什么窗口是「最近 24 小时」而不是「自然日」
 *
 * 这个项目已经被 UTC/CST 的 8 小时偏移坑过一次（差点误判定时备份从未成功）。
 * 容器跑 UTC、宿主机跑 CST，「今天」到底从哪一刻算起会成为一个需要换算的问题；
 * 滚动窗口没有时区，也顺带堵掉「卡着零点重置连着刷两倍」。
 * 代价是文案要写清楚是「最近 24 小时」，不能写「今日」。
 */

/** 视频按**秒**计，不按条 —— 钱是按秒烧的 */
const DEFAULT_DAILY_VIDEO_SECONDS = 120;
const DEFAULT_DAILY_IMAGE_COUNT = 200;
const DEFAULT_DAILY_MUSIC_COUNT = 20;
/** 全局在飞任务数（按协议分组），防止把管理员那把 Key 打满或触发上游限流 */
const DEFAULT_MAX_INFLIGHT = 4;

const WINDOW_MS = 24 * 60 * 60 * 1000;
/** 与 plan-limits 的 STALE_RESERVATION_MS 同义：崩在预扣与结算之间的残骸不该永久占住并发 */
const STALE_RESERVATION_MS = 15 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  // 认不出来的写法回落到默认值而不是 0 —— 0 会把所有人挡在门外，
  // 而这个开关的失效方式应当是「没省到钱」，不是「谁都用不了」
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface PlatformLimits {
  dailyVideoSeconds: number;
  dailyImageCount: number;
  dailyMusicCount: number;
  maxInflight: number;
}

export function platformLimits(): PlatformLimits {
  return {
    dailyVideoSeconds: envInt("PLATFORM_DAILY_VIDEO_SECONDS", DEFAULT_DAILY_VIDEO_SECONDS),
    dailyImageCount: envInt("PLATFORM_DAILY_IMAGE_COUNT", DEFAULT_DAILY_IMAGE_COUNT),
    dailyMusicCount: envInt("PLATFORM_DAILY_MUSIC_COUNT", DEFAULT_DAILY_MUSIC_COUNT),
    maxInflight: envInt("PLATFORM_MAX_INFLIGHT", DEFAULT_MAX_INFLIGHT),
  };
}

export type PlatformUsageKind = "video" | "image" | "music" | "text";

export interface PlatformUsageRequest {
  kind: PlatformUsageKind;
  keySource: KeySource;
  /** 视频/音乐：本次的秒数 */
  durationSeconds?: number;
  /** 图片：本次张数，默认 1 */
  imageCount?: number;
  /** 并发按协议分组统计 */
  protocol?: string | null;
}

export interface PlatformUsageViolation {
  reason: "daily_quota" | "global_concurrency";
  message: string;
}

/**
 * 超限返回 **429**，与 402（余额不足）、403（套餐限制）区分开。
 * 三者前端要给的引导完全不同：充值 / 升级套餐 / 等一等再来。
 */
export function platformUsageResponse(v: PlatformUsageViolation): NextResponse {
  return NextResponse.json(
    { error: v.message, code: "USAGE_LIMIT", reason: v.reason },
    { status: 429 }
  );
}

/**
 * 记一笔已完成的平台用量（图片这类同步、短、无预扣的生成路径用）。
 *
 * 为什么图片不走 `openBillingGate` 的预扣—结算三段式：图片是几秒钟的同步调用，
 * 不存在「预扣完任务飞五分钟」那段窗口，把一个 250 行的 handler 拆成 try/finally
 * 只为了拿一个能退还的记录并不划算 —— 而且失败也计入日额度对图片是可接受的
 * （200 张/天的量级下，失败重试撑不爆额度）。视频那边金额大，仍然走三段式。
 */
export async function recordPlatformUsage(
  userId: string,
  req: PlatformUsageRequest & { projectId?: string; shotId?: string; modelId?: string | null }
): Promise<void> {
  if (req.keySource !== "platform") return;
  await db.insert(usageRecords).values({
    id: ulid(),
    userId,
    projectId: req.projectId ?? null,
    shotId: req.shotId ?? null,
    kind: req.kind,
    protocol: req.protocol ?? null,
    modelId: req.modelId ?? null,
    params: JSON.stringify({
      kind: req.kind,
      durationSeconds: req.durationSeconds,
      imageCount: req.imageCount,
    }),
    creditsReserved: 0,
    creditsCharged: 0,
    status: "settled",
    keySource: "platform",
    createdAt: new Date(),
  });
}

/** 一条 usage_record 折算成的「用量单位」（视频=秒，其余=次） */
function unitsOf(kind: PlatformUsageKind, params: string | null): number {
  let parsed: { durationSeconds?: number; imageCount?: number } = {};
  try {
    parsed = params ? JSON.parse(params) : {};
  } catch {
    // 解析不了就按最小单位计 1，不要因为一条脏数据放开整个闸门
  }
  if (kind === "video") return Math.max(1, Math.ceil(parsed.durationSeconds ?? 1));
  if (kind === "image") return Math.max(1, Math.ceil(parsed.imageCount ?? 1));
  return 1;
}

function dailyLimitFor(kind: PlatformUsageKind, limits: PlatformLimits): number {
  if (kind === "video") return limits.dailyVideoSeconds;
  if (kind === "image") return limits.dailyImageCount;
  if (kind === "music") return limits.dailyMusicCount;
  return 0; // 文本便宜，不设日限
}

function unitLabel(kind: PlatformUsageKind): string {
  return kind === "video" ? "秒视频" : kind === "image" ? "张图片" : "条音乐";
}

/**
 * 生成**之前**调用。两项检查：最近 24 小时用量、全局在飞任务数。
 *
 * `keySource !== "platform"` 时直接放行且不查库 —— BYOK 一行行为都不变。
 */
export async function checkPlatformUsage(
  userId: string,
  req: PlatformUsageRequest
): Promise<PlatformUsageViolation | null> {
  if (req.keySource !== "platform") return null;

  const limits = platformLimits();

  // ── ① 全局并发（按协议）─────────────────────────────────────────────
  // 直接数 usage_records 里还 reserved 的条数：预扣到结算/退还之间正好就是
  // 任务在飞的那段时间，不需要另建任务表（与 plan-limits 的 checkConcurrency 同思路）。
  if (limits.maxInflight > 0) {
    const since = new Date(Date.now() - STALE_RESERVATION_MS);
    const conds = [
      eq(usageRecords.keySource, "platform"),
      eq(usageRecords.status, "reserved"),
      gte(usageRecords.createdAt, since),
    ];
    if (req.protocol) conds.push(eq(usageRecords.protocol, req.protocol));

    const [row] = await db
      .select({ n: count() })
      .from(usageRecords)
      .where(and(...conds));

    const running = row?.n ?? 0;
    if (running >= limits.maxInflight) {
      return {
        reason: "global_concurrency",
        message:
          `平台当前有 ${running} 个生成任务在进行（上限 ${limits.maxInflight}），` +
          `请稍后再试 —— 同时打太多会触发上游限流，反而全都变慢`,
      };
    }
  }

  // ── ② 最近 24 小时用量 ───────────────────────────────────────────────
  const limit = dailyLimitFor(req.kind, limits);
  if (limit <= 0) return null;

  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db
    .select({ params: usageRecords.params, status: usageRecords.status })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, userId),
        eq(usageRecords.keySource, "platform"),
        eq(usageRecords.kind, req.kind),
        gte(usageRecords.createdAt, since)
      )
    );

  // 退还掉的不计入：任务失败没有真的烧上游的钱，算进去等于因为一次失败罚用户一天
  const used = rows
    .filter((r) => r.status !== "refunded")
    .reduce((sum, r) => sum + unitsOf(req.kind, r.params), 0);

  const want =
    req.kind === "video"
      ? Math.max(1, Math.ceil(req.durationSeconds ?? 1))
      : req.kind === "image"
        ? Math.max(1, Math.ceil(req.imageCount ?? 1))
        : 1;

  if (used + want > limit) {
    return {
      reason: "daily_quota",
      message:
        `已达平台用量上限：最近 24 小时内你已使用 ${used}/${limit} ${unitLabel(req.kind)}` +
        `，本次还需 ${want}。请稍后再试或联系管理员调整额度。`,
    };
  }

  return null;
}
