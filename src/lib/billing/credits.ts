import "server-only";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { creditAccounts, creditLedger, usageRecords } from "@/lib/db/schema";
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

export async function getBalance(userId: string) {
  const acc = await ensureAccount(userId);
  return { balance: acc?.balance ?? 0, frozen: acc?.frozen ?? 0 };
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

  await ensureAccount(userId);

  const res = await db
    .update(creditAccounts)
    .set({
      balance: sql`${creditAccounts.balance} - ${quote.credits}`,
      frozen: sql`${creditAccounts.frozen} + ${quote.credits}`,
      updatedAt: new Date(),
    })
    .where(sql`${creditAccounts.userId} = ${userId} AND ${creditAccounts.balance} >= ${quote.credits}`);

  // better-sqlite3 driver 返回 { changes }
  const changed = (res as unknown as { changes?: number })?.changes ?? 0;
  if (changed === 0) {
    const { balance } = await getBalance(userId);
    throw new InsufficientCreditsError(quote.credits, balance);
  }

  const { balance } = await getBalance(userId);
  await writeLedger({
    userId,
    type: "reserve",
    amount: -quote.credits,
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
    creditsReserved: quote.credits,
    creditsCharged: 0,
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

  await db
    .update(creditAccounts)
    .set({
      frozen: sql`${creditAccounts.frozen} - ${reserved}`,
      ...(refund > 0 && { balance: sql`${creditAccounts.balance} + ${refund}` }),
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
    await db
      .update(creditAccounts)
      .set({
        frozen: sql`${creditAccounts.frozen} - ${amount}`,
        balance: sql`${creditAccounts.balance} + ${amount}`,
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
