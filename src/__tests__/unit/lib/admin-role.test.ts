/**
 * 管理员的产生方式与平台 Key 归属人。
 *
 * 锁住的不变量：
 *  · **已有库靠 `ADMIN_USERNAMES` 幂等授予** —— 「全库第一个用户自动 admin」在已有库上
 *    永远不触发，只用它就等于线上永远没有管理员
 *  · **全新空库**（且未设该变量）第一个注册的人是 admin —— 自部署装机即用
 *  · 环境变量**只授予不撤销**：把名字删掉不该让人悄无声息地失去权限
 *  · 平台 Key 归属人是**确定的单一人选**，不能在请求之间飘移
 *  · 停用状态能被读出来（撤销层的执行点）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const holder: { sqlite?: import("better-sqlite3").Database } = {};

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
    );
  `);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

function seed(id: string, username: string, role = "user", createdAt = 0, status = "active") {
  holder.sqlite!
    .prepare(
      `INSERT INTO users (id, username, password_hash, token_version, role, status, created_at)
       VALUES (?, ?, 'x', 0, ?, ?, ?)`
    )
    .run(id, username, role, status, createdAt);
}

function roleOf(id: string): string {
  return (
    holder.sqlite!.prepare(`SELECT role FROM users WHERE id = ?`).get(id) as { role: string }
  ).role;
}

beforeEach(async () => {
  await import("@/lib/db");
  const { __resetAdminCachesForTests } = await import("@/lib/admin");
  __resetAdminCachesForTests();
  holder.sqlite!.prepare(`DELETE FROM users`).run();
  vi.unstubAllEnvs();
});

describe("ADMIN_USERNAMES", () => {
  it("幂等授予已有库里的用户 —— 这是线上唯一可行的那条路", async () => {
    seed("u1", "neil");
    seed("u2", "someone");
    vi.stubEnv("ADMIN_USERNAMES", "neil");

    const { ensureBootstrapAdmins } = await import("@/lib/admin");
    await ensureBootstrapAdmins();
    await ensureBootstrapAdmins(); // 再来一次不应出错也不应变化

    expect(roleOf("u1")).toBe("admin");
    expect(roleOf("u2")).toBe("user");
  });

  it("支持多个、容忍空格", async () => {
    seed("u1", "neil");
    seed("u2", "alice");
    vi.stubEnv("ADMIN_USERNAMES", " neil , alice ");
    const { ensureBootstrapAdmins } = await import("@/lib/admin");
    await ensureBootstrapAdmins();
    expect(roleOf("u1")).toBe("admin");
    expect(roleOf("u2")).toBe("admin");
  });

  it("只授予不撤销：把名字从列表里删掉，已有的管理员不会被降级", async () => {
    seed("u1", "neil", "admin");
    vi.stubEnv("ADMIN_USERNAMES", "alice");
    const { ensureBootstrapAdmins } = await import("@/lib/admin");
    await ensureBootstrapAdmins();
    expect(roleOf("u1")).toBe("admin");
  });

  it("未设置时什么都不做", async () => {
    seed("u1", "neil");
    const { ensureBootstrapAdmins } = await import("@/lib/admin");
    await ensureBootstrapAdmins();
    expect(roleOf("u1")).toBe("user");
  });
});

describe("空库首用户", () => {
  it("库里零用户且未设 ADMIN_USERNAMES → 新用户是 admin（自部署装机即用）", async () => {
    const { roleForNewUser } = await import("@/lib/admin");
    expect(await roleForNewUser()).toBe("admin");
  });

  it("库里已有用户 → 新用户是普通用户", async () => {
    seed("u1", "neil");
    const { roleForNewUser } = await import("@/lib/admin");
    expect(await roleForNewUser()).toBe("user");
  });

  it("设了 ADMIN_USERNAMES 就不再走这条 —— 免得两套规则同时生效", async () => {
    vi.stubEnv("ADMIN_USERNAMES", "neil");
    const { roleForNewUser } = await import("@/lib/admin");
    expect(await roleForNewUser()).toBe("user");
  });
});

describe("邀请制的引导死锁", () => {
  it("空库时 hasAnyUser 为 false —— 注册路由据此豁免邀请码", async () => {
    const { hasAnyUser } = await import("@/lib/admin");
    expect(await hasAnyUser()).toBe(false);
  });

  it("有账号之后就不再豁免", async () => {
    seed("u1", "neil");
    const { hasAnyUser } = await import("@/lib/admin");
    expect(await hasAnyUser()).toBe(true);
  });

  it("第一个账号仍然是管理员 —— 豁免掉的只是邀请码，不是角色规则", async () => {
    const { roleForNewUser, hasAnyUser } = await import("@/lib/admin");
    expect(await hasAnyUser()).toBe(false);
    expect(await roleForNewUser()).toBe("admin");
  });
});

describe("平台 Key 归属人", () => {
  it("默认取**最早创建**的管理员，结果稳定不飘移", async () => {
    seed("u_late", "late", "admin", 200);
    seed("u_early", "early", "admin", 100);
    const { getPlatformKeyOwnerId, __resetAdminCachesForTests } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBe("u_early");
    __resetAdminCachesForTests();
    expect(await getPlatformKeyOwnerId()).toBe("u_early");
  });

  it("PLATFORM_KEY_USERNAME 可以指定", async () => {
    seed("u_early", "early", "admin", 100);
    seed("u_late", "late", "admin", 200);
    vi.stubEnv("PLATFORM_KEY_USERNAME", "late");
    const { getPlatformKeyOwnerId } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBe("u_late");
  });

  it("停用的管理员不作数", async () => {
    seed("u_early", "early", "admin", 100, "disabled");
    seed("u_late", "late", "admin", 200);
    const { getPlatformKeyOwnerId } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBe("u_late");
  });

  it("一个管理员都没有 → null（调用方据此拒绝注入密钥）", async () => {
    seed("u1", "neil");
    const { getPlatformKeyOwnerId } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBeNull();
  });
});

describe("停用状态", () => {
  it("停用的读得出来，正常的读不出来", async () => {
    seed("u_ok", "ok");
    seed("u_bad", "bad", "user", 0, "disabled");
    const { isUserDisabled } = await import("@/lib/admin");
    expect(await isUserDisabled("u_ok")).toBe(false);
    expect(await isUserDisabled("u_bad")).toBe(true);
  });

  it("users 表里没有这一行（匿名指纹用户）不算被停用 —— 单机匿名使用必须继续可用", async () => {
    const { isUserDisabled, isAdminUser } = await import("@/lib/admin");
    expect(await isUserDisabled("anon-fingerprint")).toBe(false);
    expect(await isAdminUser("anon-fingerprint")).toBe(false);
  });
});

describe("BYOK 开关", () => {
  it("默认开 —— 自部署全靠它", async () => {
    const { allowUserProviders } = await import("@/lib/admin");
    expect(allowUserProviders()).toBe(true);
  });

  it("只认字面量 0", async () => {
    const { allowUserProviders } = await import("@/lib/admin");
    vi.stubEnv("ALLOW_USER_PROVIDERS", "0");
    expect(allowUserProviders()).toBe(false);
    vi.stubEnv("ALLOW_USER_PROVIDERS", "false");
    expect(allowUserProviders()).toBe(true);
  });
});
