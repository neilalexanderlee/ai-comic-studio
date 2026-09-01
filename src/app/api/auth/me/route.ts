/**
 * GET /api/auth/me — 返回当前登录用户信息
 * Response: { loggedIn: true, userId, username } | { loggedIn: false }
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getFreshAuthUserId } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // 用异步强校验：除签名和过期外，还比对 DB 里的 token_version。
  // 前端靠这个接口判断登录态，被撤销的会话应当在这里就掉线。
  const userId = await getFreshAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ loggedIn: false });
  }

  const [user] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    // cookie 有效但用户不在 DB（极少见），清除 cookie
    const res = NextResponse.json({ loggedIn: false });
    const { makeClearCookieHeader } = await import("@/lib/auth");
    res.headers.set("Set-Cookie", makeClearCookieHeader());
    return res;
  }

  return NextResponse.json({ loggedIn: true, userId: user.id, username: user.username });
}
