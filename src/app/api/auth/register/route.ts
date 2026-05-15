/**
 * POST /api/auth/register
 *
 * 注册新账号，注册成功后自动登录（设置 httpOnly cookie）。
 *
 * Body: { username, password, migrateFromUserId? }
 *   migrateFromUserId — 若传入，将该匿名 ID 下的所有数据迁移到新账号
 *
 * Response: { ok: true, userId, username }
 */
import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, makeSetCookieHeader } from "@/lib/auth";

/** 将旧匿名 userId 下的所有数据批量迁移到新 userId */
async function migrateAnonymousData(oldId: string, newId: string) {
  const tables = [
    "projects",
    "provider_secrets",
    "prompt_templates",
    "prompt_presets",
    "user_client_prefs",
  ];
  for (const table of tables) {
    try {
      await db.run(
        sql.raw(`UPDATE "${table}" SET user_id = '${newId}' WHERE user_id = '${oldId}'`)
      );
    } catch {
      // 表可能不存在或字段名不同，静默跳过
    }
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    username?: string;
    password?: string;
    migrateFromUserId?: string;
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

  // 迁移旧匿名数据（如果提供了旧 ID）
  const migrateFrom = body.migrateFromUserId?.trim();
  if (migrateFrom && migrateFrom !== userId) {
    await migrateAnonymousData(migrateFrom, userId);
  }

  const res = NextResponse.json({ ok: true, userId, username });
  res.headers.set("Set-Cookie", makeSetCookieHeader(userId));
  return res;
}
