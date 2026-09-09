import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { inviteCodeUses, inviteCodes } from "@/lib/db/schema";

/**
 * 邀请码 —— 注册准入的凭据。
 *
 * 码是 10 位 Crockford base32（≈50 bit 熵），配合注册接口的按 IP 限速，
 * 爆破不成立。**不做「猜到就试」的防护之外的复杂设计** —— 当前规模是几个熟人，
 * 过度设计比漏洞更可能成为负担。
 */

/** 去掉容易看错的 I / L / O / U */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateInviteCode(len = 10): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 用户输入容错：大小写、空格、连字符都不该导致「码无效」 */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

export type InviteRejection = "not_found" | "revoked" | "expired" | "exhausted";

const REJECT_TEXT: Record<InviteRejection, string> = {
  not_found: "邀请码无效",
  revoked: "该邀请码已作废",
  expired: "该邀请码已过期",
  exhausted: "该邀请码的可用次数已用完",
};

export function inviteRejectionMessage(r: InviteRejection): string {
  return REJECT_TEXT[r];
}

export interface InviteCodeRow {
  id: string;
  code: string;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * 校验并**占用**一次邀请码。
 *
 * 占用是一条带条件的原子 UPDATE（`used_count < max_uses` 写在 WHERE 里），
 * 所以两个人同时用同一个只剩一次的码，只有一个会成功 ——
 * 「先查后写」在这里会真的多放一个人进来。
 */
export async function redeemInviteCode(
  rawCode: string,
  userId: string
): Promise<{ ok: true; codeId: string } | { ok: false; reason: InviteRejection }> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: "not_found" };

  const [row] = await db
    .select({
      id: inviteCodes.id,
      maxUses: inviteCodes.maxUses,
      usedCount: inviteCodes.usedCount,
      expiresAt: inviteCodes.expiresAt,
      revokedAt: inviteCodes.revokedAt,
    })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const res = await db
    .update(inviteCodes)
    .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
    .where(
      and(
        eq(inviteCodes.id, row.id),
        sql`${inviteCodes.usedCount} < ${inviteCodes.maxUses}`,
        sql`${inviteCodes.revokedAt} IS NULL`
      )
    );

  // better-sqlite3 driver 会回 { changes }，其他 driver 未必 —— 拿不到就再读一次校验
  const changed = (res as unknown as { changes?: number })?.changes;
  if (changed === 0) return { ok: false, reason: "exhausted" };
  if (changed === undefined) {
    const [after] = await db
      .select({ usedCount: inviteCodes.usedCount, maxUses: inviteCodes.maxUses })
      .from(inviteCodes)
      .where(eq(inviteCodes.id, row.id))
      .limit(1);
    if (after && after.usedCount > after.maxUses) return { ok: false, reason: "exhausted" };
  }

  await db.insert(inviteCodeUses).values({
    id: ulid(),
    codeId: row.id,
    userId,
    usedAt: new Date(),
  });

  return { ok: true, codeId: row.id };
}

export async function createInviteCode(args: {
  createdBy: string;
  note?: string | null;
  maxUses?: number;
  expiresInDays?: number | null;
}): Promise<InviteCodeRow> {
  const maxUses = Math.max(1, Math.min(1000, Math.floor(args.maxUses ?? 1)));
  const expiresAt =
    args.expiresInDays && args.expiresInDays > 0
      ? new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const row = {
    id: ulid(),
    code: generateInviteCode(),
    note: args.note?.trim() || null,
    createdBy: args.createdBy,
    maxUses,
    usedCount: 0,
    expiresAt,
    revokedAt: null,
    createdAt: new Date(),
  };
  await db.insert(inviteCodes).values(row);
  return row;
}

export async function listInviteCodes(): Promise<InviteCodeRow[]> {
  return db
    .select({
      id: inviteCodes.id,
      code: inviteCodes.code,
      note: inviteCodes.note,
      maxUses: inviteCodes.maxUses,
      usedCount: inviteCodes.usedCount,
      expiresAt: inviteCodes.expiresAt,
      revokedAt: inviteCodes.revokedAt,
      createdAt: inviteCodes.createdAt,
    })
    .from(inviteCodes)
    .orderBy(desc(inviteCodes.createdAt));
}

/** 作废是软删除：删掉记录就查不出这个码带进来过谁 */
export async function revokeInviteCode(id: string): Promise<void> {
  await db
    .update(inviteCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(inviteCodes.id, id), sql`${inviteCodes.revokedAt} IS NULL`));
}
