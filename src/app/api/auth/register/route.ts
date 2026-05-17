/**
 * POST /api/auth/register
 *
 * 注册新账号，注册成功后自动登录（设置 httpOnly cookie）。
 *
 * Body: { username, password }
 *   注意：匿名数据迁移由客户端在注册成功后调用 /api/auth/migrate-data 完成，
 *   不再由本路由直接处理（避免 SQL 注入风险）。
 *
 * Response: { ok: true, userId, username }
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, makeSetCookieHeader } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    username?: string;
    password?: string;
  };

  const username = body.username?.trim();
  const password = body.password;

  if (!username || username.length < 2) {
    return NextResponse.json({ error: "用户名至少 2 个字符" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 个字符" }, { status: 400 });
  }

  // 检查用户名是否已存在
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (existing) {
    return NextResponse.json({ error: "用户名已被使用" }, { status: 409 });
  }

  const userId = ulid();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    id: userId,
    username,
    passwordHash,
    createdAt: new Date(),
  });

  // 匿名数据迁移由客户端调用 /api/auth/migrate-data 完成（带参数绑定，无注入风险）
  const res = NextResponse.json({ ok: true, userId, username });
  res.headers.set("Set-Cookie", makeSetCookieHeader(userId));
  return res;
}
