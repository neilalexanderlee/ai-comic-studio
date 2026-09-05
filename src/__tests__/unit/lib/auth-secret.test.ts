/**
 * `AUTH_SECRET` 的三种状态。
 *
 * 这三条各自堵一个真实的坑（2026-09-05 实测确认）：
 *
 *  1. **完全未设** —— 原实现在 `NODE_ENV=production` 下**直接抛错**。
 *     而 `docker compose up` 跑的就是 production，于是自部署用户
 *     「clone 下来就能用」变成「一注册就 500」，错误还只在服务端日志里。
 *  2. **空串** —— 原实现用 `??`，只在 `undefined` 时回落，
 *     于是 `AUTH_SECRET=`（`.env.example` 里那行取消注释却没填，非常容易发生）
 *     会拿**空字符串**当签名密钥，绕过所有校验且毫无提示。
 *  3. **正常设置** —— 必须原样使用，行为不能变。
 *
 * 另一条不变量：自动生成的密钥要**落盘持久化**，否则每次重启都会把所有人踢下线。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs", async (importOriginal) => importOriginal());

let tmpDir: string;

async function freshAuth() {
  vi.resetModules();
  return import("@/lib/auth");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-secret-"));
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", `file:${path.join(tmpDir, "aicomic.db")}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 从 cookie 取出签名段，用来判断两次用的是不是同一把密钥 */
function sigOf(header: string): string {
  return header.split(";")[0].split(".").pop()!;
}

describe("AUTH_SECRET", () => {
  it("完全未设时不抛错，自动生成并落盘（自部署装机即用）", async () => {
    delete process.env.AUTH_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    const auth = await freshAuth();

    const header = auth.makeSetCookieHeader("u1", 0, new Request("http://x/y"));
    expect(header).toContain("ai_comic_auth=");

    const file = path.join(tmpDir, ".auth-secret");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8").trim().length).toBeGreaterThan(20);
  });

  it("自动生成的密钥必须持久化 —— 否则重启会把所有人踢下线", async () => {
    delete process.env.AUTH_SECRET;
    const a1 = await freshAuth();
    const sig1 = sigOf(a1.makeSetCookieHeader("u1", 0, new Request("http://x/y")));

    // 模拟进程重启：重新加载模块（缓存清空），但数据目录还在
    const a2 = await freshAuth();
    const sig2 = sigOf(a2.makeSetCookieHeader("u1", 0, new Request("http://x/y")));

    expect(sig2).toBe(sig1);
  });

  it("空串等同于未设 —— 绝不能拿空字符串当签名密钥", async () => {
    vi.stubEnv("AUTH_SECRET", "   ");
    const auth = await freshAuth();
    auth.makeSetCookieHeader("u1", 0, new Request("http://x/y"));
    // 走到了「自动生成」这条路，才会有密钥文件
    expect(fs.existsSync(path.join(tmpDir, ".auth-secret"))).toBe(true);
  });

  it("显式设置时原样使用，不写文件", async () => {
    vi.stubEnv("AUTH_SECRET", "a-real-explicit-secret");
    const auth = await freshAuth();
    auth.makeSetCookieHeader("u1", 0, new Request("http://x/y"));
    expect(fs.existsSync(path.join(tmpDir, ".auth-secret"))).toBe(false);
  });

  it("不同的密钥签出不同的签名（确认密钥真的参与了签名）", async () => {
    vi.stubEnv("AUTH_SECRET", "secret-A");
    const a = await freshAuth();
    const sigA = sigOf(a.makeSetCookieHeader("u1", 0, new Request("http://x/y")));

    vi.stubEnv("AUTH_SECRET", "secret-B");
    const b = await freshAuth();
    const sigB = sigOf(b.makeSetCookieHeader("u1", 0, new Request("http://x/y")));

    expect(sigA).not.toBe(sigB);
  });

  it("公开仓库里不得存在硬编码的默认密钥回落", async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../lib/auth.ts"),
      "utf8"
    );
    expect(src).not.toContain("ai-comic-builder-dev-secret-please-change");
  });
});
