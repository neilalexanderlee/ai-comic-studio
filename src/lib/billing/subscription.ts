import "server-only";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { creditAccounts, creditLedger, subscriptions } from "@/lib/db/schema";
import { FREE_PLAN_CODE, findPlan, freePlan, UNLIMITED_FEATURES, type Plan, type PlanFeatures } from "./plans";
import { isBillingEnabled } from "./gate";

/**
 * 订阅周期的**惰性滚动**。
 *
 * ## 为什么不用定时任务
 *
 * 这个项目没有 worker / 调度器基础设施（ffmpeg 导出都还跑在 web 进程里）。
 * 为了每月发一次积分去引入一整套调度，代价和风险都不成比例 —— 而且定时任务本身
 * 还要解决"漏跑了怎么补"。
 *
 * 惰性滚动把这件事变成纯函数式的：**每次读账户时检查周期是否已过，过了就当场滚动**。
 * 天然幂等（滚过的周期不会再滚），天然补偿（用户一个月没来，下次来时按当前时间落到正确周期），
 * 也不存在"任务没跑起来所以没发积分"这种故障模式。
 *
 * ## 一次滚动做两件事，必须在同一个事务里
 *
 *   1. 旧周期未用完的订阅积分**清零**，写一条 `expire` 流水
 *   2. 新周期的积分**发放**，写一条 `grant` 流水
 *
 * 分两步做，中间失败会留下"已清零但没发放"的账户 —— 用户凭空少一个月产能。
 */

export interface SubscriptionState {
  planCode: string;
  plan: Plan;
  status: "active" | "canceled" | "expired";
  periodStart: Date;
  periodEnd: Date;
  autoRenew: boolean;
}

/**
 * Date → 数据库里的时间戳。
 *
 * ⚠️ Drizzle 的 `integer({ mode: "timestamp" })` 存的是**秒**，不是毫秒
 * （`timestamp_ms` 才是毫秒）。走 Drizzle 的 `.set({ updatedAt: new Date() })` 会自动换算，
 * 但本文件里有若干条裸 SQL（为了在一个事务里完成多步操作），那些必须自己换算。
 *
 * 写错的后果非常隐蔽：毫秒值被当成秒读出来会变成公元五万年，于是
 * 「周期是否已过」永远为否 —— 订阅周期再也不会滚动，而且不报任何错。
 * 这个 bug 已经被 credits-subscription.test.ts 抓到过一次。
 */
function toDbTime(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * 确保用户处于一个有效的订阅周期，必要时滚动。返回滚动后的状态。
 *
 * 没有订阅记录的用户会被落到免费档 —— 免费档也是订阅，只是价格为 0，
 * 这样"发积分"这件事只有一条代码路径。
 */
export async function ensureSubscriptionPeriod(userId: string, now = new Date()): Promise<SubscriptionState> {
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (!existing) {
    return startPeriod(userId, freePlan(), now, { reason: "首次进入，落到免费档" });
  }

  const plan = findPlan(existing.planCode) ?? freePlan();

  // 周期还没结束：什么都不做
  if (existing.periodEnd > now) {
    return {
      planCode: existing.planCode,
      plan,
      status: existing.status,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      autoRenew: existing.autoRenew === 1,
    };
  }

  // 周期已过。取消/不续期的付费档回落到免费档；否则按原档续期。
  const nextPlan =
    existing.status === "canceled" || existing.autoRenew !== 1 ? freePlan() : plan;

  // 用户可能很久没来，一次跨了好几个周期 —— 直接从"现在"起算新周期，
  // 而不是循环补发中间那些月份（那些产能他本来也没用上，补发等于白送）
  return startPeriod(userId, nextPlan, now, {
    reason:
      nextPlan.code === plan.code
        ? `周期到期，按 ${nextPlan.name} 续期`
        : `${plan.name} 已到期且不续期，回落到 ${nextPlan.name}`,
  });
}

/**
 * 开启一个新周期：清零上一周期的订阅积分 + 发放新周期积分 + 写订阅记录。
 *
 * 整个过程在一个 better-sqlite3 事务里完成。
 */
export function startPeriodSync(
  userId: string,
  plan: Plan,
  now: Date,
  opts?: { reason?: string; keepStatus?: "active" | "canceled" }
): SubscriptionState {
  const periodStart = now;
  const periodEnd = addDays(now, plan.periodDays);

  const raw = db.$client;
  const tx = raw.transaction(() => {
    // ── 账户：先确保存在 ──────────────────────────────────────────────────
    raw
      .prepare(
        `INSERT INTO credit_accounts (user_id, balance, frozen, subscription_balance, updated_at)
         VALUES (?, 0, 0, 0, ?) ON CONFLICT(user_id) DO NOTHING`
      )
      .run(userId, toDbTime(now));

    const acc = raw
      .prepare(`SELECT balance, subscription_balance FROM credit_accounts WHERE user_id = ?`)
      .get(userId) as { balance: number; subscription_balance: number } | undefined;

    const stale = acc?.subscription_balance ?? 0;

    // ── 1. 旧周期残留清零 ─────────────────────────────────────────────────
    /**
     * 流水里的 `balance_after` 一律是**两个桶之和**（与 credits.ts 的 getBalance 同义），
     * 且必须在改完账户之后重新读 —— 用事务开始时那份 `acc` 会记成改动前的数字。
     * 同一列在不同路径下含义不同的话，流水就没法用来对账。
     */
    const availableNow = (): number =>
      (
        raw
          .prepare(
            `SELECT balance + subscription_balance AS available FROM credit_accounts WHERE user_id = ?`
          )
          .get(userId) as { available: number } | undefined
      )?.available ?? 0;

    if (stale > 0) {
      raw
        .prepare(`UPDATE credit_accounts SET subscription_balance = 0, updated_at = ? WHERE user_id = ?`)
        .run(toDbTime(now), userId);
      raw
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, note, created_at)
           VALUES (?, ?, 'expire', ?, ?, 'subscription', ?, ?, ?)`
        )
        .run(
          ulid(),
          userId,
          -stale,
          availableNow(),
          plan.code,
          `上一订阅周期结束，未用完的 ${stale} 积分作废`,
          toDbTime(now)
        );
    }

    // ── 2. 新周期发放 ─────────────────────────────────────────────────────
    if (plan.creditsPerPeriod > 0) {
      raw
        .prepare(
          `UPDATE credit_accounts
           SET subscription_balance = ?, subscription_expires_at = ?, updated_at = ?
           WHERE user_id = ?`
        )
        .run(plan.creditsPerPeriod, toDbTime(periodEnd), toDbTime(now), userId);
      raw
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, note, created_at)
           VALUES (?, ?, 'grant', ?, ?, 'subscription', ?, ?, ?)`
        )
        .run(
          ulid(),
          userId,
          plan.creditsPerPeriod,
          availableNow(),
          plan.code,
          opts?.reason ?? `${plan.name} 周期积分发放`,
          toDbTime(now)
        );
    } else {
      raw
        .prepare(
          `UPDATE credit_accounts SET subscription_expires_at = ?, updated_at = ? WHERE user_id = ?`
        )
        .run(toDbTime(periodEnd), toDbTime(now), userId);
    }

    // ── 3. 订阅记录 ───────────────────────────────────────────────────────
    raw
      .prepare(
        `INSERT INTO subscriptions (id, user_id, plan_code, status, period_start, period_end, auto_renew, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           plan_code = excluded.plan_code,
           status = excluded.status,
           period_start = excluded.period_start,
           period_end = excluded.period_end,
           auto_renew = excluded.auto_renew,
           updated_at = excluded.updated_at`
      )
      .run(
        ulid(),
        userId,
        plan.code,
        opts?.keepStatus ?? "active",
        toDbTime(periodStart),
        toDbTime(periodEnd),
        // 免费档永远自动续（它就是兜底档）；付费档默认续期，用户可关
        plan.code === FREE_PLAN_CODE ? 1 : 1,
        toDbTime(now),
        toDbTime(now)
      );
  });
  tx();

  return {
    planCode: plan.code,
    plan,
    status: opts?.keepStatus ?? "active",
    periodStart,
    periodEnd,
    autoRenew: true,
  };
}

async function startPeriod(
  userId: string,
  plan: Plan,
  now: Date,
  opts?: { reason?: string }
): Promise<SubscriptionState> {
  return startPeriodSync(userId, plan, now, opts);
}

/**
 * 当前生效的功能位。
 *
 * ⚠️ **未启用计费时一律返回无限制** —— 自部署用户带自己的 API Key，
 * 任何限制都是纯粹添堵。这与 `gate.ts` 的空操作语义是同一条原则。
 */
export async function resolveFeatures(userId: string): Promise<PlanFeatures> {
  if (!isBillingEnabled()) return UNLIMITED_FEATURES;
  const state = await ensureSubscriptionPeriod(userId);
  return state.plan.features;
}

/** 取消续期：当前周期照常用完，到期后回落免费档。 */
export async function cancelAutoRenew(userId: string): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status: "canceled", autoRenew: 0, updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));
}

/** 读订阅 + 双余额，供账户页展示。会顺手滚动周期。 */
export async function getAccountOverview(userId: string) {
  const state = await ensureSubscriptionPeriod(userId);
  const [acc] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);
  return {
    subscription: state,
    /** 会过期的（本周期赠送） */
    subscriptionBalance: acc?.subscriptionBalance ?? 0,
    subscriptionExpiresAt: acc?.subscriptionExpiresAt ?? null,
    /** 永久的（充值/加油包） */
    permanentBalance: acc?.balance ?? 0,
    frozen: acc?.frozen ?? 0,
    total: (acc?.subscriptionBalance ?? 0) + (acc?.balance ?? 0),
  };
}

/** 最近流水 */
export async function listLedger(userId: string, limit = 50) {
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(creditLedger.createdAt)
    .limit(limit);
}
