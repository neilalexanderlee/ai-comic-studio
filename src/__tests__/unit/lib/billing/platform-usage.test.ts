/**
 * 平台 Key 的用量刹车。
 *
 * 锁住的不变量：
 *  · **BYOK 完全不受影响，连库都不查** —— 自部署行为一行不变
 *    （与 BILLING_ENABLED / WORKER_IN_WEB / REQUIRE_AUTH 同一条默认值原则）
 *  · 视频按**秒**算不按条算（钱是按秒烧的）
 *  · 退还掉的不计入日额度 —— 一次失败不该罚用户一整天
 *  · 全局并发只数「还在飞的」，15 分钟前的残骸不该把人永久锁死
 *  · 环境变量写了个认不出来的值 → 回落到默认值，而不是变成 0 把所有人挡在门外
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

const USER = "u1";

/** 直接塞一条 usage_record（秒数走 params，与生产写法一致） */
function seedUsage(opts: {
  kind: string;
  seconds?: number;
  images?: number;
  status?: string;
  keySource?: string;
  ageMs?: number;
  protocol?: string;
  userId?: string;
}) {
  holder.sqlite!
    .prepare(
      `INSERT INTO usage_records
       (id, user_id, kind, protocol, params, credits_reserved, credits_charged,
        reserved_from_subscription, status, key_source, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`
    )
    .run(
      `r${Math.random()}`,
      opts.userId ?? USER,
      opts.kind,
      opts.protocol ?? "seedance",
      JSON.stringify({ durationSeconds: opts.seconds, imageCount: opts.images }),
      opts.status ?? "settled",
      opts.keySource ?? "platform",
      Math.floor((Date.now() - (opts.ageMs ?? 0)) / 1000)
    );
}

async function check(req: Parameters<
  Awaited<typeof import("@/lib/billing/platform-usage")>["checkPlatformUsage"]
>[1]) {
  const { checkPlatformUsage } = await import("@/lib/billing/platform-usage");
  return checkPlatformUsage(USER, req);
}

beforeEach(async () => {
  await import("@/lib/db");
  holder.sqlite!.prepare(`DELETE FROM usage_records`).run();
  vi.unstubAllEnvs();
});

describe("BYOK 不受任何影响", () => {
  it("keySource=user 一律放行，哪怕额度设成 0", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "0");
    seedUsage({ kind: "video", seconds: 9999 });
    expect(await check({ kind: "video", keySource: "user", durationSeconds: 600 })).toBeNull();
  });
});

describe("视频按秒计", () => {
  it("额度内放行", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "120");
    seedUsage({ kind: "video", seconds: 100 });
    expect(await check({ kind: "video", keySource: "platform", durationSeconds: 20 })).toBeNull();
  });

  it("超出即拒，理由是 daily_quota", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "120");
    seedUsage({ kind: "video", seconds: 100 });
    const v = await check({ kind: "video", keySource: "platform", durationSeconds: 30 });
    expect(v?.reason).toBe("daily_quota");
    expect(v?.message).toContain("100/120");
  });

  it("是按秒不是按条：4 条 7 秒 = 28 秒，不是 4 次", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "30");
    for (let i = 0; i < 4; i++) seedUsage({ kind: "video", seconds: 7 });
    expect(await check({ kind: "video", keySource: "platform", durationSeconds: 2 })).toBeNull();
    expect(
      await check({ kind: "video", keySource: "platform", durationSeconds: 3 })
    ).not.toBeNull();
  });

  it("退还掉的不计入 —— 一次失败不该罚用户一整天", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "120");
    seedUsage({ kind: "video", seconds: 100, status: "refunded" });
    expect(await check({ kind: "video", keySource: "platform", durationSeconds: 20 })).toBeNull();
  });

  it("24 小时之外的不计入", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "120");
    seedUsage({ kind: "video", seconds: 100, ageMs: 25 * 60 * 60 * 1000 });
    expect(await check({ kind: "video", keySource: "platform", durationSeconds: 100 })).toBeNull();
  });

  it("别人的用量不算在我头上", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "120");
    seedUsage({ kind: "video", seconds: 119, userId: "someone-else" });
    expect(await check({ kind: "video", keySource: "platform", durationSeconds: 100 })).toBeNull();
  });

  it("BYOK 的历史用量不占平台额度", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "120");
    seedUsage({ kind: "video", seconds: 119, keySource: "user" });
    expect(await check({ kind: "video", keySource: "platform", durationSeconds: 100 })).toBeNull();
  });
});

describe("图片与音乐按次计", () => {
  it("图片", async () => {
    vi.stubEnv("PLATFORM_DAILY_IMAGE_COUNT", "3");
    seedUsage({ kind: "image", images: 3 });
    expect(await check({ kind: "image", keySource: "platform", imageCount: 1 })).not.toBeNull();
  });

  it("音乐", async () => {
    vi.stubEnv("PLATFORM_DAILY_MUSIC_COUNT", "1");
    seedUsage({ kind: "music", seconds: 60 });
    expect(await check({ kind: "music", keySource: "platform" })).not.toBeNull();
  });

  it("文本不设日限", async () => {
    seedUsage({ kind: "text" });
    expect(await check({ kind: "text", keySource: "platform" })).toBeNull();
  });
});

describe("全局并发", () => {
  it("在飞任务数达上限即拒，理由是 global_concurrency", async () => {
    vi.stubEnv("PLATFORM_MAX_INFLIGHT", "2");
    seedUsage({ kind: "video", seconds: 5, status: "reserved" });
    seedUsage({ kind: "video", seconds: 5, status: "reserved" });
    const v = await check({
      kind: "video",
      keySource: "platform",
      durationSeconds: 5,
      protocol: "seedance",
    });
    expect(v?.reason).toBe("global_concurrency");
  });

  it("算的是**全平台**而不是单个用户 —— 上游限流不分是谁打的", async () => {
    vi.stubEnv("PLATFORM_MAX_INFLIGHT", "1");
    seedUsage({ kind: "video", seconds: 5, status: "reserved", userId: "other" });
    const v = await check({ kind: "video", keySource: "platform", durationSeconds: 5, protocol: "seedance" });
    expect(v?.reason).toBe("global_concurrency");
  });

  it("15 分钟前的 reserved 残骸不计入 —— 否则崩过一次就永久锁死", async () => {
    vi.stubEnv("PLATFORM_MAX_INFLIGHT", "1");
    seedUsage({
      kind: "video",
      seconds: 5,
      status: "reserved",
      ageMs: 20 * 60 * 1000,
      protocol: "seedance",
    });
    expect(
      await check({ kind: "video", keySource: "platform", durationSeconds: 5, protocol: "seedance" })
    ).toBeNull();
  });

  it("不同协议各算各的", async () => {
    vi.stubEnv("PLATFORM_MAX_INFLIGHT", "1");
    seedUsage({ kind: "video", seconds: 5, status: "reserved", protocol: "seedance" });
    expect(
      await check({ kind: "video", keySource: "platform", durationSeconds: 5, protocol: "kling" })
    ).toBeNull();
  });
});

describe("开关的失效方式必须是「没省到钱」而不是「谁都用不了」", () => {
  it.each(["abc", "-5", ""])("认不出来的值 %s 回落到默认值", async (v) => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", v);
    const { platformLimits } = await import("@/lib/billing/platform-usage");
    expect(platformLimits().dailyVideoSeconds).toBe(120);
  });

  it("显式设 0 = 不限制该项", async () => {
    vi.stubEnv("PLATFORM_DAILY_VIDEO_SECONDS", "0");
    seedUsage({ kind: "video", seconds: 99999 });
    expect(await check({ kind: "video", keySource: "platform", durationSeconds: 600 })).toBeNull();
  });
});
