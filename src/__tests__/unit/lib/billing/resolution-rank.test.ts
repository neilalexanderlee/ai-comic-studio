/**
 * 分辨率高低比较 —— 画质增强的「还能升到哪些档」和套餐限制都靠它。
 *
 * 它从 `plan-limits.ts`（server-only）挪到了纯模块 `pricing.ts`，
 * 因为画质增强按钮是客户端组件，也要用它判断该显示哪几个按钮。
 */
import { describe, it, expect } from "vitest";
import { resolutionRank, resolutionMultiplier } from "@/lib/billing/pricing";

describe("resolutionRank", () => {
  it("能正确排序常见档位", () => {
    const order = ["480p", "720p", "1080p", "2K", "4k"];
    const ranks = order.map(resolutionRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length); // 不能有并列
  });

  it("大小写与空格容错", () => {
    expect(resolutionRank("720P")).toBe(resolutionRank("720p"));
    expect(resolutionRank(" 1080p ")).toBe(resolutionRank("1080p"));
  });

  it("认不出来的返回 0 —— 宁可漏挡也不要把人挡在门外", () => {
    for (const v of ["", null, undefined, "超清", "auto"]) {
      expect(resolutionRank(v as string)).toBe(0);
    }
  });

  it("升级判定：只允许往上升", () => {
    const canUpgrade = (from: string, to: string) => resolutionRank(to) > resolutionRank(from);
    expect(canUpgrade("480p", "720p")).toBe(true);
    expect(canUpgrade("480p", "1080p")).toBe(true);
    expect(canUpgrade("720p", "1080p")).toBe(true);
    expect(canUpgrade("1080p", "720p")).toBe(false); // 不能降级
    expect(canUpgrade("1080p", "1080p")).toBe(false); // 同档不重复做
  });
});

describe("resolutionMultiplier —— 额度折算的依据", () => {
  it("倍率随分辨率单调上升", () => {
    expect(resolutionMultiplier("480p")).toBe(1);
    expect(resolutionMultiplier("720p")).toBeGreaterThan(resolutionMultiplier("480p"));
    expect(resolutionMultiplier("1080p")).toBeGreaterThan(resolutionMultiplier("720p"));
    expect(resolutionMultiplier("4k")).toBeGreaterThan(resolutionMultiplier("1080p"));
  });

  it("⚠️ 1080p 明显贵于 720p —— 增强的产物记错档位会系统性少扣额度", () => {
    expect(resolutionMultiplier("1080p") / resolutionMultiplier("720p")).toBeGreaterThan(2);
  });

  it("认不出来的按 1 倍", () => {
    expect(resolutionMultiplier("奇怪写法")).toBe(1);
    expect(resolutionMultiplier(null)).toBe(1);
  });
});
