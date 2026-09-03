/**
 * 套餐常量与功能位的不变量。
 *
 * 这些是纯数据断言，跑得快，但挡住的是"改了套餐表却没改配套逻辑"这类静默错误 ——
 * 比如把免费档删掉（`freePlan()` 会崩）、或给免费档配上 1080p（一注册就能烧钱）。
 */
import { describe, it, expect } from "vitest";
import {
  PLANS,
  CREDIT_PACKS,
  FREE_PLAN_CODE,
  findPlan,
  findPack,
  freePlan,
  UNLIMITED_FEATURES,
} from "@/lib/billing/plans";

describe("套餐常量", () => {
  it("免费档必须存在 —— 没有订阅记录的用户一律落到它，缺了会直接崩", () => {
    expect(findPlan(FREE_PLAN_CODE)).toBeDefined();
    expect(freePlan().priceCents).toBe(0);
  });

  it("code 不重复（重复会让 findPlan 的结果取决于声明顺序）", () => {
    const codes = PLANS.map((p) => p.code);
    expect(codes.length).toBe(new Set(codes).size);
    const packCodes = CREDIT_PACKS.map((p) => p.code);
    expect(packCodes.length).toBe(new Set(packCodes).size);
  });

  it("付费档的价格与积分都为正，且档位越贵积分越多", () => {
    const paid = PLANS.filter((p) => p.priceCents > 0);
    expect(paid.length).toBeGreaterThan(0);
    const sorted = [...paid].sort((a, b) => a.priceCents - b.priceCents);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].creditsPerPeriod).toBeGreaterThan(sorted[i - 1].creditsPerPeriod);
    }
  });

  it("档位越贵，每元换到的积分越多（否则买贵的反而吃亏）", () => {
    const paid = [...PLANS.filter((p) => p.priceCents > 0)].sort(
      (a, b) => a.priceCents - b.priceCents
    );
    for (let i = 1; i < paid.length; i++) {
      const prev = paid[i - 1].creditsPerPeriod / paid[i - 1].priceCents;
      const cur = paid[i].creditsPerPeriod / paid[i].priceCents;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it("免费档必须被限制在最便宜的模型与 480p —— 否则一注册就能烧 720p 的钱", () => {
    const free = freePlan();
    expect(free.features.maxResolution).toBe("480p");
    expect(free.features.allowedVideoFamilies.length).toBeGreaterThan(0);
    expect(free.features.maxConcurrentJobs).toBeLessThanOrEqual(1);
  });

  it("加油包每元换到的积分不低于最便宜的付费档（否则加油包毫无意义）", () => {
    const cheapestPaid = [...PLANS.filter((p) => p.priceCents > 0)].sort(
      (a, b) => a.priceCents - b.priceCents
    )[0];
    for (const pack of CREDIT_PACKS) {
      expect(findPack(pack.code)).toBeDefined();
      // 加油包是"随用随买"，单价可以略高于订阅，但不该低到离谱
      expect(pack.credits / pack.priceCents).toBeGreaterThan(
        (cheapestPaid.creditsPerPeriod / cheapestPaid.priceCents) * 0.8
      );
    }
  });

  it("未启用计费时的功能位是真的无限制 —— 自部署用户不该被任何一项挡住", () => {
    expect(UNLIMITED_FEATURES.allowedVideoFamilies).toEqual([]);
    expect(UNLIMITED_FEATURES.maxProjects).toBeNull();
    expect(UNLIMITED_FEATURES.maxResolution).toBe("1080p");
    expect(UNLIMITED_FEATURES.maxConcurrentJobs).toBeGreaterThan(1000);
  });
});
