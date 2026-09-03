/**
 * 计费相关 API 路由的**路由级**测试：直接调用 route handler，跑在真实内存 SQLite 上。
 *
 * 为什么做到这一层：这几条路由的价值不在业务逻辑（那已由 credits-subscription.test.ts
 * 覆盖），而在**接线**——鉴权有没有接、未启用计费时会不会漏出套餐、mock 支付
 * 会不会绕过订单归属校验。这些都是 handler 边界上的事，只测 lib 层测不到。
 *
 * 同时锁住那条最容易造成事故的语义：
 * **BILLING_ENABLED 未设为 "1" 时，所有计费接口都不提供任何可购买的东西。**
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const DDL = `
CREATE TABLE credit_accounts (
  user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, frozen INTEGER NOT NULL DEFAULT 0,
  subscription_balance INTEGER NOT NULL DEFAULT 0, subscription_expires_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL, ref_type TEXT, ref_id TEXT, note TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, shot_id TEXT, kind TEXT NOT NULL,
  protocol TEXT, model_id TEXT, params TEXT, credits_reserved INTEGER NOT NULL DEFAULT 0,
  credits_charged INTEGER NOT NULL DEFAULT 0, upstream_usage INTEGER,
  reserved_from_subscription INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'reserved',
  created_at INTEGER NOT NULL
);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, plan_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, plan_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, credits_granted INTEGER NOT NULL, channel TEXT NOT NULL DEFAULT 'mock',
  status TEXT NOT NULL DEFAULT 'pending', out_trade_no TEXT NOT NULL UNIQUE, channel_trade_no TEXT,
  expires_at INTEGER NOT NULL, paid_at INTEGER, raw_callback TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX orders_channel_trade_uq ON orders(channel, channel_trade_no);
`;

const holder: { sqlite?: import("better-sqlite3").Database } = {};

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

const USER = "u_route";

/** 带身份的请求。api-guard 会从 x-user-id 头读用户（apiFetch 就是这么注入的） */
function req(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost${url}`, {
    ...init,
    headers: { "x-user-id": USER, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}
/** 不带身份的请求 */
function anonReq(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost${url}`, init);
}

async function routes() {
  return {
    plans: await import("@/app/api/billing/plans/route"),
    account: await import("@/app/api/billing/account/route"),
    orders: await import("@/app/api/billing/orders/route"),
    mockPay: await import("@/app/api/billing/orders/[orderId]/mock-pay/route"),
    callback: await import("@/app/api/billing/callback/[channel]/route"),
    plansData: await import("@/lib/billing/plans"),
  };
}

beforeEach(async () => {
  await routes();
  for (const t of ["credit_accounts", "credit_ledger", "usage_records", "subscriptions", "orders"]) {
    holder.sqlite!.prepare(`DELETE FROM ${t}`).run();
  }
  vi.unstubAllEnvs();
});

describe("鉴权", () => {
  it("无身份一律 401（这几条路由都接了 requireUser）", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const r = await routes();
    expect((await r.plans.GET(anonReq("/api/billing/plans"))).status).toBe(401);
    expect((await r.account.GET(anonReq("/api/billing/account"))).status).toBe(401);
    expect(
      (await r.orders.POST(anonReq("/api/billing/orders", { method: "POST", body: "{}" }))).status
    ).toBe(401);
  });

  it("mock 支付只能付自己的订单：别人的订单一律 404，不返回 403", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const r = await routes();
    // 用别人的身份下单
    holder.sqlite!
      .prepare(
        `INSERT INTO orders (id, user_id, kind, plan_code, amount_cents, credits_granted, channel, status, out_trade_no, expires_at, created_at)
         VALUES ('o_other', 'someone_else', 'topup', 'pack_11k', 10000, 11000, 'mock', 'pending', 'OTHER1', ?, ?)`
      )
      .run(Math.floor(Date.now() / 1000) + 600, Math.floor(Date.now() / 1000));

    const res = await r.mockPay.POST(req("/api/billing/orders/o_other/mock-pay", { method: "POST" }), {
      params: Promise.resolve({ orderId: "o_other" }),
    });
    // 404 而不是 403 —— 403 等于告诉对方"这个订单存在但不是你的"
    expect(res.status).toBe(404);
    expect(holder.sqlite!.prepare(`SELECT status FROM orders WHERE id='o_other'`).get()).toEqual({
      status: "pending",
    });
  });
});

describe("BILLING_ENABLED 未设为 1 时不提供任何可购买的东西", () => {
  it.each(["", "0", "true", "yes"])('BILLING_ENABLED="%s"', async (val) => {
    vi.stubEnv("BILLING_ENABLED", val);
    const r = await routes();

    const plans = await (await r.plans.GET(req("/api/billing/plans"))).json();
    expect(plans.billingEnabled).toBe(false);
    expect(plans.plans).toEqual([]);
    expect(plans.packs).toEqual([]);

    const account = await (await r.account.GET(req("/api/billing/account"))).json();
    expect(account.billingEnabled).toBe(false);

    // 下单直接拒绝，而不是落一条永远付不掉的订单
    const order = await r.orders.POST(
      req("/api/billing/orders", { method: "POST", body: JSON.stringify({ kind: "topup", code: "pack_11k" }) })
    );
    expect(order.status).toBe(400);
    expect(holder.sqlite!.prepare(`SELECT COUNT(*) c FROM orders`).get()).toEqual({ c: 0 });
  });
});

describe("下单与支付", () => {
  it("下单只落 pending，不动余额；mock 支付后才入账", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const r = await routes();
    const pack = r.plansData.CREDIT_PACKS[0];

    const created = await (
      await r.orders.POST(
        req("/api/billing/orders", { method: "POST", body: JSON.stringify({ kind: "topup", code: pack.code }) })
      )
    ).json();
    expect(created.orderId).toBeTruthy();
    // 下单不该动账户
    expect(holder.sqlite!.prepare(`SELECT COUNT(*) c FROM credit_ledger`).get()).toEqual({ c: 0 });

    const paid = await (
      await r.mockPay.POST(req(`/api/billing/orders/${created.orderId}/mock-pay`, { method: "POST" }), {
        params: Promise.resolve({ orderId: created.orderId }),
      })
    ).json();
    expect(paid.alreadyPaid).toBe(false);

    const acc = holder.sqlite!
      .prepare(`SELECT balance FROM credit_accounts WHERE user_id=?`)
      .get(USER) as { balance: number };
    expect(acc.balance).toBe(pack.credits);
  });

  it("未接入的支付渠道被拒 —— 不下出一笔永远付不掉的单", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const r = await routes();
    const res = await r.orders.POST(
      req("/api/billing/orders", {
        method: "POST",
        body: JSON.stringify({ kind: "topup", code: "pack_11k", channel: "alipay" }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("支付回调", () => {
  it("没配密钥时一律 403 —— 这个端点没有用户会话，不能裸奔", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    vi.stubEnv("BILLING_MOCK_CALLBACK_SECRET", "");
    const r = await routes();
    const res = await r.callback.POST(
      anonReq("/api/billing/callback/mock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outTradeNo: "X", channelTradeNo: "Y" }),
      }),
      { params: Promise.resolve({ channel: "mock" }) }
    );
    expect(res.status).toBe(403);
  });

  it("密钥正确时入账，且重复推送只入账一次", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    vi.stubEnv("BILLING_MOCK_CALLBACK_SECRET", "s3cret");
    const r = await routes();
    const pack = r.plansData.CREDIT_PACKS[0];

    const created = await (
      await r.orders.POST(
        req("/api/billing/orders", { method: "POST", body: JSON.stringify({ kind: "topup", code: pack.code }) })
      )
    ).json();

    const body = JSON.stringify({
      outTradeNo: created.outTradeNo,
      channelTradeNo: "ch_cb_1",
      secret: "s3cret",
    });
    const call = () =>
      r.callback.POST(
        anonReq("/api/billing/callback/mock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        { params: Promise.resolve({ channel: "mock" }) }
      );

    expect((await (await call()).json()).alreadyPaid).toBe(false);
    // 渠道会反复重推直到拿到成功响应 —— 重推必须安全
    expect((await (await call()).json()).alreadyPaid).toBe(true);

    const acc = holder.sqlite!
      .prepare(`SELECT balance FROM credit_accounts WHERE user_id=?`)
      .get(USER) as { balance: number };
    expect(acc.balance).toBe(pack.credits); // 没有翻倍
  });
});
