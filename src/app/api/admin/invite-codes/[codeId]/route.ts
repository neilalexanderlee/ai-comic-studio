/**
 * DELETE /api/admin/invite-codes/[codeId] —— 作废一个邀请码。
 *
 * 是**软删除**（写 revoked_at）而不是真删：删掉记录就查不出这个码带进来过谁，
 * 而「顺着一个泄露的码把它带进来的账号全停掉」正是这张表存在的理由之一。
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-guard";
import { revokeInviteCode } from "@/lib/invite-codes";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ codeId: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { codeId } = await params;
  await revokeInviteCode(codeId);
  return NextResponse.json({ ok: true });
}
