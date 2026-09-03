/**
 * 套餐功能位的执行层。
 *
 * 锁住的不变量：
 *  · `BILLING_ENABLED != "1"` 时**一条限制都不生效**（自部署用户必须畅通无阻）
 *  · 套餐限制是**拒绝**而不是静默降级 —— 否则用户按 720p 付积分、拿到 480p
 *  · 并发只数「还在飞」的预扣；进程崩溃留下的僵尸记录不能把用户永久锁死
 *  · 认不出的分辨率写法**不挡人**（宁可漏挡，也不要把付费用户挡在门外）
 *
 * 纯函数部分不需要库；并发/项目数两项跑在真实内存 SQLite 上（全局 setup 把
 * `@/lib/db` mock 掉了，那对这两个查询没有意义）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const DDL = `
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, shot_id TEXT,
  kind TEXT NOT NULL, protocol TEXT, model_id TEXT, params TEXT,
  credits_reserved INTEGER NOT NULL DEFAULT 0, credits_charged INTEGER NOT NULL DEFAULT 0,
  upstream_usage INTEGER, reserved_from_subscription INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved', created_at INTEGER NOT NULL
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
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

const USER = "u_limits";

async function mod() {
  return import("@/lib/billing/plan-limits");
}
async function plans() {
  return import("@/lib/billing/plans");
}

/** 秒 —— Drizzle 的 mode:"timestamp" 存的是秒 */
const sec = (ms: number) => Math.floor(ms / 1000);

function seedReservation(id: string, ageMs: number, status = "reserved") {
  holder.sqlite!
    .prepare(
      `INSERT INTO usage_records (id, user_id, kind, credits_reserved, status, created_at)
       VALUES (?, ?, 'video', 100, ?, ?)`
    )
    .run(id, USER, status, sec(Date.now() - ageMs));
}

beforeEach(async () => {
  await mod();
  holder.sqlite!.prepare(`DELETE FROM usage_records`).run();
  holder.sqlite!.prepare(`DELETE FROM projects`).run();
  vi.unstubAllEnvs();
});

describe("resolutionRank —— 各家写法不统一，认不出的一律不挡人", () => {
  it.each([
    ["480p", 480],
    ["720P", 720],
    ["768P", 768],
    ["1080p", 1080],
    ["2K", 1440],
    ["4k", 2160],
  ])("%s → %i", async (raw, want) => {
    expect((await mod()).resolutionRank(raw)).toBe(want);
  });

  it("空值与没见过的写法返回 0（= 永不触发限制）", async () => {
    const { resolutionRank } = await mod();
    for (const v of [null, undefined, "", "超清", "hd"]) {
      expect(resolutionRank(v as string)).toBe(0);
    }
  });
});

describe("模型档位与分辨率（纯函数）", () => {
  it("免费档挡掉 720p，并说清楚差在哪 —— 不是悄悄降成 480p", async () => {
    const { checkVideoPlanLimits } = await mod();
    const free = (await plans()).freePlan().features;
    const v = checkVideoPlanLimits(free, {
      modelId: "doubao-seedance-2-0-mini",
      resolution: "720p",
    });
    expect(v?.reason).toBe("resolution");
    expect(v?.message).toContain("480p");
  });

  it("免费档挡掉不在档位内的模型", async () => {
    const { checkVideoPlanLimits } = await mod();
    const free = (await plans()).freePlan().features;
    expect(checkVideoPlanLimits(free, { modelId: "doubao-seedance-2-5", resolution: "480p" })?.reason)
      .toBe("model");
    // 允许的档位放行
    expect(checkVideoPlanLimits(free, { modelId: "doubao-seedance-2-0-mini", resolution: "480p" }))
      .toBeNull();
  });

  it("allowedVideoFamilies 为空 = 不限制模型", async () => {
    const { checkVideoPlanLimits } = await mod();
    const { findPlan } = await plans();
    const pro = findPlan("pro")!.features;
    expect(checkVideoPlanLimits(pro, { modelId: "whatever-model", resolution: "1080p" })).toBeNull();
  });

  it("没传 modelId 时不挡 —— 挡了也说不清挡的是什么", async () => {
    const { checkVideoPlanLimits } = await mod();
    const free = (await plans()).freePlan().features;
    expect(checkVideoPlanLimits(free, { modelId: null, resolution: "480p" })).toBeNull();
  });
});

describe("BILLING_ENABLED 未设为 1 时一条限制都不生效", () => {
  it.each(["", "0", "true"])('BILLING_ENABLED="%s"', async (val) => {
    vi.stubEnv("BILLING_ENABLED", val);
    const { checkConcurrency, checkProjectQuota, checkVideoGenerationAllowed } = await mod();
    const free = (await plans()).freePlan().features;

    // 造出远超免费档上限的现场
    for (let i = 0; i < 5; i++) seedReservation(`r${i}`, 0);
    for (let i = 0; i < 9; i++) {
      holder.sqlite!
        .prepare(`INSERT INTO projects (id, user_id, title, created_at) VALUES (?, ?, 'x', 0)`)
        .run(`p${i}`, USER);
    }

    expect(await checkConcurrency(USER, free)).toBeNull();
    expect(await checkProjectQuota(USER, free)).toBeNull();
    // 连模型/分辨率也不该挡
    expect(
      await checkVideoGenerationAllowed(USER, { modelId: "doubao-seedance-2-5", resolution: "4k" })
    ).toBeNull();
  });
});

describe("并发", () => {
  beforeEach(() => vi.stubEnv("BILLING_ENABLED", "1"));

  it("免费档 1 并发：飞着一个就挡住第二个", async () => {
    const { checkConcurrency } = await mod();
    const free = (await plans()).freePlan().features;

    expect(await checkConcurrency(USER, free)).toBeNull();
    seedReservation("r1", 0);
    const v = await checkConcurrency(USER, free);
    expect(v?.reason).toBe("concurrency");
  });

  it("已结算/已退还的不算在飞", async () => {
    const { checkConcurrency } = await mod();
    const free = (await plans()).freePlan().features;
    seedReservation("r1", 0, "settled");
    seedReservation("r2", 0, "refunded");
    expect(await checkConcurrency(USER, free)).toBeNull();
  });

  it("进程崩溃留下的僵尸预扣（>15 分钟）不能把用户永久锁死", async () => {
    const { checkConcurrency } = await mod();
    const free = (await plans()).freePlan().features;
    seedReservation("zombie", 20 * 60 * 1000);
    expect(await checkConcurrency(USER, free)).toBeNull();
  });

  it("别人的任务不算在我头上", async () => {
    const { checkConcurrency } = await mod();
    const free = (await plans()).freePlan().features;
    holder.sqlite!
      .prepare(
        `INSERT INTO usage_records (id, user_id, kind, credits_reserved, status, created_at)
         VALUES ('other', 'someone_else', 'video', 100, 'reserved', ?)`
      )
      .run(sec(Date.now()));
    expect(await checkConcurrency(USER, free)).toBeNull();
  });

  it("不限并发的档位不查库也不挡", async () => {
    const { checkConcurrency } = await mod();
    const { UNLIMITED_FEATURES } = await plans();
    for (let i = 0; i < 20; i++) seedReservation(`r${i}`, 0);
    expect(await checkConcurrency(USER, UNLIMITED_FEATURES)).toBeNull();
  });
});

describe("项目数量", () => {
  beforeEach(() => vi.stubEnv("BILLING_ENABLED", "1"));

  it("免费档 2 个项目：第三个被挡", async () => {
    const { checkProjectQuota } = await mod();
    const free = (await plans()).freePlan().features;
    const add = (id: string, uid = USER) =>
      holder.sqlite!
        .prepare(`INSERT INTO projects (id, user_id, title, created_at) VALUES (?, ?, 'x', 0)`)
        .run(id, uid);

    add("p1");
    expect(await checkProjectQuota(USER, free)).toBeNull();
    add("p2");
    expect((await checkProjectQuota(USER, free))?.reason).toBe("projects");
    // 别人的项目不算在我头上
    holder.sqlite!.prepare(`DELETE FROM projects`).run();
    add("q1", "other");
    add("q2", "other");
    expect(await checkProjectQuota(USER, free)).toBeNull();
  });

  it("maxProjects=null 不限", async () => {
    const { checkProjectQuota } = await mod();
    const { findPlan } = await plans();
    for (let i = 0; i < 50; i++) {
      holder.sqlite!
        .prepare(`INSERT INTO projects (id, user_id, title, created_at) VALUES (?, ?, 'x', 0)`)
        .run(`p${i}`, USER);
    }
    expect(await checkProjectQuota(USER, findPlan("pro")!.features)).toBeNull();
  });
});

describe("planLimitResponse", () => {
  it("返回 403 + PLAN_LIMIT，而不是 402 —— 充积分解决不了套餐限制", async () => {
    const { planLimitResponse } = await mod();
    const res = planLimitResponse({ reason: "resolution", message: "x" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PLAN_LIMIT", reason: "resolution" });
  });
});
