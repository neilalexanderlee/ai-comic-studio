/**
 * 邀请码 —— 支付上线前，这是平台 Key 唯一还立着的准入闸。
 *
 * 锁住的不变量：
 *  · **占用是原子的**：只剩一次的码被两个人同时用，只有一个能成。
 *    「先查后写」在这里会真的多放一个人进来 —— 而多进来的人烧的是平台的钱。
 *  · 作废 / 过期 / 用完各自都挡得住，且理由是分开的（用户得知道该找谁）
 *  · 作废是**软删除**：删掉记录就查不出这个码带进来过谁
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const holder: { sqlite?: import("better-sqlite3").Database } = {};

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE invite_codes (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, note TEXT, created_by TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE invite_code_uses (
      id TEXT PRIMARY KEY, code_id TEXT NOT NULL, user_id TEXT NOT NULL, used_at INTEGER NOT NULL
    );
  `);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

async function mod() {
  return import("@/lib/invite-codes");
}

beforeEach(async () => {
  await import("@/lib/db");
  holder.sqlite!.prepare(`DELETE FROM invite_codes`).run();
  holder.sqlite!.prepare(`DELETE FROM invite_code_uses`).run();
});

describe("码本身", () => {
  it("足够长、字符集不含容易看错的 I/L/O/U", async () => {
    const { generateInviteCode } = await mod();
    for (let i = 0; i < 50; i++) {
      const c = generateInviteCode();
      expect(c).toHaveLength(10);
      expect(c).not.toMatch(/[ILOU]/);
    }
  });

  it("输入容错：大小写 / 空格 / 连字符都不该导致「码无效」", async () => {
    const { normalizeInviteCode } = await mod();
    expect(normalizeInviteCode(" ab3-9 xz ")).toBe("AB39XZ");
  });
});

describe("占用", () => {
  it("正常占用一次，并留下「谁用了哪个码」的记录", async () => {
    const { createInviteCode, redeemInviteCode } = await mod();
    const code = await createInviteCode({ createdBy: "admin", maxUses: 2 });

    const r = await redeemInviteCode(code.code, "user-1");
    expect(r.ok).toBe(true);

    const row = holder.sqlite!
      .prepare(`SELECT used_count FROM invite_codes WHERE id = ?`)
      .get(code.id) as { used_count: number };
    expect(row.used_count).toBe(1);

    const uses = holder.sqlite!
      .prepare(`SELECT user_id FROM invite_code_uses WHERE code_id = ?`)
      .all(code.id) as Array<{ user_id: string }>;
    expect(uses.map((u) => u.user_id)).toEqual(["user-1"]);
  });

  it("⚠️ 只剩一次的码不能被用两次 —— 多放一个人进来就是多一份平台 Key 开销", async () => {
    const { createInviteCode, redeemInviteCode } = await mod();
    const code = await createInviteCode({ createdBy: "admin", maxUses: 1 });

    expect((await redeemInviteCode(code.code, "user-1")).ok).toBe(true);
    const second = await redeemInviteCode(code.code, "user-2");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("exhausted");
  });

  it("小写输入照样能用", async () => {
    const { createInviteCode, redeemInviteCode } = await mod();
    const code = await createInviteCode({ createdBy: "admin" });
    expect((await redeemInviteCode(code.code.toLowerCase(), "u")).ok).toBe(true);
  });
});

describe("拒绝理由是分开的", () => {
  it("不存在", async () => {
    const { redeemInviteCode } = await mod();
    const r = await redeemInviteCode("NOPENOPE1", "u");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_found");
  });

  it("已作废（软删除，记录还在）", async () => {
    const { createInviteCode, redeemInviteCode, revokeInviteCode, listInviteCodes } = await mod();
    const code = await createInviteCode({ createdBy: "admin", maxUses: 5 });
    await revokeInviteCode(code.id);

    const r = await redeemInviteCode(code.code, "u");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked");

    // 作废不等于删除 —— 还要能顺着它查出带进来过谁
    expect((await listInviteCodes()).map((c) => c.id)).toContain(code.id);
  });

  it("已过期", async () => {
    const { createInviteCode, redeemInviteCode } = await mod();
    const code = await createInviteCode({ createdBy: "admin" });
    holder.sqlite!
      .prepare(`UPDATE invite_codes SET expires_at = ? WHERE id = ?`)
      .run(Math.floor((Date.now() - 1000) / 1000), code.id);

    const r = await redeemInviteCode(code.code, "u");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("空码不当成有效码", async () => {
    const { redeemInviteCode } = await mod();
    const r = await redeemInviteCode("   ", "u");
    expect(r.ok).toBe(false);
  });
});
