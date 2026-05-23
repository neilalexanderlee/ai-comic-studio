import { getAuthUserIdFromRequest } from "./auth";

const ANON_COOKIE = "ai_comic_uid";

/**
 * 从 request Cookie header 中读取 ai_comic_uid（非 httpOnly，浏览器每次请求都自动带上）。
 * 用于 x-user-id header 缺失时的兜底（FingerprintProvider 初始化竞态窗口期）。
 */
function parseAnonCookie(request: Request): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${ANON_COOKIE}=`)) {
      return trimmed.slice(ANON_COOKIE.length + 1).trim();
    }
  }
  return "";
}

/**
 * 从请求中读取当前用户 ID。
 * 优先级：
 *   1. 签名 httpOnly cookie（账号系统，ai_comic_auth）
 *   2. x-user-id header（apiFetch 从 localStorage 注入）
 *   3. ai_comic_uid cookie（中间件每次请求都设置，浏览器自动携带）
 *      → 兜底：解决 FingerprintProvider 初始化和 apiFetch 首次调用之间的竞态，
 *        让 localStorage 还未同步时服务端仍能正确识别匿名用户。
 */
export function getUserIdFromRequest(request: Request): string {
  return (
    getAuthUserIdFromRequest(request) ??
    request.headers.get("x-user-id") ??
    parseAnonCookie(request) ??
    ""
  );
}
