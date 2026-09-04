/**
 * 订单状态机的**完整闭环**：下单 → 回调 → 订阅生效 → 积分到账 → 消费 →
 * 结算/退款 → 周期滚动 → 加油包叠加。
 *
 * 与 `credits-subscription.test.ts` 的分工：那个文件逐条锁**单点不变量**
 * （消费顺序、按原路退还、回调幂等），每个用例自己 seed 想要的状态；
 * 这个文件按**真实时间顺序**跑一遍全流程，锁的是「每一步之后，
 * orders / subscriptions / credit_accounts / credit_ledger 四张表互相对得上」。
 *
 * 为什么值得单独跑一遍：单点不变量各自成立，不等于串起来也成立 ——
 * 比如「回调把订单标成 paid」和「回调发放积分」分别测过，
 * 但没有测过「支付之后订阅周期的 period_end 与账户上的 subscription_expires_at
 * 是不是同一个时刻」。这类跨表一致性只有走完整流程才看得见。
 *
 * 真实支付渠道要企业资质，接不上；mock 通道走的是**同一个入账函数**
 * （`markOrderPaid`），所以这里验的就是将来接真渠道后照样成立的那部分。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

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

const USER = "u_lifecycle";

async function mods() {
  return {
    credits: await import("@/lib/billing/credits"),
    subscription: await import("@/lib/billing/subscription"),
    orders: await import("@/lib/billing/orders"),
    plans: await import("@/lib/billing/plans"),
  };
}

interface OrderRow {
  status: string;
  channel_trade_no: string | null;
  paid_at: number | null;
  amount_cents: number;
  credits_granted: number;
  out_trade_no: string;
}
interface SubRow {
  plan_code: string;
  status: string;
  period_start: number;
  period_end: number;
}
interface LedgerRow {
  type: string;
  amount: number;
  balance_after: number;
  ref_type: string | null;
}

const q = <T>(sql: string, ...args: unknown[]) => holder.sqlite!.prepare(sql).get(...args) as T;
const qAll = <T>(sql: string, ...args: unknown[]) => holder.sqlite!.prepare(sql).all(...args) as T[];

const orderRow = (id: string) => q<OrderRow>(`SELECT * FROM orders WHERE id = ?`, id);
const subRow = () => q<SubRow>(`SELECT * FROM subscriptions WHERE user_id = ?`, USER);
const ledger = () =>
  qAll<LedgerRow>(`SELECT type, amount, balance_after, ref_type FROM credit_ledger WHERE user_id = ? ORDER BY rowid`, USER);
const accountRow = () =>
  q<{ balance: number; subscription_balance: number; frozen: number; subscription_expires_at: number | null }>(
    `SELECT balance, subscription_balance, frozen, subscription_expires_at FROM credit_accounts WHERE user_id = ?`,
    USER,
  );

/**
 * 每一步之后都要成立：**最后一条流水记的余额 == 账户里两个桶之和**。
 *
 * 这是流水唯一能对账的锚点。`amount` 列不能直接累加去核对余额 ——
 * reserve 记的是 -预扣额（可用余额确实减少了），settle 记的是 -实扣额
 * （可用余额此时不再变化，变的是冻结额），两者语义不同。
 */
function expectLedgerAnchorsBalance(label: string) {
  const acc = accountRow();
  const rows = ledger();
  const last = rows[rows.length - 1];
  expect(last, `${label}: 应当有流水`).toBeTruthy();
  expect(last.balance_after, `${label}: 流水记的余额与账户对不上`).toBe(
    acc.balance + acc.subscription_balance,
  );
}

beforeAll(async () => {
  await mods();
  for (const t of ["credit_accounts", "credit_ledger", "usage_records", "subscriptions", "orders"]) {
    holder.sqlite!.prepare(`DELETE FROM ${t}`).run();
  }
});

// 步骤之间共享状态：这是一条时间线，不是互相独立的用例
const state: { orderId?: string; outTradeNo?: string; reservationId?: string; freeCredits?: number } = {};

describe("订单状态机全流程（mock 通道）", () => {
  it("① 新用户首次访问 → 落到免费档并发放该档积分", async () => {
    const { subscription, plans } = await mods();
    const s = await subscription.ensureSubscriptionPeriod(USER);

    expect(s.planCode).toBe(plans.FREE_PLAN_CODE);
    const free = plans.findPlan(plans.FREE_PLAN_CODE)!;
    state.freeCredits = free.creditsPerPeriod;

    const acc = accountRow();
    expect(acc.subscription_balance).toBe(free.creditsPerPeriod);
    expect(acc.balance, "免费档不该发永久积分").toBe(0);
    expect(ledger().map((r) => r.type)).toEqual(["grant"]);
    expectLedgerAnchorsBalance("①");
  });

  it("② 下单 pro → 只落 pending 记录，一分钱余额都不动", async () => {
    const { orders, plans } = await mods();
    const before = accountRow();

    const created = await orders.createOrder({ userId: USER, kind: "subscription", code: "pro" });
    state.orderId = created.orderId;
    state.outTradeNo = created.outTradeNo;

    const pro = plans.findPlan("pro")!;
    const row = orderRow(created.orderId);
    expect(row.status).toBe("pending");
    expect(row.paid_at).toBeNull();
    expect(row.channel_trade_no).toBeNull();
    // 价格与积分在下单时**快照**，之后改价不影响这笔历史订单
    expect(row.amount_cents).toBe(pro.priceCents);
    expect(row.credits_granted).toBe(pro.creditsPerPeriod);

    const after = accountRow();
    expect(after.balance).toBe(before.balance);
    expect(after.subscription_balance).toBe(before.subscription_balance);
    expect(ledger().length, "下单不该产生流水").toBe(1);
  });

  it("③ mock 回调 → 订单转 paid、订阅生效、积分到账，四张表互相对得上", async () => {
    const { orders, subscription, plans } = await mods();
    const r = await orders.markOrderPaid({
      outTradeNo: state.outTradeNo!,
      channelTradeNo: `mock_${state.outTradeNo}`,
      rawCallback: { channel: "mock" },
    });
    expect(r.ok).toBe(true);
    expect(r.alreadyPaid).toBe(false);

    const pro = plans.findPlan("pro")!;
    const row = orderRow(state.orderId!);
    expect(row.status).toBe("paid");
    expect(row.channel_trade_no).toBe(`mock_${state.outTradeNo}`);
    expect(row.paid_at).toBeTruthy();

    const sub = subRow();
    expect(sub.plan_code).toBe("pro");
    expect(sub.status).toBe("active");
    expect(sub.period_end).toBeGreaterThan(sub.period_start);

    const acc = accountRow();
    // 订阅积分**替换**而不是叠加：新周期发放的就是该档的额度
    expect(acc.subscription_balance).toBe(pro.creditsPerPeriod);
    expect(acc.balance, "订阅积分不该进永久桶").toBe(0);

    // 跨表一致性：账户上的到期时刻必须就是订阅周期的结束时刻，
    // 否则会出现「订阅还在、积分已过期」或反过来
    expect(acc.subscription_expires_at).toBe(sub.period_end);

    // 从免费档升到 pro 是一次**周期替换**：先把免费档没用完的作废，再发 pro 的额度。
    // 所以这里是三条而不是两条 —— 付费当下会损失免费档的剩余积分，这是既定语义
    // （订阅积分本来就周期末清零），不是漏账。
    expect(ledger().map((l) => l.type)).toEqual(["grant", "expire", "grant"]);
    expectLedgerAnchorsBalance("③");

    // 功能位：**未启用计费时一律无限制**（自部署用户带自己的 Key，限制纯属添堵），
    // 只有开了计费才按档位解析。这两种语义都得锁住，否则任一侧回归都无人察觉。
    expect(await subscription.resolveFeatures(USER)).toEqual(plans.UNLIMITED_FEATURES);
    vi.stubEnv("BILLING_ENABLED", "1");
    try {
      expect(await subscription.resolveFeatures(USER)).toEqual(pro.features);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("④ 回调重复推送 → 幂等，不重复发放", async () => {
    const { orders } = await mods();
    const before = accountRow();
    const ledgerLen = ledger().length;

    const again = await orders.markOrderPaid({
      outTradeNo: state.outTradeNo!,
      channelTradeNo: `mock_${state.outTradeNo}`,
    });
    expect(again.alreadyPaid).toBe(true);

    expect(accountRow()).toEqual(before);
    expect(ledger().length).toBe(ledgerLen);
  });

  it("⑤ 消费：预扣从订阅桶出，冻结额如实记账", async () => {
    const { credits } = await mods();
    const before = accountRow();

    const res = await credits.reserveCredits(USER, { kind: "image", imageCount: 1 });
    state.reservationId = res.reservationId;
    expect(res.credits, "报价永不为 0，否则可以无限白嫖").toBeGreaterThan(0);

    const acc = accountRow();
    expect(acc.subscription_balance).toBe(before.subscription_balance - res.credits);
    expect(acc.frozen).toBe(res.credits);

    const usage = q<{ status: string; credits_reserved: number; reserved_from_subscription: number }>(
      `SELECT status, credits_reserved, reserved_from_subscription FROM usage_records WHERE id = ?`,
      res.reservationId,
    );
    expect(usage.status).toBe("reserved");
    expect(usage.credits_reserved).toBe(res.credits);
    // 拆分必须记下来，否则退款时无法按原路退回
    expect(usage.reserved_from_subscription).toBe(res.credits);

    const last = ledger().at(-1)!;
    expect(last.type).toBe("reserve");
    expect(last.amount).toBe(-res.credits);
    expectLedgerAnchorsBalance("⑤");
  });

  it("⑥ 结算：实际用量更少 → 差额退回，冻结清零", async () => {
    const { credits } = await mods();
    const reserved = q<{ credits_reserved: number }>(
      `SELECT credits_reserved FROM usage_records WHERE id = ?`,
      state.reservationId!,
    ).credits_reserved;
    const charged = Math.floor(reserved / 2);

    await credits.settleCredits(state.reservationId!, { actualCredits: charged });

    const acc = accountRow();
    expect(acc.frozen, "结算后不该还有冻结额").toBe(0);

    const usage = q<{ status: string; credits_charged: number }>(
      `SELECT status, credits_charged FROM usage_records WHERE id = ?`,
      state.reservationId!,
    );
    expect(usage.status).toBe("settled");
    expect(usage.credits_charged).toBe(charged);

    const last = ledger().at(-1)!;
    expect(last.type).toBe("settle");
    expect(last.amount).toBe(-charged);
    expectLedgerAnchorsBalance("⑥");
  });

  it("⑦ 失败退款：全额按原路退回订阅桶", async () => {
    const { credits } = await mods();
    const before = accountRow();

    const res = await credits.reserveCredits(USER, { kind: "image", imageCount: 1 });
    await credits.refundCredits(res.reservationId, "上游报错");

    const acc = accountRow();
    expect(acc.frozen).toBe(0);
    expect(acc.subscription_balance, "退回订阅桶，不能洗成永久积分").toBe(before.subscription_balance);
    expect(acc.balance).toBe(before.balance);

    expect(q<{ status: string }>(`SELECT status FROM usage_records WHERE id = ?`, res.reservationId).status)
      .toBe("refunded");
    expect(ledger().at(-1)!.type).toBe("refund");
    expectLedgerAnchorsBalance("⑦");
  });

  it("⑧ 加油包：入永久桶且不设到期时间", async () => {
    const { orders, plans } = await mods();
    const before = accountRow();

    const created = await orders.createOrder({ userId: USER, kind: "topup", code: "pack_11k" });
    await orders.markOrderPaid({
      outTradeNo: created.outTradeNo,
      channelTradeNo: `mock_${created.outTradeNo}`,
    });

    const pack = plans.findPack("pack_11k")!;
    const acc = accountRow();
    expect(acc.balance).toBe(before.balance + pack.credits);
    expect(acc.subscription_balance, "加油包不该动订阅桶").toBe(before.subscription_balance);
    // 到期时刻仍然只由订阅周期决定 —— 加油包是永不过期的
    expect(acc.subscription_expires_at).toBe(subRow().period_end);

    expect(orderRow(created.orderId).status).toBe("paid");
    expect(ledger().at(-1)!.type).toBe("purchase");
    expectLedgerAnchorsBalance("⑧");
  });

  it("⑨ 周期滚动：订阅积分清零重发，永久积分纹丝不动", async () => {
    const { subscription, plans } = await mods();
    const before = accountRow();
    const pro = plans.findPlan("pro")!;

    // 惰性滚动：把"现在"推到周期结束之后再问一次
    const after = new Date((subRow().period_end + 60) * 1000);
    await subscription.ensureSubscriptionPeriod(USER, after);

    const acc = accountRow();
    expect(acc.subscription_balance, "新周期重新发放该档额度").toBe(pro.creditsPerPeriod);
    expect(acc.balance, "永久积分（加油包）不受周期影响").toBe(before.balance);

    const sub = subRow();
    expect(sub.period_start).toBeGreaterThanOrEqual(before.subscription_expires_at!);
    expect(acc.subscription_expires_at).toBe(sub.period_end);

    // 清零与发放必须同生共死：一次滚动写两条流水
    const tail = ledger().slice(-2).map((l) => l.type);
    expect(tail).toEqual(["expire", "grant"]);
    expectLedgerAnchorsBalance("⑨");
  });

  it("⑩ 全程流水自洽：每一条的 balance_after 都等于当时的可用余额", async () => {
    // 逐条重放：按 type 语义推演余额，必须与每条记录的 balance_after 吻合。
    // 这是「流水能不能用来对账」的最终检验 —— 只看最后一条是对的还不够。
    const rows = ledger();
    expect(rows.length).toBeGreaterThan(5);

    let available = 0;
    for (const [i, r] of rows.entries()) {
      // grant/purchase/refund 增加可用余额；reserve/expire 减少；
      // settle 只是把冻结额转成已花费，不再改变可用余额
      if (r.type === "settle") {
        // 结算时若有退回，可用余额会增加；直接取记录值作为新锚点
        available = r.balance_after;
      } else {
        available += r.amount;
      }
      expect(available, `第 ${i + 1} 条（${r.type}）对不上`).toBe(r.balance_after);
    }

    const acc = accountRow();
    expect(available).toBe(acc.balance + acc.subscription_balance);
  });
});
