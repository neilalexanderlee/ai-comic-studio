/**
 * `/login?next=` 与 `/register?next=` 的开放重定向防护（两页共用同一个实现）。
 *
 * 不校验就是标准的开放重定向：攻击者发一个
 * `https://我们的域名/zh/login?next=https://evil.com` 的链接，
 * 用户在**我们的站点**上正常登录完，被送到钓鱼站，
 * 而整个过程地址栏都显示我们的域名 —— 这正是钓鱼最想要的可信外壳。
 */
import { describe, it, expect } from "vitest";
import { safeNext } from "@/lib/auth-next";

const HOME = "/zh";

describe("safeNext", () => {
  it("站内相对路径原样放行", () => {
    expect(safeNext("/zh/project/abc", HOME)).toBe("/zh/project/abc");
    expect(safeNext("/zh/settings?tab=1", HOME)).toBe("/zh/settings?tab=1");
  });

  it("没传就回首页", () => {
    expect(safeNext(undefined, HOME)).toBe(HOME);
    expect(safeNext("", HOME)).toBe(HOME);
  });

  it("绝对 URL 一律拒绝", () => {
    for (const bad of [
      "https://evil.com",
      "http://evil.com/x",
      "javascript:alert(1)",
      "data:text/html,x",
    ]) {
      expect(safeNext(bad, HOME)).toBe(HOME);
    }
  });

  it("协议相对 URL 也要拒绝 —— 浏览器会当成跨站地址", () => {
    expect(safeNext("//evil.com", HOME)).toBe(HOME);
    expect(safeNext("//evil.com/path", HOME)).toBe(HOME);
  });

  it("反斜杠变体也要拒绝 —— 部分浏览器会把 \\ 规范化成 /", () => {
    expect(safeNext("/\\evil.com", HOME)).toBe(HOME);
  });

  it("不以 / 开头的相对路径拒绝（避免拼出站外地址）", () => {
    expect(safeNext("evil.com", HOME)).toBe(HOME);
  });
});
