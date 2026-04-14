import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const COOKIE_NAME = "ai_comic_uid";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  // Ensure ai_comic_uid cookie exists before any page renders.
  // If missing, set a random UUID so server components can query by userId
  // on the very first request. The client-side FingerprintProvider will
  // later overwrite this with the real browser fingerprint if needed.
  if (!request.cookies.get(COOKIE_NAME)) {
    const uid = crypto.randomUUID().replace(/-/g, "");
    response.cookies.set(COOKIE_NAME, uid, {
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
