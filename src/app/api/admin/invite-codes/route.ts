/**
 * 邀请码管理（仅管理员）。
 *
 * GET  → 列出全部邀请码
 * POST → 新建一个（Body: { note?, maxUses?, expiresInDays? }）
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-guard";
import { createInviteCode, listInviteCodes } from "@/lib/invite-codes";
import { resolveRegistrationMode } from "@/lib/registration";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    mode: resolveRegistrationMode(),
    codes: await listInviteCodes(),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    note?: string;
    maxUses?: number;
    expiresInDays?: number | null;
  };

  const code = await createInviteCode({
    createdBy: guard.userId,
    note: body.note,
    maxUses: body.maxUses,
    expiresInDays: body.expiresInDays ?? null,
  });
  return NextResponse.json({ ok: true, code });
}
