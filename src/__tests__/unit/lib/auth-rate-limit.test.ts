/**
 * 登录失败限速。
 *
 * 端口一旦对公网开放，全网扫描器几天内必然找上门。scrypt 会让每次尝试变慢，
 * 但慢不等于挡得住 —— 只是把"几小时爆破"变成"几天爆破"。
 *
 * 锁住的不变量：
 *  · 达到上限后拒绝，并给出 Retry-After
 *  · **按 IP 和按用户名都算，取更严的那个**：只按 IP 换个 IP 就绕过，
 *    只按用户名则用不存在的用户名喷洒永远不触发
 *  · 登录成功清零 —— 自己打错几次密码不该把自己锁在外面
 *  · 窗口过后自动恢复
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  clientIpOf,
  __resetLoginRateLimit,
  LOGIN_RATE_LIMIT,
} from "@/lib/auth-rate-limit";

const { MAX_FAILURES, WINDOW_MS } = LOGIN_RATE_LIMIT;

beforeEach(() => __resetLoginRateLimit());

describe("限速", () => {
  it("上限之内一直放行", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordLoginFailure("1.1.1.1", "neil");
    expect(checkLoginAllowed("1.1.1.1", "neil").blocked).toBe(false);
  });

  it("达到上限后拒绝，并给出等待秒数", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure("1.1.1.1", "neil");
    const v = checkLoginAllowed("1.1.1.1", "neil");
    expect(v.blocked).toBe(true);
    expect(v.retryAfterSeconds).toBeGreaterThan(0);
    expect(v.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_MS / 1000);
  });

  it("换 IP 绕不过 —— 用户名维度照样在计数", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure(`10.0.0.${i}`, "neil");
    // 一个全新的 IP，但目标用户名相同
    expect(checkLoginAllowed("203.0.113.9", "neil").blocked).toBe(true);
  });

  it("换用户名喷洒也绕不过 —— IP 维度照样在计数", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure("1.1.1.1", `victim${i}`);
    expect(checkLoginAllowed("1.1.1.1", "someone-new").blocked).toBe(true);
  });

  it("登录成功清零，不会把正常用户锁在外面", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordLoginFailure("1.1.1.1", "neil");
    recordLoginSuccess("1.1.1.1", "neil");
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordLoginFailure("1.1.1.1", "neil");
    expect(checkLoginAllowed("1.1.1.1", "neil").blocked).toBe(false);
  });

  it("窗口过后自动恢复", async () => {
    const t0 = Date.now();
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure("1.1.1.1", "neil", t0);
    expect(checkLoginAllowed("1.1.1.1", "neil", t0).blocked).toBe(true);
    expect(checkLoginAllowed("1.1.1.1", "neil", t0 + WINDOW_MS + 1000).blocked).toBe(false);
  });

  it("互不相干的来源不会被误伤", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordLoginFailure("1.1.1.1", "neil");
    expect(checkLoginAllowed("2.2.2.2", "alice").blocked).toBe(false);
  });
});

describe("取客户端 IP", () => {
  it("优先用 x-forwarded-for 的第一段", () => {
    const r = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(clientIpOf(r)).toBe("203.0.113.5");
  });

  it("取不到时归到共用桶 —— 宁可严一点也不要漏计", () => {
    expect(clientIpOf(new Request("http://x/"))).toBe("unknown");
  });
});
