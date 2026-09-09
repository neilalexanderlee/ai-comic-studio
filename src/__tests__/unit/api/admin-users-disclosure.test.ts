/**
 * 管理后台的用户列表：**运营 admin 不该知道平台 Key 挂在哪个账号上**。
 *
 * 这条信息的用途是提醒 owner「别停用这个账号」（停了全站生成当场失效）。
 * 而运营 admin 本来就停不了 owner，拿到它没有任何用途，却精确指出了
 * 上游密钥在谁手里 —— 对一个被明确排除在密钥之外的角色，这是没必要的暴露。
 *
 * 它在路由里只是一个三元表达式，正是重构时最容易被顺手改回去的那种。
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

/** 只关心「谁在调用」，归属校验本身另有测试覆盖 */
const actor = { id: "" };
vi.mock("@/lib/api-guard", () => ({
  requireAdmin: async () => ({ ok: true, userId: actor.id }),
}));

function seed(id: string, username: string, role: string, createdAt = 0) {
  holder.sqlite!
    .prepare(
      `INSERT INTO users (id, username, password_hash, token_version, role, status, created_at)
       VALUES (?, ?, 'x', 0, ?, 'active', ?)`
    )
    .run(id, username, role, createdAt);
}

async function listAs(userId: string) {
  actor.id = userId;
  const { __resetAdminCachesForTests } = await import("@/lib/admin");
  __resetAdminCachesForTests();
  const { GET } = await import("@/app/api/admin/users/route");
  const res = await GET(new Request("http://x/api/admin/users"));
  return res.json() as Promise<{
    users: Array<{ username: string; role: string }>;
    platformKeyOwnerId: string | null;
    currentUserRole: string;
  }>;
}

beforeEach(async () => {
  await import("@/lib/db");
  holder.sqlite!.prepare(`DELETE FROM users`).run();
  vi.unstubAllEnvs();
  seed("u_owner", "neil", "owner", 100);
  seed("u_ops", "ops", "admin", 200);
  seed("u_bob", "bob", "user", 300);
});

describe("用户列表的信息暴露", () => {
  it("owner 能看到平台 Key 挂在哪个账号上 —— 他需要它来避免误停用", async () => {
    const d = await listAs("u_owner");
    expect(d.currentUserRole).toBe("owner");
    expect(d.platformKeyOwnerId).toBe("u_owner");
  });

  it("⚠️ 运营 admin 拿不到 platformKeyOwnerId", async () => {
    const d = await listAs("u_ops");
    expect(d.currentUserRole).toBe("admin");
    expect(d.platformKeyOwnerId).toBeNull();
  });

  it("运营 admin 仍能看到完整用户列表和角色 —— 那是他停用账号所必需的", async () => {
    const d = await listAs("u_ops");
    expect(d.users.map((u) => u.username).sort()).toEqual(["bob", "neil", "ops"]);
    expect(d.users.find((u) => u.username === "neil")?.role).toBe("owner");
  });

  it("任何角色都拿不到 password_hash", async () => {
    for (const who of ["u_owner", "u_ops"]) {
      const d = await listAs(who);
      for (const u of d.users) {
        expect(Object.keys(u)).not.toContain("passwordHash");
        expect(Object.keys(u)).not.toContain("password_hash");
      }
    }
  });
});
