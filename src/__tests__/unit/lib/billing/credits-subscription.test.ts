/**
 * 双余额 / 周期滚动 / 订单幂等 —— 跑在**真实的内存 SQLite** 上。
 *
 * 全局 setup 把 `@/lib/db` mock 成了假对象，那对这几个模块没有意义：它们的正确性
 * 全在 SQL 里（条件扣减、事务边界、UNIQUE 约束）。所以这里按
 * `art-style-consistency.test.ts` 的同款做法覆盖掉那个 mock，换成真库。
 *
 * 锁住的不变量：
 *  · 消费**先花会过期的**订阅积分，永久积分留到最后
 *  · 退还**按原路** —— 否则可以套利：订阅积分预扣 → 取消 → 洗成永久积分
 *  · 周期滚动是幂等的，且「清零旧的」与「发放新的」同生共死
 *  · 支付回调重复推送只入账一次
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const DDL = `
CREATE TABLE credit_accounts (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  frozen INTEGER NOT NULL DEFAULT 0,
  subscription_balance INTEGER NOT NULL DEFAULT 0,
  subscription_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  ref_type TEXT, ref_id TEXT, note TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, shot_id TEXT,
  kind TEXT NOT NULL, protocol TEXT, model_id TEXT, params TEXT,
  credits_reserved INTEGER NOT NULL DEFAULT 0, credits_charged INTEGER NOT NULL DEFAULT 0,
  upstream_usage INTEGER, reserved_from_subscription INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved', created_at INTEGER NOT NULL
);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL, auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, plan_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, credits_granted INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'mock', status TEXT NOT NULL DEFAULT 'pending',
  out_trade_no TEXT NOT NULL UNIQUE, channel_trade_no TEXT,
  expires_at INTEGER NOT NULL, paid_at INTEGER, raw_callback TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX orders_channel_trade_uq ON orders(channel, channel_trade_no);
`;

// 单例：模块图里只有一个 db，测试之间靠 TRUNCATE 复位
const holder: { sqlite?: import("better-sqlite3").Database } = {};

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

const USER = "u_test";

async function mods() {
  return {
    credits: await import("@/lib/billing/credits"),
    subscription: await import("@/lib/billing/subscription"),
    orders: await import("@/lib/billing/orders"),
    plans: await import("@/lib/billing/plans"),
  };
}

function accountRow() {
  return holder.sqlite!
    .prepare(`SELECT balance, subscription_balance, frozen FROM credit_accounts WHERE user_id = ?`)
    .get(USER) as { balance: number; subscription_balance: number; frozen: number } | undefined;
}

function ledgerTypes(): string[] {
  return (
    holder.sqlite!
      .prepare(`SELECT type FROM credit_ledger WHERE user_id = ? ORDER BY rowid`)
      .all(USER) as { type: string }[]
  ).map((r) => r.type);
}

/** 直接把账户摆成想要的状态，跳过下单流程 */
/** ⚠️ 时间列存的是**秒**（Drizzle 的 mode:"timestamp"），seed 也必须按秒写 */
const S = (ms: number) => Math.floor(ms / 1000);

function seedAccount(permanent: number, subscription: number, expiresAt = S(Date.now() + 86400_000)) {
  holder.sqlite!
    .prepare(
      `INSERT INTO credit_accounts (user_id, balance, frozen, subscription_balance, subscription_expires_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance,
         subscription_balance=excluded.subscription_balance,
         subscription_expires_at=excluded.subscription_expires_at`
    )
    .run(USER, permanent, subscription, expiresAt, S(Date.now()));
}

/** 让 ensureSubscriptionPeriod 认为周期还没到，避免它在测试中途重新发积分 */
function seedActiveSubscription(planCode = "pro", endsInMs = 86400_000) {
  const now = Date.now();
  holder.sqlite!
    .prepare(
      `INSERT INTO subscriptions (id, user_id, plan_code, status, period_start, period_end, auto_renew, created_at, updated_at)
       VALUES ('s1', ?, ?, 'active', ?, ?, 1, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET plan_code=excluded.plan_code, period_end=excluded.period_end`
    )
    .run(USER, planCode, S(now), S(now + endsInMs), S(now), S(now));
}

beforeEach(async () => {
  await mods(); // 确保 mock 已初始化
  for (const t of ["credit_accounts", "credit_ledger", "usage_records", "subscriptions", "orders"]) {
    holder.sqlite!.prepare(`DELETE FROM ${t}`).run();
  }
});

describe("双余额消费顺序", () => {
  it("订阅积分够时全部走订阅，永久积分一分不动", async () => {
    const { credits } = await mods();
    seedActiveSubscription();
    seedAccount(1000, 500);

    const r = await credits.reserveCredits(USER, { kind: "image", imageCount: 1 });
    expect(r.credits).toBeGreaterThan(0);

    const acc = accountRow()!;
    expect(acc.balance).toBe(1000); // 永久桶没动
    expect(acc.subscription_balance).toBe(500 - r.credits);
    expect(acc.frozen).toBe(r.credits);
  });

  it("订阅积分不够时才动永久积分，且拆分被如实记录", async () => {
    const { credits } = await mods();
    seedActiveSubscription();
    // 故意让订阅桶只有 10 —— 一张图的报价远高于它
    seedAccount(10000, 10);

    const r = await credits.reserveCredits(USER, { kind: "image", imageCount: 1 });
    const acc = accountRow()!;

    expect(acc.subscription_balance).toBe(0); // 订阅桶被榨干
    expect(acc.balance).toBe(10000 - (r.credits - 10)); // 差额才从永久桶出

    const rec = holder.sqlite!
      .prepare(`SELECT reserved_from_subscription FROM usage_records WHERE id = ?`)
      .get(r.reservationId) as { reserved_from_subscription: number };
    expect(rec.reserved_from_subscription).toBe(10);
  });

  it("两桶加起来都不够 → 抛 InsufficientCreditsError，且一分钱都不扣", async () => {
    const { credits } = await mods();
    seedActiveSubscription();
    seedAccount(1, 1);

    await expect(
      credits.reserveCredits(USER, { kind: "video", durationSeconds: 10, resolution: "720p" })
    ).rejects.toThrow(credits.InsufficientCreditsError);

    const acc = accountRow()!;
    expect(acc.balance).toBe(1);
    expect(acc.subscription_balance).toBe(1);
    expect(acc.frozen).toBe(0);
  });
});

describe("退还按原路 —— 这是防套利的关键", () => {
  it("全额退款：订阅的回订阅桶，永久的回永久桶", async () => {
    const { credits } = await mods();
    seedActiveSubscription();
    seedAccount(10000, 10);

    const r = await credits.reserveCredits(USER, { kind: "image", imageCount: 1 });
    await credits.refundCredits(r.reservationId, "测试退款");

    const acc = accountRow()!;
    // 完全复原 —— 尤其是订阅桶那 10 分没有被"洗"进永久桶
    expect(acc.subscription_balance).toBe(10);
    expect(acc.balance).toBe(10000);
    expect(acc.frozen).toBe(0);
  });

  it("部分结算时差额先退永久桶 —— 让实际花掉的落在会过期的那部分上", async () => {
    const { credits } = await mods();
    seedActiveSubscription();
    seedAccount(10000, 10);

    const r = await credits.reserveCredits(USER, { kind: "image", imageCount: 1 });
    // 只用掉 5 分，其余退回
    await credits.settleCredits(r.reservationId, { actualCredits: 5 });

    const acc = accountRow()!;
    expect(acc.frozen).toBe(0);
    // 永久桶应被完全退回；实际扣的 5 分全部来自订阅桶
    expect(acc.balance).toBe(10000);
    expect(acc.subscription_balance).toBe(5);
  });

  it("重复 settle / refund 无副作用（幂等）", async () => {
    const { credits } = await mods();
    seedActiveSubscription();
    seedAccount(10000, 1000);

    const r = await credits.reserveCredits(USER, { kind: "image", imageCount: 1 });
    await credits.settleCredits(r.reservationId);
    const after = accountRow()!;

    await credits.settleCredits(r.reservationId);
    await credits.refundCredits(r.reservationId);
    expect(accountRow()).toEqual(after);
  });
});

describe("订阅周期惰性滚动", () => {
  it("首次访问落到免费档并发放该档积分", async () => {
    const { subscription, plans } = await mods();
    const state = await subscription.ensureSubscriptionPeriod(USER);

    expect(state.planCode).toBe(plans.FREE_PLAN_CODE);
    expect(accountRow()!.subscription_balance).toBe(plans.freePlan().creditsPerPeriod);
    expect(ledgerTypes()).toContain("grant");
  });

  it("周期内重复调用不会重复发放（幂等）", async () => {
    const { subscription } = await mods();
    await subscription.ensureSubscriptionPeriod(USER);
    const first = accountRow()!.subscription_balance;

    await subscription.ensureSubscriptionPeriod(USER);
    await subscription.ensureSubscriptionPeriod(USER);
    expect(accountRow()!.subscription_balance).toBe(first);
  });

  it("周期到期后滚动：旧的清零写 expire，新的发放写 grant", async () => {
    const { subscription, plans } = await mods();
    await subscription.ensureSubscriptionPeriod(USER);
    // 手动把余额改小，模拟"用了一部分"，再把周期推到过去
    holder.sqlite!.prepare(`UPDATE credit_accounts SET subscription_balance = 100 WHERE user_id = ?`).run(USER);
    holder.sqlite!.prepare(`UPDATE subscriptions SET period_end = ? WHERE user_id = ?`).run(S(Date.now()) - 60, USER);

    await subscription.ensureSubscriptionPeriod(USER);

    // 剩余的 100 作废，重新发满
    expect(accountRow()!.subscription_balance).toBe(plans.freePlan().creditsPerPeriod);
    expect(ledgerTypes()).toContain("expire");
    const expired = holder.sqlite!
      .prepare(`SELECT amount FROM credit_ledger WHERE user_id=? AND type='expire'`)
      .get(USER) as { amount: number };
    expect(expired.amount).toBe(-100);
  });

  it("永久积分不受周期滚动影响", async () => {
    const { subscription } = await mods();
    await subscription.ensureSubscriptionPeriod(USER);
    holder.sqlite!.prepare(`UPDATE credit_accounts SET balance = 7777 WHERE user_id = ?`).run(USER);
    holder.sqlite!.prepare(`UPDATE subscriptions SET period_end = ? WHERE user_id = ?`).run(S(Date.now()) - 60, USER);

    await subscription.ensureSubscriptionPeriod(USER);
    expect(accountRow()!.balance).toBe(7777);
  });
});

describe("订单与支付回调", () => {
  it("加油包入账进**永久桶**，且不设到期时间", async () => {
    const { orders: o, plans } = await mods();
    const pack = plans.CREDIT_PACKS[0];
    const order = await o.createOrder({ userId: USER, kind: "topup", code: pack.code });

    const res = await o.markOrderPaid({ outTradeNo: order.outTradeNo, channelTradeNo: "ch_1" });
    expect(res.alreadyPaid).toBe(false);

    const acc = accountRow()!;
    expect(acc.balance).toBe(pack.credits);
    expect(acc.subscription_balance).toBe(0);
    expect(ledgerTypes()).toContain("purchase");
  });

  it("同一笔回调重复推送只入账一次（幂等）", async () => {
    const { orders: o, plans } = await mods();
    const pack = plans.CREDIT_PACKS[0];
    const order = await o.createOrder({ userId: USER, kind: "topup", code: pack.code });

    await o.markOrderPaid({ outTradeNo: order.outTradeNo, channelTradeNo: "ch_dup" });
    const second = await o.markOrderPaid({ outTradeNo: order.outTradeNo, channelTradeNo: "ch_dup" });

    expect(second.alreadyPaid).toBe(true);
    expect(accountRow()!.balance).toBe(pack.credits); // 没有翻倍
    expect(ledgerTypes().filter((t) => t === "purchase")).toHaveLength(1);
  });

  it("订阅订单支付后开启新周期并发放该档积分", async () => {
    const { orders: o, plans } = await mods();
    const pro = plans.PLANS.find((p) => p.code === "pro")!;
    const order = await o.createOrder({ userId: USER, kind: "subscription", code: "pro" });
    await o.markOrderPaid({ outTradeNo: order.outTradeNo, channelTradeNo: "ch_sub" });

    expect(accountRow()!.subscription_balance).toBe(pro.creditsPerPeriod);
    const sub = holder.sqlite!
      .prepare(`SELECT plan_code, status FROM subscriptions WHERE user_id = ?`)
      .get(USER) as { plan_code: string; status: string };
    expect(sub.plan_code).toBe("pro");
    expect(sub.status).toBe("active");
  });

  it("免费档不能下单（它没有价格，下了也付不掉）", async () => {
    const { orders: o, plans } = await mods();
    await expect(
      o.createOrder({ userId: USER, kind: "subscription", code: plans.FREE_PLAN_CODE })
    ).rejects.toThrow();
  });

  it("超时订单被关闭后不能再支付", async () => {
    const { orders: o, plans } = await mods();
    const order = await o.createOrder({ userId: USER, kind: "topup", code: plans.CREDIT_PACKS[0].code });
    holder.sqlite!.prepare(`UPDATE orders SET expires_at = ? WHERE id = ?`).run(S(Date.now()) - 60, order.orderId);
    await o.closeExpiredOrders(USER);

    await expect(
      o.markOrderPaid({ outTradeNo: order.outTradeNo, channelTradeNo: "ch_late" })
    ).rejects.toThrow();
    expect(accountRow()?.balance ?? 0).toBe(0);
  });
});
