/**
 * GET /api/admin/users —— 用户列表（仅管理员）。
 *
 * 只回必要字段：不返回 password_hash，也不返回任何密钥。
 */
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/api-guard";
import { getPlatformKeyOwnerId, roleOf } from "@/lib/admin";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  const actorRole = await roleOf(guard.userId);

  return NextResponse.json({
    users: rows,
    /**
     * 平台 Key 挂在谁名下 —— **只回给 owner**。
     *
     * 它的用途是提醒 owner「别停用这个账号」（停了全站生成当场失效）。
     * 而运营 admin 本来就停不了 owner，拿到这条信息没有任何用途，
     * 却精确指出了「上游密钥在哪个账号手里」—— 对一个被明确排除在密钥之外的角色，
     * 这是没必要的暴露：它把最高价值的目标直接标了出来。
     */
    platformKeyOwnerId: actorRole === "owner" ? await getPlatformKeyOwnerId() : null,
    currentUserId: guard.userId,
    /** 当前操作者的角色 —— 前端据此决定显示哪些按钮（真正的准入在 PATCH 那边） */
    currentUserRole: actorRole,
  });
}
