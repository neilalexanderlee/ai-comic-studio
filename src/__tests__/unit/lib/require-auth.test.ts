/**
 * 严格认证模式。
 *
 * 起因是一次实测：服务部署到公网后，**不带任何 cookie、只加一个请求头**就能读到
 * 别人的全部项目 ——
 *
 *     curl -H "x-user-id: <某人的 ULID>" http://<站点>/api/projects  → 200
 *
 * `getUserIdFromRequest` 的回退链里，`x-user-id` 请求头和 `ai_comic_uid` cookie
 * 都是**未签名的裸 ULID**：客户端自己声明身份，服务端照单全收。
 * 对单机单用户是合理的便利，对公网等于完全没有认证。
 *
 * 锁住的不变量：
 *  · 默认（未设 REQUIRE_AUTH）行为**与改造前完全一致** —— 自部署不能被这个改动波及
 *  · REQUIRE_AUTH=1 时，未签名的两级回退全部失效
 *  · 签名 cookie 在两种模式下都照常工作
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

async function mod() {
  vi.resetModules();
  return await import("@/lib/get-user-id");
}

/** 造一个带签名的合法 auth cookie —— 必须用被测代码自己的签名逻辑，否则测的是假货 */
async function signedCookieFor(userId: string): Promise<string> {
  vi.resetModules();
  const auth = await import("@/lib/auth");
  const header = auth.makeSetCookieHeader(userId, 0);
  // "ai_comic_auth=<value>; Path=/; ..." → 取出 name=value 那一段
  return header.split(";")[0];
}

function reqWith(init: { header?: string; anon?: string; auth?: string }): Request {
  const h = new Headers();
  if (init.header) h.set("x-user-id", init.header);
  const cookies = [init.auth, init.anon ? `ai_comic_uid=${init.anon}` : ""].filter(Boolean);
  if (cookies.length) h.set("cookie", cookies.join("; "));
  return new Request("http://localhost/api/projects", { headers: h });
}

const VICTIM = "01KRMXVBN8BEB5VWHNBM0FX8RQ";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_SECRET", "test-secret-for-require-auth");
});

describe("默认（宽松）模式 —— 自部署行为不变", () => {
  it("认 x-user-id 请求头", async () => {
    const { getUserIdFromRequest, isAuthRequired } = await mod();
    expect(isAuthRequired()).toBe(false);
    expect(getUserIdFromRequest(reqWith({ header: VICTIM }))).toBe(VICTIM);
  });

  it("认未签名的 ai_comic_uid cookie", async () => {
    const { getUserIdFromRequest } = await mod();
    expect(getUserIdFromRequest(reqWith({ anon: VICTIM }))).toBe(VICTIM);
  });

  it.each(["", "0", "true", "yes"])('REQUIRE_AUTH="%s" 仍是宽松模式', async (v) => {
    vi.stubEnv("REQUIRE_AUTH", v);
    const { getUserIdFromRequest, isAuthRequired } = await mod();
    expect(isAuthRequired()).toBe(false);
    expect(getUserIdFromRequest(reqWith({ header: VICTIM }))).toBe(VICTIM);
  });
});

describe("REQUIRE_AUTH=1 —— 未签名的身份一律不认", () => {
  beforeEach(() => vi.stubEnv("REQUIRE_AUTH", "1"));

  it("光有 x-user-id 请求头拿不到身份（这正是那次实测打穿的路径）", async () => {
    const { getUserIdFromRequest } = await mod();
    expect(getUserIdFromRequest(reqWith({ header: VICTIM }))).toBe("");
  });

  it("光有 ai_comic_uid cookie 也拿不到身份", async () => {
    const { getUserIdFromRequest } = await mod();
    expect(getUserIdFromRequest(reqWith({ anon: VICTIM }))).toBe("");
  });

  it("两个一起来也不行", async () => {
    const { getUserIdFromRequest } = await mod();
    expect(getUserIdFromRequest(reqWith({ header: VICTIM, anon: VICTIM }))).toBe("");
  });

  it("签名 cookie 正常工作 —— 不能把真用户一起挡在外面", async () => {
    const auth = await signedCookieFor(VICTIM);
    vi.stubEnv("REQUIRE_AUTH", "1");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-require-auth");
    const { getUserIdFromRequest } = await mod();
    expect(getUserIdFromRequest(reqWith({ auth }))).toBe(VICTIM);
  });

  it("换个密钥签的 cookie 不被接受", async () => {
    const auth = await signedCookieFor(VICTIM);
    vi.stubEnv("REQUIRE_AUTH", "1");
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret");
    const { getUserIdFromRequest } = await mod();
    expect(getUserIdFromRequest(reqWith({ auth }))).toBe("");
  });

  it("签名 cookie 在场时，伪造的请求头不能覆盖它", async () => {
    const auth = await signedCookieFor(VICTIM);
    vi.stubEnv("REQUIRE_AUTH", "1");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-require-auth");
    const { getUserIdFromRequest } = await mod();
    expect(getUserIdFromRequest(reqWith({ auth, header: "01ATTACKER0000000000000000" }))).toBe(VICTIM);
  });
});
