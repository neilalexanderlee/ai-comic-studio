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
     * 平台 Key 当前解析到哪个账号 —— **所有管理端角色都返回**。
     *
     * 这里原先只回给 owner，理由是「不要向运营 admin 指出上游密钥在谁手里」。
     * 那条理由站不住：同一份响应里每个用户的 `role` 都在，而界面上 owner 的徽章
     * 原文就写着「可配置模型密钥」—— 想藏的那件事，旁边一行就说清楚了。
     * 就算把徽章也去掉，还有三条路照样能认出 owner：PATCH 到 owner 会回
     * 「只有 owner 可以操作 owner 账号」（逐个 id 试即可定位）、用量面板里
     * 唯一缺席的那个账号就是他（owner 的生成记为 keySource=user，不入表）、
     * 以及邀请码的 `created_by`。
     *
     * 更根本的是：**知道 owner 是谁并不能拿到 Key**。拦着的是 `isKeyOwner()`、
     * 密钥与端点的同源不变量、以及 owner 账号自身的认证 —— 没有一层依赖
     * 「admin 不知道 owner 是谁」。留着那个特例只是一层看起来在防、实际不防的保护，
     * 比不防更糟：它会让人以为这里有边界。
     *
     * 它真正的用途是回答「Key 配在哪个账号上才生效」—— 多个 owner 时
     * 只有创建最早的那个生效，这件事 role 推不出来。
     */
    platformKeyOwnerId: await getPlatformKeyOwnerId(),
    currentUserId: guard.userId,
    /** 当前操作者的角色 —— 前端据此决定显示哪些按钮（真正的准入在 PATCH 那边） */
    currentUserRole: actorRole,
  });
}
