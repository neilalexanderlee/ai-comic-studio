/**
 * POST /api/auth/logout — 清除认证 cookie
 */
import { NextResponse } from "next/server";
import { makeClearCookieHeader } from "@/lib/auth";

export async function POST(request: Request) {
  const res = NextResponse.json({ ok: true });
  // 传 request：清除用的属性必须和下发时一致，否则浏览器当成另一个 cookie，登出无效
  res.headers.set("Set-Cookie", makeClearCookieHeader(request));
  return res;
}
