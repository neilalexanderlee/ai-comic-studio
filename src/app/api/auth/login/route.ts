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
import {
  checkLoginAllowed,
  clientIpOf,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/auth-rate-limit";

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

  // 限速要在**查库和校验密码之前** —— 放在后面等于每次爆破尝试都白跑一遍
  // scrypt，攻击者反而拿到了一个放大 CPU 消耗的手柄。
  const ip = clientIpOf(req);
  const verdict = checkLoginAllowed(ip, username);
  if (verdict.blocked) {
    return NextResponse.json(
      { error: `尝试过于频繁，请 ${Math.ceil(verdict.retryAfterSeconds / 60)} 分钟后再试` },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!user) {
    recordLoginFailure(ip, username);
    // 用户名不存在与密码错误返回同一句话：区分开等于送对方一个用户名枚举接口
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    recordLoginFailure(ip, username);
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }
  // 成功即清零：否则自己打错几次密码会把自己锁在外面
  recordLoginSuccess(ip, username);

  const res = NextResponse.json({ ok: true, userId: user.id, username: user.username });
  // 带上当前会话版本号：之后自增该字段即可让这张 cookie 失效
  res.headers.set("Set-Cookie", makeSetCookieHeader(user.id, user.tokenVersion, req));
  return res;
}
