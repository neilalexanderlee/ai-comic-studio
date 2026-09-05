/**
 * cookie 的 `Secure` 属性必须跟着**请求的实际协议**走，而不是 NODE_ENV。
 *
 * 为什么要用测试钉死：这个 bug 的失败方式是**完全无声的**。
 * 生产跑在明文 HTTP 上（备案下来之前没有 HTTPS）时，浏览器会把 Secure cookie
 * 直接丢掉 —— 登录接口返回 200、Set-Cookie 也发了，浏览器就是不存，
 * 用户看到「提示登录成功，回到首页却没有数据，再进设置仍是未登录」，
 * 控制台没有任何报错。2026-09-05 真实发生过。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function fresh() {
  vi.resetModules();
  return import("@/lib/auth");
}

const reqWith = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_SECRET", "test-secret-for-cookie-attrs");
});
afterEach(() => vi.unstubAllEnvs());

describe("Secure 属性按请求协议决定", () => {
  it("明文 HTTP 的生产环境**不能**加 Secure —— 加了浏览器会静默丢弃 cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const auth = await fresh();
    const header = auth.makeSetCookieHeader("u1", 0, reqWith("http://60.205.91.158:3007/api/auth/login"));
    expect(header).not.toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("HTTPS 请求要加 Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const auth = await fresh();
    expect(auth.makeSetCookieHeader("u1", 0, reqWith("https://example.com/api/auth/login")))
      .toContain("; Secure");
  });

  it("反代终止 TLS 时认 x-forwarded-proto", async () => {
    const auth = await fresh();
    expect(
      auth.makeSetCookieHeader("u1", 0, reqWith("http://internal:3007/x", { "x-forwarded-proto": "https" }))
    ).toContain("; Secure");
    // 逗号分隔的链取第一段
    expect(
      auth.makeSetCookieHeader("u1", 0, reqWith("http://internal:3007/x", { "x-forwarded-proto": "https, http" }))
    ).toContain("; Secure");
    expect(
      auth.makeSetCookieHeader("u1", 0, reqWith("https://x/y", { "x-forwarded-proto": "http" }))
    ).not.toContain("Secure");
  });

  it("COOKIE_SECURE 可强制覆盖（代理没设 x-forwarded-proto 时兜底）", async () => {
    vi.stubEnv("COOKIE_SECURE", "1");
    let auth = await fresh();
    expect(auth.makeSetCookieHeader("u1", 0, reqWith("http://x/y"))).toContain("; Secure");

    vi.stubEnv("COOKIE_SECURE", "0");
    auth = await fresh();
    expect(auth.makeSetCookieHeader("u1", 0, reqWith("https://x/y"))).not.toContain("Secure");
  });

  it("拿不到 request 时不加 —— 两种错法代价不对称，宁可少一层保护也不要静默登录失败", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const auth = await fresh();
    expect(auth.makeSetCookieHeader("u1", 0)).not.toContain("Secure");
  });

  it("清除 cookie 的属性必须与下发时一致，否则登出无效", async () => {
    const req = reqWith("https://example.com/api/auth/logout");
    const auth = await fresh();
    const set = auth.makeSetCookieHeader("u1", 0, req);
    const clear = auth.makeClearCookieHeader(req);
    for (const attr of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure"]) {
      expect(set).toContain(attr);
      expect(clear).toContain(attr);
    }
  });
});
