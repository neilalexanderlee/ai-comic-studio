/**
 * POST /api/auth/change-password
 *
 * Body: { currentPassword, newPassword }
 *
 * 改密之后**其他设备上的登录态全部失效**（自增 token_version），
 * 只有发起这次改密的这台设备会拿到新 cookie 继续用。
 * 这正是改密该有的语义 —— 怀疑号被盗时改一次密码就能把对方踢下去；
 * 若不失效，改密对已经泄漏出去的 cookie 毫无作用。
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  bumpUserTokenVersion,
  getFreshAuthUserId,
  hashPassword,
  makeSetCookieHeader,
  verifyPassword,
} from "@/lib/auth";
import {
  checkLoginAllowed,
  clientIpOf,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/auth-rate-limit";

export async function POST(req: NextRequest) {
  // 用异步强校验：改密是高价值操作，被撤销的会话不该还能改密码
  const userId = await getFreshAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const body = (await req.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const current = body.currentPassword;
  const next = body.newPassword;

  if (!current || !next) {
    return NextResponse.json({ error: "请填写当前密码和新密码" }, { status: 400 });
  }
  if (next.length < 6) {
    return NextResponse.json({ error: "新密码至少 6 个字符" }, { status: 400 });
  }
  if (next === current) {
    return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
  }

  const [user] = await db
    .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  // ⚠️ 限速必须在校验当前密码**之前**。拿到一张 cookie 之后，这个接口就是一个
  // 猜密码的入口（猜中即可改密夺号），和登录接口是同一类攻击面。
  // 与登录共用同一套计数器：换个入口爆破不该重置计数。
  const ip = clientIpOf(req);
  const verdict = checkLoginAllowed(ip, user.username);
  if (verdict.blocked) {
    return NextResponse.json(
      { error: `尝试过于频繁，请 ${Math.ceil(verdict.retryAfterSeconds / 60)} 分钟后再试` },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }

  if (!(await verifyPassword(current, user.passwordHash))) {
    recordLoginFailure(ip, user.username);
    return NextResponse.json({ error: "当前密码不正确" }, { status: 403 });
  }
  recordLoginSuccess(ip, user.username);

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, userId));

  // 踢掉所有旧会话（含本机这张），再给本机补发一张新的 —— 顺序不能反：
  // 先发新 cookie 再自增版本号的话，刚发出去的那张也会当场失效。
  await bumpUserTokenVersion(userId);
  const [fresh] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", makeSetCookieHeader(userId, fresh?.tokenVersion ?? 0, req));
  return res;
}
