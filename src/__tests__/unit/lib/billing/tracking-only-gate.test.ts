/**
 * 计费关闭时的「只记账不扣费」闸门。
 *
 * 为什么要有它：平台限额与全局并发都是数 `usage_records`。计费关着、
 * 闸门完全空操作的话，刹车就没有轮子可数 —— 而支付上线前这正是唯一的刹车。
 *
 * 锁住的不变量：
 *  · **BYOK 仍然是彻底的空操作，一行都不写** —— 自部署行为一行不变
 *  · 平台 Key 写且只写**一条**记录（两条会让并发按两倍算）
 *  · 记录里 credits 全为 0（没开计费就不该产生任何金额）
 *  · settle / refund 会把状态改掉，否则那条记录会永远占着并发名额
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const holder: { sqlite?: import("better-sqlite3").Database } = {};

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { BILLING_DDL } = await import("@/__tests__/helpers/billing-schema");
  const sqlite = new Database(":memory:");
  sqlite.exec(BILLING_DDL);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

function rows() {
  return holder.sqlite!
    .prepare(`SELECT id, status, key_source, credits_reserved, credits_charged FROM usage_records`)
    .all() as Array<{
    id: string;
    status: string;
    key_source: string;
    credits_reserved: number;
    credits_charged: number;
  }>;
}

beforeEach(async () => {
  await import("@/lib/db");
  holder.sqlite!.prepare(`DELETE FROM usage_records`).run();
  vi.unstubAllEnvs();
  vi.stubEnv("BILLING_ENABLED", "");
});

describe("计费关闭 + BYOK", () => {
  it("彻底空操作：一条记录都不写", async () => {
    const { openBillingGate } = await import("@/lib/billing/gate");
    const gate = await openBillingGate("u1", { kind: "video", durationSeconds: 10 }, {
      keySource: "user",
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) await gate.settle();
    expect(rows()).toHaveLength(0);
  });

  it("没传 keySource 时也按 BYOK 处理（缺省不能变严）", async () => {
    const { openBillingGate } = await import("@/lib/billing/gate");
    await openBillingGate("u1", { kind: "video", durationSeconds: 10 });
    expect(rows()).toHaveLength(0);
  });
});

describe("计费关闭 + 平台 Key", () => {
  it("写且只写一条 reserved 记录，金额为 0", async () => {
    const { openBillingGate } = await import("@/lib/billing/gate");
    const gate = await openBillingGate(
      "u1",
      { kind: "video", durationSeconds: 10, resolution: "720p" },
      { keySource: "platform", protocol: "seedance" }
    );
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.credits).toBe(0);

    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("reserved");
    expect(all[0].key_source).toBe("platform");
    expect(all[0].credits_reserved).toBe(0);
    expect(all[0].credits_charged).toBe(0);
  });

  it("settle 把它结掉 —— 否则那条记录会永远占着一个并发名额", async () => {
    const { openBillingGate } = await import("@/lib/billing/gate");
    const gate = await openBillingGate("u1", { kind: "video", durationSeconds: 10 }, {
      keySource: "platform",
    });
    if (!gate.ok) throw new Error("gate should open");
    await gate.settle();
    expect(rows()[0].status).toBe("settled");
  });

  it("refund 把它标成退还 —— 之后不再计入日额度", async () => {
    const { openBillingGate } = await import("@/lib/billing/gate");
    const gate = await openBillingGate("u1", { kind: "video", durationSeconds: 10 }, {
      keySource: "platform",
    });
    if (!gate.ok) throw new Error("gate should open");
    await gate.refund("上游失败");
    expect(rows()[0].status).toBe("refunded");
  });

  it("绝不因为余额为 0 而返回 402 —— 没开计费就不存在余额这回事", async () => {
    const { openBillingGate } = await import("@/lib/billing/gate");
    for (const kind of ["video", "image", "music"] as const) {
      const gate = await openBillingGate("no-account", { kind }, { keySource: "platform" });
      expect(gate.ok, `${kind} 不该被拦`).toBe(true);
    }
  });
});
