import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { findPack, findPlan, type Plan, type CreditPack } from "./plans";
import { startPeriodSync } from "./subscription";

/**
 * 订单与支付回调。
 *
 * 状态机：
 * ```
 *   pending ──支付回调──► paid ──退款──► refunded
 *      └────超时(30分钟)──► closed
 * ```
 *
 * ## 两条不能妥协的规则
 *
 * 1. **发放积分与状态迁移必须在同一个事务里。** 支付回调重试是常态（渠道在收到 200
 *    之前会反复推送），分两步做必然重复发放。
 * 2. **`UNIQUE(channel, channel_trade_no)` 是数据库层兜底。** 即使上面的逻辑有漏，
 *    第二次入账也会被约束拒掉，而不是把积分发两次。
 *
 * ## 为什么价格要快照进订单
 *
 * 套餐定义在代码常量里（`plans.ts`），改价是改代码。订单存下单当时的
 * `plan_code` + `amount_cents` + `credits_granted`，历史订单就不会因为改价而失真。
 */

/** 订单有效期：30 分钟。超时后由 closeExpiredOrders 惰性关闭。 */
const ORDER_TTL_MS = 30 * 60 * 1000;

export type OrderKind = "subscription" | "topup";

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "OrderError";
  }
}

/**
 * Date → 数据库时间戳（**秒**）。
 * Drizzle 的 `mode:"timestamp"` 存秒；本文件有裸 SQL（为了把状态迁移与发积分放进
 * 同一个事务），必须自己换算。写成毫秒会被当成公元五万年，且不报任何错。
 */
function toDbTime(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function makeOutTradeNo(): string {
  // 可读的商户订单号：日期 + ULID 尾段。渠道侧通常有长度限制（≤64），这里远低于
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `ACS${ymd}${ulid().slice(-12)}`;
}

export interface CreatedOrder {
  orderId: string;
  outTradeNo: string;
  kind: OrderKind;
  planCode: string;
  name: string;
  amountCents: number;
  creditsGranted: number;
  channel: string;
  expiresAt: Date;
}

/** 下单。只落 pending 记录，不动任何余额。 */
export async function createOrder(params: {
  userId: string;
  kind: OrderKind;
  code: string;
  channel?: string;
}): Promise<CreatedOrder> {
  const channel = params.channel ?? "mock";

  let name: string;
  let amountCents: number;
  let creditsGranted: number;

  if (params.kind === "subscription") {
    const plan: Plan | undefined = findPlan(params.code);
    if (!plan) throw new OrderError("套餐不存在", 404);
    if (plan.priceCents <= 0) throw new OrderError("免费档无需下单", 400);
    name = plan.name;
    amountCents = plan.priceCents;
    creditsGranted = plan.creditsPerPeriod;
  } else {
    const pack: CreditPack | undefined = findPack(params.code);
    if (!pack) throw new OrderError("加油包不存在", 404);
    name = pack.name;
    amountCents = pack.priceCents;
    creditsGranted = pack.credits;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);
  const orderId = ulid();
  const outTradeNo = makeOutTradeNo();

  await db.insert(orders).values({
    id: orderId,
    userId: params.userId,
    kind: params.kind,
    planCode: params.code,
    amountCents,
    creditsGranted,
    channel,
    status: "pending",
    outTradeNo,
    channelTradeNo: null,
    expiresAt,
    createdAt: now,
  });

  return { orderId, outTradeNo, kind: params.kind, planCode: params.code, name, amountCents, creditsGranted, channel, expiresAt };
}

export interface PaymentResult {
  ok: boolean;
  /** 幂等重放时为 true —— 这笔回调之前已经入过账 */
  alreadyPaid: boolean;
  creditsGranted: number;
}

/**
 * 支付成功入账。**幂等**：同一笔渠道流水重复调用只入账一次。
 *
 * 整个过程（状态迁移 + 发积分 + 写流水 / 起订阅周期）在一个 immediate 事务里，
 * 中途任何一步失败都整体回滚 —— 不会出现「订单已支付但积分没到」或反过来。
 */
export async function markOrderPaid(params: {
  outTradeNo: string;
  channelTradeNo: string;
  rawCallback?: unknown;
  now?: Date;
}): Promise<PaymentResult> {
  const now = params.now ?? new Date();
  const raw = db.$client;

  const result = raw.transaction(() => {
    const order = raw
      .prepare(`SELECT * FROM orders WHERE out_trade_no = ?`)
      .get(params.outTradeNo) as
      | {
          id: string; user_id: string; kind: OrderKind; plan_code: string;
          amount_cents: number; credits_granted: number; channel: string;
          status: string; channel_trade_no: string | null;
        }
      | undefined;

    if (!order) return { kind: "not_found" as const };

    // 幂等：已支付的订单直接返回，不再发放。
    // 注意判断的是订单状态而不是"有没有见过这个 channelTradeNo" ——
    // 渠道重推时 channelTradeNo 相同，而 UNIQUE 约束也会挡住写入。
    if (order.status === "paid") {
      return { kind: "already" as const, credits: order.credits_granted };
    }
    if (order.status !== "pending") {
      return { kind: "bad_state" as const, status: order.status };
    }

    raw
      .prepare(
        `UPDATE orders SET status='paid', channel_trade_no=?, paid_at=?, raw_callback=? WHERE id=? AND status='pending'`
      )
      .run(
        params.channelTradeNo,
        toDbTime(now),
        params.rawCallback ? JSON.stringify(params.rawCallback) : null,
        order.id
      );

    if (order.kind === "topup") {
      // 加油包：进**永久桶**，不过期
      raw
        .prepare(
          `INSERT INTO credit_accounts (user_id, balance, frozen, subscription_balance, updated_at)
           VALUES (?, 0, 0, 0, ?) ON CONFLICT(user_id) DO NOTHING`
        )
        .run(order.user_id, toDbTime(now));
      raw
        .prepare(`UPDATE credit_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?`)
        .run(order.credits_granted, toDbTime(now), order.user_id);
      // balance_after 记的是**两个桶之和**（与 credits.ts 的 getBalance 同义）——
      // 只记永久桶的话，同一列在不同代码路径下含义不同，流水就没法用来对账了
      const acc = raw
        .prepare(
          `SELECT balance + subscription_balance AS available FROM credit_accounts WHERE user_id = ?`
        )
        .get(order.user_id) as { available: number };
      raw
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, note, created_at)
           VALUES (?, ?, 'purchase', ?, ?, 'order', ?, ?, ?)`
        )
        .run(
          ulid(), order.user_id, order.credits_granted, acc.available,
          order.id, `购买${order.plan_code}，积分永不过期`, toDbTime(now)
        );
    }

    return { kind: "paid" as const, credits: order.credits_granted, order };
  }).immediate();

  if (result.kind === "not_found") throw new OrderError("订单不存在", 404);
  if (result.kind === "bad_state") {
    throw new OrderError(`订单状态为 ${result.status}，无法支付`, 409);
  }
  if (result.kind === "already") {
    return { ok: true, alreadyPaid: true, creditsGranted: result.credits };
  }

  // 订阅：开启新周期（清零上期残留 + 发放本期积分 + 写订阅记录）。
  // 放在事务外是因为 startPeriodSync 自己是一个完整事务；订单已确定是 paid，
  // 这一步失败可由用户下次访问时的惰性滚动补上，不会丢钱。
  if (result.order.kind === "subscription") {
    const plan = findPlan(result.order.plan_code);
    if (plan) {
      startPeriodSync(result.order.user_id, plan, now, {
        reason: `购买 ${plan.name}，发放本周期积分`,
      });
    }
  }

  return { ok: true, alreadyPaid: false, creditsGranted: result.credits };
}

/** 惰性关闭超时订单。在列订单时顺手调用，同样不需要定时任务。 */
export async function closeExpiredOrders(userId: string, now = new Date()): Promise<void> {
  const raw = db.$client;
  raw
    .prepare(`UPDATE orders SET status='closed' WHERE user_id=? AND status='pending' AND expires_at < ?`)
    .run(userId, toDbTime(now));
}

export async function listOrders(userId: string, limit = 30) {
  await closeExpiredOrders(userId);
  return db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

export async function getOrderForUser(userId: string, orderId: string) {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  return row ?? null;
}
