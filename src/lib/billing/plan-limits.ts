import "server-only";
import { NextResponse } from "next/server";
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, usageRecords } from "@/lib/db/schema";
import { isBillingEnabled } from "./gate";
import { resolveFeatures } from "./subscription";
import type { PlanFeatures } from "./plans";

/**
 * 套餐功能位的**执行**层。`plans.ts` 声明限制，`subscription.ts` 解析出当前生效的那份，
 * 这里负责在生成入口真正把它挡下来。
 *
 * ## 拒绝，而不是降级
 *
 * 能力表那边（`downgradeVideoMode`）的降级是对的：「这个模型做不到」时退而求其次，
 * 总比报错强。但套餐限制是另一回事 —— 那是「你还没为这个付费」。
 * 悄悄把 720p 降成 480p，用户会**照着 720p 的预期付掉积分**、拿到一段 480p 的片子，
 * 而且看不出哪里出了问题。所以套餐限制一律**当场拒绝**并说清楚差在哪，
 * 由用户决定是升级套餐还是改用便宜档位。
 *
 * ## 未启用计费时全部不生效
 *
 * 与 `gate.ts` / `resolveFeatures` 同一条原则：自部署用户带自己的 API Key，
 * 任何功能限制都是纯添堵。每个检查函数开头都直接短路，连库都不查。
 */

/** 判定为「僵尸预扣」的时限。超过它的 reserved 记录不计入并发。 */
const STALE_RESERVATION_MS = 15 * 60 * 1000;

export interface PlanLimitViolation {
  /** 机器可读的原因，前端据此决定引导去哪（升级套餐 / 换模型 / 等待） */
  reason: "resolution" | "model" | "concurrency" | "projects";
  message: string;
}

/**
 * 套餐限制统一返回 **403**，而不是 402。
 *
 * 402 已经是「余额不足」的语义 —— 充值能解决。而套餐限制充多少积分都没用，
 * 必须换档位或换模型，前端要给的是完全不同的引导。
 *
 * 这里返回 403 也不违反「一律 404」那条约定：那条针对的是资源归属
 * （403 会泄漏「这个 id 存在但不是你的」，可用来枚举）。套餐限制不涉及任何
 * 资源是否存在的信息，说清楚原因才是对的。
 */
export function planLimitResponse(v: PlanLimitViolation): NextResponse {
  return NextResponse.json(
    { error: v.message, code: "PLAN_LIMIT", reason: v.reason },
    { status: 403 }
  );
}

/**
 * 分辨率字符串 → 可比较的数值（按高度）。
 *
 * 各家的写法并不统一：`480p` / `720P` / `768P` / `1080p` / `2K` / `4k` 都在能力表里出现过。
 * **认不出来的一律返回 0（= 永不触发限制）** —— 新加一个没见过的写法时，
 * 宁可漏挡也不要把付费用户挡在门外。
 */
export function resolutionRank(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = String(raw).trim().toLowerCase();
  if (s === "4k") return 2160;
  if (s === "2k") return 1440;
  const m = s.match(/^(\d+)\s*p$/);
  return m ? Number(m[1]) : 0;
}

/** 纯函数部分：模型档位与分辨率。可离线测试，不碰数据库。 */
export function checkVideoPlanLimits(
  features: PlanFeatures,
  params: { modelId?: string | null; resolution?: string | null }
): PlanLimitViolation | null {
  const families = features.allowedVideoFamilies;
  if (families.length > 0) {
    const id = (params.modelId ?? "").toLowerCase();
    // 没传 modelId 时不挡：调用方本来就没声明用哪个模型，挡了也说不清挡的是什么
    if (id && !families.some((f) => id.includes(f.toLowerCase()))) {
      return {
        reason: "model",
        message: `当前套餐只能使用 ${families.join(" / ")} 档位的视频模型，请升级套餐或改用这些模型`,
      };
    }
  }

  const want = resolutionRank(params.resolution);
  const cap = resolutionRank(features.maxResolution);
  if (want > 0 && cap > 0 && want > cap) {
    return {
      reason: "resolution",
      message: `当前套餐最高支持 ${features.maxResolution}，本次请求的 ${params.resolution} 需要升级套餐`,
    };
  }

  return null;
}

/**
 * 并发上限。
 *
 * 「正在进行的任务数」直接数 `usage_records` 里 `status='reserved'` 的条数 ——
 * 预扣到结算/退还之间正好就是任务在飞的那段时间，不需要另建一张任务表。
 *
 * ⚠️ 只数 15 分钟内的。进程在预扣与结算之间崩掉会留下永远 reserved 的记录，
 * 全都算上的话用户会被自己的历史残骸永久锁死。
 * （这些残骸同时也冻结着积分，那是另一个问题 —— 自动退还有「任务其实成功了、
 * 钱却退了」的风险，需要单独决策，这里只是不让它们影响并发。）
 */
export async function checkConcurrency(
  userId: string,
  features: PlanFeatures
): Promise<PlanLimitViolation | null> {
  if (!isBillingEnabled()) return null;
  const limit = features.maxConcurrentJobs;
  if (!Number.isFinite(limit) || limit >= Number.MAX_SAFE_INTEGER) return null;

  const since = new Date(Date.now() - STALE_RESERVATION_MS);
  const [row] = await db
    .select({ n: count() })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, userId),
        eq(usageRecords.status, "reserved"),
        gte(usageRecords.createdAt, since)
      )
    );

  const running = row?.n ?? 0;
  if (running >= limit) {
    return {
      reason: "concurrency",
      message: `当前套餐最多同时进行 ${limit} 个生成任务（正在进行 ${running} 个），请等待完成或升级套餐`,
    };
  }
  return null;
}

/** 项目数量上限。在创建项目时检查。 */
export async function checkProjectQuota(
  userId: string,
  features: PlanFeatures
): Promise<PlanLimitViolation | null> {
  if (!isBillingEnabled()) return null;
  const limit = features.maxProjects;
  if (limit === null) return null;

  const [row] = await db
    .select({ n: count() })
    .from(projects)
    .where(eq(projects.userId, userId));

  const owned = row?.n ?? 0;
  if (owned >= limit) {
    return {
      reason: "projects",
      message: `当前套餐最多创建 ${limit} 个项目（已有 ${owned} 个），请删除旧项目或升级套餐`,
    };
  }
  return null;
}

/**
 * 视频生成入口的完整检查：档位 + 分辨率 + 并发。
 *
 * 顺序是刻意的：**先做不查库的纯判断**。模型档位不对时没必要再去数并发。
 */
export async function checkVideoGenerationAllowed(
  userId: string,
  params: { modelId?: string | null; resolution?: string | null }
): Promise<PlanLimitViolation | null> {
  if (!isBillingEnabled()) return null;
  const features = await resolveFeatures(userId);
  return checkVideoPlanLimits(features, params) ?? (await checkConcurrency(userId, features));
}
