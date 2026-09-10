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

    expect(roleOf("u1")).toBe("owner");
    expect(roleOf("u2")).toBe("user");
  });

  it("支持多个、容忍空格", async () => {
    seed("u1", "neil");
    seed("u2", "alice");
    vi.stubEnv("ADMIN_USERNAMES", " neil , alice ");
    const { ensureBootstrapAdmins } = await import("@/lib/admin");
    await ensureBootstrapAdmins();
    expect(roleOf("u1")).toBe("owner");
    expect(roleOf("u2")).toBe("owner");
  });

  it("只授予不撤销：把名字从列表里删掉，已有的 owner 不会被降级", async () => {
    seed("u1", "neil", "owner");
    vi.stubEnv("ADMIN_USERNAMES", "alice");
    const { ensureBootstrapAdmins } = await import("@/lib/admin");
    await ensureBootstrapAdmins();
    expect(roleOf("u1")).toBe("owner");
  });

  it("未设置时什么都不做", async () => {
    seed("u1", "neil");
    const { ensureBootstrapAdmins } = await import("@/lib/admin");
    await ensureBootstrapAdmins();
    expect(roleOf("u1")).toBe("user");
  });
});

describe("空库首用户", () => {
  it("库里零用户且未设 ADMIN_USERNAMES → 新用户是 owner（自部署装机即用）", async () => {
    const { roleForNewUser } = await import("@/lib/admin");
    expect(await roleForNewUser()).toBe("owner");
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

describe("三级权限：管理后台准入 ≠ 模型 Key 准入", () => {
  it("owner 两样都能", async () => {
    seed("u1", "neil", "owner");
    const { isPlatformStaff, isKeyOwner } = await import("@/lib/admin");
    expect(await isPlatformStaff("u1")).toBe(true);
    expect(await isKeyOwner("u1")).toBe(true);
  });

  it("⚠️ 运营 admin 能进管理后台，但**碰不到模型 Key** —— 这是整个分级的核心", async () => {
    seed("u2", "ops", "admin");
    const { isPlatformStaff, isKeyOwner } = await import("@/lib/admin");
    expect(await isPlatformStaff("u2")).toBe(true);
    expect(await isKeyOwner("u2")).toBe(false);
  });

  it("普通用户两样都不能", async () => {
    seed("u3", "bob", "user");
    const { isPlatformStaff, isKeyOwner } = await import("@/lib/admin");
    expect(await isPlatformStaff("u3")).toBe(false);
    expect(await isKeyOwner("u3")).toBe(false);
  });

  it("匿名指纹用户（users 表里没有行）按 user 处理", async () => {
    const { isPlatformStaff, isKeyOwner, roleOf } = await import("@/lib/admin");
    expect(await isPlatformStaff("anon")).toBe(false);
    expect(await isKeyOwner("anon")).toBe(false);
    expect(await roleOf("anon")).toBe("user");
  });

  it("平台 Key 归属人只能是 owner —— 选中运营 admin 会让全站解析不到 Key", async () => {
    seed("u_ops", "ops", "admin", 100);
    seed("u_owner", "neil", "owner", 200);
    const { getPlatformKeyOwnerId } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBe("u_owner");
  });

  it("只有运营 admin、没有 owner 时，平台 Key 归属人为空（而不是错选 admin）", async () => {
    seed("u_ops", "ops", "admin");
    const { getPlatformKeyOwnerId } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBeNull();
  });

  /**
   * PLATFORM_KEY_USERNAME 原先只按用户名找，不限定 role —— 于是它能指向一个
   * **无权配置 Key** 的账号（isKeyOwner 只认 owner，运营 admin 的设置页根本
   * 没有密钥配置区），那个账号名下永远不会有密钥。症状是全站解析不到 Key，
   * 而报错只会是「未配置 Key」，完全看不出是这个环境变量指错了人。
   */
  describe("PLATFORM_KEY_USERNAME 指定", () => {
    it("指向 owner 时生效 —— 可以越过「最早创建」这条默认规则", async () => {
      seed("u_first", "first", "owner", 100);
      seed("u_pick", "pick", "owner", 200);
      vi.stubEnv("PLATFORM_KEY_USERNAME", "pick");
      const { getPlatformKeyOwnerId } = await import("@/lib/admin");
      expect(await getPlatformKeyOwnerId()).toBe("u_pick");
    });

    it("⚠️ 指向运营 admin 时不认，回落到最早创建的 owner", async () => {
      seed("u_owner", "neil", "owner", 100);
      seed("u_ops", "ops", "admin", 200);
      vi.stubEnv("PLATFORM_KEY_USERNAME", "ops");
      const { getPlatformKeyOwnerId } = await import("@/lib/admin");
      expect(await getPlatformKeyOwnerId()).toBe("u_owner");
    });

    it("指向普通用户 / 不存在的用户名时，同样回落", async () => {
      seed("u_owner", "neil", "owner", 100);
      seed("u_bob", "bob", "user", 200);
      const { getPlatformKeyOwnerId, __resetAdminCachesForTests } = await import("@/lib/admin");

      vi.stubEnv("PLATFORM_KEY_USERNAME", "bob");
      expect(await getPlatformKeyOwnerId()).toBe("u_owner");

      __resetAdminCachesForTests();
      vi.stubEnv("PLATFORM_KEY_USERNAME", "nobody");
      expect(await getPlatformKeyOwnerId()).toBe("u_owner");
    });

    it("指向已停用的 owner 时回落 —— 停用的账号不该继续当 Key 来源", async () => {
      seed("u_live", "live", "owner", 100);
      seed("u_dead", "dead", "owner", 200, "disabled");
      vi.stubEnv("PLATFORM_KEY_USERNAME", "dead");
      const { getPlatformKeyOwnerId } = await import("@/lib/admin");
      expect(await getPlatformKeyOwnerId()).toBe("u_live");
    });

    it("回落时要打告警 —— 配错了必须看得见，否则只会表现为「未配置 Key」", async () => {
      seed("u_owner", "neil", "owner", 100);
      seed("u_ops", "ops", "admin", 200);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("PLATFORM_KEY_USERNAME", "ops");
      const { getPlatformKeyOwnerId } = await import("@/lib/admin");
      await getPlatformKeyOwnerId();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("PLATFORM_KEY_USERNAME");
      expect(warn.mock.calls[0][0]).toContain("ops");
      warn.mockRestore();
    });

    it("指定为空白时按未设置处理，不打告警", async () => {
      seed("u_owner", "neil", "owner", 100);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("PLATFORM_KEY_USERNAME", "   ");
      const { getPlatformKeyOwnerId } = await import("@/lib/admin");
      expect(await getPlatformKeyOwnerId()).toBe("u_owner");
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
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

  it("第一个账号仍然是 owner —— 豁免掉的只是邀请码，不是角色规则", async () => {
    const { roleForNewUser, hasAnyUser } = await import("@/lib/admin");
    expect(await hasAnyUser()).toBe(false);
    expect(await roleForNewUser()).toBe("owner");
  });
});

describe("平台 Key 归属人", () => {
  it("默认取**最早创建**的管理员，结果稳定不飘移", async () => {
    seed("u_late", "late", "owner", 200);
    seed("u_early", "early", "owner", 100);
    const { getPlatformKeyOwnerId, __resetAdminCachesForTests } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBe("u_early");
    __resetAdminCachesForTests();
    expect(await getPlatformKeyOwnerId()).toBe("u_early");
  });

  it("PLATFORM_KEY_USERNAME 可以指定", async () => {
    seed("u_early", "early", "owner", 100);
    seed("u_late", "late", "owner", 200);
    vi.stubEnv("PLATFORM_KEY_USERNAME", "late");
    const { getPlatformKeyOwnerId } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBe("u_late");
  });

  it("停用的管理员不作数", async () => {
    seed("u_early", "early", "owner", 100, "disabled");
    seed("u_late", "late", "owner", 200);
    const { getPlatformKeyOwnerId } = await import("@/lib/admin");
    expect(await getPlatformKeyOwnerId()).toBe("u_late");
  });

  it("一个 owner 都没有 → null（调用方据此拒绝注入密钥）", async () => {
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
    const { isUserDisabled, isPlatformStaff } = await import("@/lib/admin");
    expect(await isUserDisabled("anon-fingerprint")).toBe(false);
    expect(await isPlatformStaff("anon-fingerprint")).toBe(false);
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
