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
import { getPlatformKeyOwnerId } from "@/lib/admin";

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

  return NextResponse.json({
    users: rows,
    /** 平台 Key 挂在谁名下 —— 界面上要标出来，避免误停用那个账号 */
    platformKeyOwnerId: await getPlatformKeyOwnerId(),
    currentUserId: guard.userId,
  });
}
