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
import {
  checkRegisterAllowed,
  clientIpOf,
  recordRegisterAttempt,
} from "@/lib/auth-rate-limit";
import { hasAnyUser, roleForNewUser } from "@/lib/admin";
import { inviteRejectionMessage, redeemInviteCode } from "@/lib/invite-codes";
import { registrationConflictHint, resolveRegistrationMode } from "@/lib/registration";

export async function POST(req: NextRequest) {
  const mode = resolveRegistrationMode();
  if (mode === "closed") {
    // 两个开关打架时说清楚是哪一个把门关上了，否则只会看到「未开放注册」而无从下手
    const hint = registrationConflictHint();
    if (hint) console.warn(`[register] ${hint}`);
    return NextResponse.json({ error: "本站未开放注册" }, { status: 403 });
  }

  const body = (await req.json()) as {
    username?: string;
    password?: string;
    inviteCode?: string;
  };

  const username = body.username?.trim();
  const password = body.password;

  if (!username || username.length < 2) {
    return NextResponse.json({ error: "用户名至少 2 个字符" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 个字符" }, { status: 400 });
  }

  // 邀请码是**唯一还立着的准入闸**（支付上线前平台 Key 没有计费闸门兜底），
  // 所以限速要在校验码之前 —— 放在后面等于提供一个免费的爆破接口。
  const ip = clientIpOf(req);

  // ⚠️ 空库豁免：那一刻不可能有人发过邀请码（发码要管理员，管理员要注册才有），
  // 不豁免的话「空库 + invite」是个谁都进不去的死锁。详见 lib/admin.ts 的 hasAnyUser。
  const needInvite = mode === "invite" && (await hasAnyUser());

  if (needInvite) {
    const verdict = checkRegisterAllowed(ip);
    if (verdict.blocked) {
      return NextResponse.json(
        { error: `尝试过于频繁，请 ${Math.ceil(verdict.retryAfterSeconds / 60)} 分钟后再试` },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
      );
    }
    if (!body.inviteCode?.trim()) {
      return NextResponse.json({ error: "本站为邀请制，请填写邀请码" }, { status: 400 });
    }
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

  // 先占用邀请码再建号：反过来的话「码已用完」会留下一个建好却进不去的账号。
  // 占用失败不影响后续请求（码没被消耗），只记一次限速计数。
  if (needInvite) {
    const redeemed = await redeemInviteCode(body.inviteCode!, userId);
    if (!redeemed.ok) {
      recordRegisterAttempt(ip);
      return NextResponse.json(
        { error: inviteRejectionMessage(redeemed.reason) },
        { status: 403 }
      );
    }
  }

  const passwordHash = await hashPassword(password);
  // 空库且未设 ADMIN_USERNAMES 时，第一个注册的人是管理员（自部署装机即用）；
  // 已有库永远走不到这条，那边由 ADMIN_USERNAMES 授予。见 lib/admin.ts
  const role = await roleForNewUser();

  await db.insert(users).values({
    id: userId,
    username,
    passwordHash,
    role,
    createdAt: new Date(),
  });

  // 匿名数据迁移由客户端调用 /api/auth/migrate-data 完成（带参数绑定，无注入风险）
  const res = NextResponse.json({ ok: true, userId, username, role });
  res.headers.set("Set-Cookie", makeSetCookieHeader(userId, 0, req));
  return res;
}
