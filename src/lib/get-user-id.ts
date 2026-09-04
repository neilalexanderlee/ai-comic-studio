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
 * 是否要求**已登录**才算有身份。
 *
 * ⚠️ **默认关闭**，行为与改造前完全一致。这与 `BILLING_ENABLED` / `WORKER_IN_WEB`
 * 是同一条原则：自部署用户在自己机器上跑，被迫先注册登录纯属添堵。
 *
 * **但凡把服务暴露到公网，就必须设为 "1"。** 关闭时下面那两级回退是
 * `x-user-id` 请求头和未签名的 `ai_comic_uid` cookie —— 两者都是**客户端自己
 * 声明身份、服务端照单全收**：
 *
 *     curl -H "x-user-id: <某人的 ULID>" https://你的站点/api/projects
 *     → 200，返回那个人的全部项目
 *
 * 对单机单用户这是合理的便利，对公网则等于完全没有认证。
 */
export function isAuthRequired(): boolean {
  return process.env.REQUIRE_AUTH === "1";
}

/**
 * 从请求中读取当前用户 ID。
 *
 * 严格模式（`REQUIRE_AUTH=1`）：**只认 HMAC 签名过的 httpOnly cookie**，
 * 伪造需要 `AUTH_SECRET`。
 *
 * 宽松模式（默认）优先级：
 *   1. 签名 httpOnly cookie（账号系统，ai_comic_auth）
 *   2. x-user-id header（apiFetch 从 localStorage 注入）
 *   3. ai_comic_uid cookie（中间件每次请求都设置，浏览器自动携带）
 *      → 兜底：解决 FingerprintProvider 初始化和 apiFetch 首次调用之间的竞态，
 *        让 localStorage 还未同步时服务端仍能正确识别匿名用户。
 */
export function getUserIdFromRequest(request: Request): string {
  const signed = getAuthUserIdFromRequest(request);
  if (signed) return signed;
  if (isAuthRequired()) return "";
  return request.headers.get("x-user-id") ?? parseAnonCookie(request) ?? "";
}
