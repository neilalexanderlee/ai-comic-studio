/**
 * POST /api/auth/login
 *
 * Body: { username, password }
 * Response: { ok: true, userId, username }
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword, makeSetCookieHeader } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    username?: string;
    password?: string;
  };

  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, userId: user.id, username: user.username });
  res.headers.set("Set-Cookie", makeSetCookieHeader(user.id));
  return res;
}
