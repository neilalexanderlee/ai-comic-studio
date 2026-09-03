import "server-only";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { creditAccounts, creditLedger, usageRecords } from "@/lib/db/schema";
import { ensureSubscriptionPeriod } from "@/lib/billing/subscription";
import { quoteCredits, type QuoteInput } from "@/lib/billing/pricing";

/**
 * 积分账户操作 —— **预扣 / 结算 / 退还** 三段式。
 *
 * 为什么不能「先生成后扣费」：视频生成是 5–10 分钟的异步长任务，
 * 生成完再扣，用户余额不足时钱已经花在上游了，追不回来。
 *
 * 为什么不能「直接扣余额」：失败要退款，退款如果只是加回余额而不留流水，
 * 账就对不上了；而且并发请求下「查余额→扣减」两步之间会有竞态。
 *
 * 所以：
 *   reserve  余额 → 冻结（原子 UPDATE，条件 balance >= amount）
 *   settle   冻结 → 扣除（成功，按真实用量对账后可少扣，差额退回余额）
 *   refund   冻结 → 余额（失败/超时，全额退回）
 *
 * 每一次变动都写 credit_ledger 流水，绝不允许只改账户不写流水。
 *
 * ## 双余额
 *
 * 账户有两个桶：`subscriptionBalance`（订阅赠送，周期末清零）与 `balance`（充值，永不过期）。
 * 消费顺序是**先花会过期的** —— 否则用户的订阅积分会白白到期作废，而永久积分被先花掉。
 *
 * 每次预扣把拆分记进 `usage_records.reservedFromSubscription`，退还时按原路反向退回。
 * 少了这个拆分就能套利：用订阅积分预扣 → 取消 → 退进永久桶，把会过期的洗成永久的。
 */

export class InsufficientCreditsError extends Error {
  constructor(
    readonly required: number,
    readonly available: number
  ) {
    super(`积分不足：需要 ${required}，可用 ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

async function ensureAccount(userId: string) {
  const [acc] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);
  if (acc) return acc;

  await db
    .insert(creditAccounts)
    .values({ userId, balance: 0, frozen: 0, updatedAt: new Date() })
    .onConflictDoNothing();
  const [created] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);
  return created;
}

/**
 * 可用余额。`balance` 是两个桶之和 —— 调用方关心的是"还能不能生成"，
 * 而不是钱从哪个桶出。需要区分来源时读 `subscription`/`permanent`。
 */
export async function getBalance(userId: string) {
  const acc = await ensureAccount(userId);
  const permanent = acc?.balance ?? 0;
  const subscription = acc?.subscriptionBalance ?? 0;
  return { balance: permanent + subscription, permanent, subscription, frozen: acc?.frozen ?? 0 };
}

async function writeLedger(params: {
  userId: string;
  type: "grant" | "purchase" | "reserve" | "settle" | "refund" | "expire";
  amount: number;
  balanceAfter: number;
  refType?: string;
  refId?: string;
  note?: string;
}) {
  await db.insert(creditLedger).values({
    id: ulid(),
    userId: params.userId,
    type: params.type,
    amount: params.amount,
    balanceAfter: params.balanceAfter,
    refType: params.refType ?? null,
    refId: params.refId ?? null,
    note: params.note ?? null,
    createdAt: new Date(),
  });
}

/** 充值 / 赠送。返回充值后的可用余额。 */
export async function grantCredits(
  userId: string,
  amount: number,
  opts?: { type?: "grant" | "purchase"; refType?: string; refId?: string; note?: string }
): Promise<number> {
  if (amount <= 0) throw new Error("充值积分必须为正数");
  await ensureAccount(userId);
  await db
    .update(creditAccounts)
    .set({ balance: sql`${creditAccounts.balance} + ${amount}`, updatedAt: new Date() })
    .where(eq(creditAccounts.userId, userId));

  const { balance } = await getBalance(userId);
  await writeLedger({
    userId,
    type: opts?.type ?? "grant",
    amount,
    balanceAfter: balance,
    refType: opts?.refType,
    refId: opts?.refId,
    note: opts?.note,
  });
  return balance;
}

export interface Reservation {
  reservationId: string;
  credits: number;
  explain: string;
}

/**
 * 生成前预扣。余额不足抛 `InsufficientCreditsError`（调用方应转成 402）。
 *
 * 原子性：扣减用带条件的单条 UPDATE（`WHERE balance >= amount`），
 * 由数据库保证并发下不会扣成负数——不要改成「先 select 再 update」。
 */
export async function reserveCredits(
  userId: string,
  input: QuoteInput,
  ctx?: { projectId?: string; shotId?: string; protocol?: string }
): Promise<Reservation> {
  const quote = quoteCredits(input);
  const reservationId = ulid();

  // 免费操作：仍然记一条 usage_record 便于统计，但不动账户
  if (quote.credits <= 0) {
    await db.insert(usageRecords).values({
      id: reservationId,
      userId,
      projectId: ctx?.projectId ?? null,
      shotId: ctx?.shotId ?? null,
      kind: input.kind,
      protocol: ctx?.protocol ?? null,
      modelId: input.modelId ?? null,
      params: JSON.stringify(input),
      creditsReserved: 0,
      creditsCharged: 0,
      status: "settled",
      createdAt: new Date(),
    });
    return { reservationId, credits: 0, explain: quote.explain };
  }

  // 先确保周期是最新的：用户可能一个月没来，本周期的积分还没发
  await ensureSubscriptionPeriod(userId);
  await ensureAccount(userId);

  const need = quote.credits;
  const raw = db.$client;

  /**
   * 双余额扣减，**先花会过期的**。
   *
   * 整段放进 better-sqlite3 的 immediate 事务里：它是同步执行的，且 SQLite 的写锁
   * 会把并发事务串行化 —— 所以「读余额 → 算拆分 → 扣减」这三步之间不存在竞态窗口，
   * 不需要再靠带条件的单条 UPDATE 去硬凑原子性（那种写法算不出拆分量）。
   *
   * 用 immediate 而不是 deferred：deferred 会先拿读锁、写时再升级，
   * 两个并发事务同时升级就会死锁；immediate 一开始就拿写锁，直接排队。
   */
  const split = raw.transaction(() => {
    const acc = raw
      .prepare(`SELECT balance, subscription_balance FROM credit_accounts WHERE user_id = ?`)
      .get(userId) as { balance: number; subscription_balance: number } | undefined;

    const permanent = acc?.balance ?? 0;
    const subscription = acc?.subscription_balance ?? 0;
    if (permanent + subscription < need) return null;

    const fromSubscription = Math.min(subscription, need);
    const fromPermanent = need - fromSubscription;

    raw
      .prepare(
        `UPDATE credit_accounts
         SET subscription_balance = subscription_balance - ?,
             balance = balance - ?,
             frozen = frozen + ?,
             updated_at = ?
         WHERE user_id = ?`
      )
      // Drizzle 的 mode:"timestamp" 存的是秒，裸 SQL 必须自己换算 —— 写毫秒不会报错，
      // 只会让这条记录的时间变成公元五万年
      .run(fromSubscription, fromPermanent, need, Math.floor(Date.now() / 1000), userId);

    return { fromSubscription, fromPermanent };
  }).immediate();

  if (!split) {
    const { balance } = await getBalance(userId);
    throw new InsufficientCreditsError(need, balance);
  }

  const { balance } = await getBalance(userId);
  await writeLedger({
    userId,
    type: "reserve",
    amount: -need,
    balanceAfter: balance,
    refType: "generation",
    refId: reservationId,
    note: quote.explain,
  });

  await db.insert(usageRecords).values({
    id: reservationId,
    userId,
    projectId: ctx?.projectId ?? null,
    shotId: ctx?.shotId ?? null,
    kind: input.kind,
    protocol: ctx?.protocol ?? null,
    modelId: input.modelId ?? null,
    params: JSON.stringify(input),
    creditsReserved: need,
    creditsCharged: 0,
    reservedFromSubscription: split.fromSubscription,
    status: "reserved",
    createdAt: new Date(),
  });

  return { reservationId, credits: quote.credits, explain: quote.explain };
}

/**
 * 生成成功后结算。
 *
 * `actualCredits` 允许小于预扣值（按上游返回的真实用量对账），差额自动退回余额。
 * 不允许大于预扣值——超出部分由平台承担，否则会出现「生成完才发现余额不够」的坏账。
 */
export async function settleCredits(
  reservationId: string,
  opts?: { actualCredits?: number; upstreamUsage?: number }
): Promise<void> {
  const [rec] = await db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.id, reservationId))
    .limit(1);
  if (!rec || rec.status !== "reserved") return; // 幂等：重复结算无副作用

  const reserved = rec.creditsReserved;
  const charged = Math.max(0, Math.min(reserved, opts?.actualCredits ?? reserved));
  const refund = reserved - charged;

  /**
   * 差额退回时**先退永久桶，再退订阅桶**。
   *
   * 方向是刻意的：这样"实际扣掉的那部分"优先落在会过期的订阅积分上，
   * 与消费顺序（先花会过期的）保持一致。反过来退的话，会出现
   * "订阅积分没花掉、却把用户的永久积分扣了"的情况。
   */
  const fromSubscription = rec.reservedFromSubscription;
  const fromPermanent = reserved - fromSubscription;
  const backToPermanent = Math.min(refund, fromPermanent);
  const backToSubscription = refund - backToPermanent;

  await db
    .update(creditAccounts)
    .set({
      frozen: sql`${creditAccounts.frozen} - ${reserved}`,
      ...(backToPermanent > 0 && { balance: sql`${creditAccounts.balance} + ${backToPermanent}` }),
      ...(backToSubscription > 0 && {
        subscriptionBalance: sql`${creditAccounts.subscriptionBalance} + ${backToSubscription}`,
      }),
      updatedAt: new Date(),
    })
    .where(eq(creditAccounts.userId, rec.userId));

  const { balance } = await getBalance(rec.userId);
  await writeLedger({
    userId: rec.userId,
    type: "settle",
    amount: -charged,
    balanceAfter: balance,
    refType: "generation",
    refId: reservationId,
    note: refund > 0 ? `实际用量少于预估，退回 ${refund}` : undefined,
  });

  await db
    .update(usageRecords)
    .set({
      creditsCharged: charged,
      upstreamUsage: opts?.upstreamUsage ?? null,
      status: "settled",
    })
    .where(eq(usageRecords.id, reservationId));
}

/** 生成失败 / 超时：全额退回。幂等。 */
export async function refundCredits(reservationId: string, note?: string): Promise<void> {
  const [rec] = await db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.id, reservationId))
    .limit(1);
  if (!rec || rec.status !== "reserved") return;

  const amount = rec.creditsReserved;
  if (amount > 0) {
    /**
     * 全额退回必须**按原路**：从订阅桶扣的退回订阅桶，从永久桶扣的退回永久桶。
     *
     * 少了这条就能套利：用会过期的订阅积分预扣 → 取消 → 全额退进永久桶，
     * 把订阅积分洗成永不过期的。
     *
     * 若期间订阅周期已滚动，退回的订阅积分归入**新周期**（跟着新周期到期）。
     * 这比退进永久桶保守 —— 它本来就是会过期的钱，不该因为一次失败的生成而升级成永久的。
     */
    const backToSubscription = rec.reservedFromSubscription;
    const backToPermanent = amount - backToSubscription;
    await db
      .update(creditAccounts)
      .set({
        frozen: sql`${creditAccounts.frozen} - ${amount}`,
        ...(backToPermanent > 0 && { balance: sql`${creditAccounts.balance} + ${backToPermanent}` }),
        ...(backToSubscription > 0 && {
          subscriptionBalance: sql`${creditAccounts.subscriptionBalance} + ${backToSubscription}`,
        }),
        updatedAt: new Date(),
      })
      .where(eq(creditAccounts.userId, rec.userId));

    const { balance } = await getBalance(rec.userId);
    await writeLedger({
      userId: rec.userId,
      type: "refund",
      amount,
      balanceAfter: balance,
      refType: "generation",
      refId: reservationId,
      note: note ?? "生成失败，全额退回",
    });
  }

  await db
    .update(usageRecords)
    .set({ creditsCharged: 0, status: "refunded" })
    .where(eq(usageRecords.id, reservationId));
}
