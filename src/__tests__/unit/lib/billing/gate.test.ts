/**
 * 闸门的**默认关闭**语义测试。
 *
 * 这是本项目最容易造成事故的一个开关：本项目同时是可自部署的开源软件
 * （用户自带 API Key，没有也不需要积分）和托管 SaaS（平台统一 Key，按积分计费）。
 * 如果闸门默认开启，自部署用户一装上就会因为余额为 0 而完全不能用。
 *
 * 所以本文件锁死的不变量是：**未设 BILLING_ENABLED=1 时，闸门不碰数据库、
 * 不返回 402、settle/refund 均为空操作。**
 */

import { describe, it, expect, afterEach, vi } from "vitest";

async function freshGate() {
  vi.resetModules();
  return await import("@/lib/billing/gate");
}

// vi.resetModules() 后重新 import 会把整条依赖链（db / drizzle）重新求值，
// 实测单次约 3 秒，机器一忙就会超过 vitest 默认的 5 秒。
// 慢在模块加载本身、与断言无关，所以给这一组显式放宽超时，而不是让它偶发 flaky。
const SLOW_IMPORT_TIMEOUT = 30_000;

describe("计费闸门默认关闭", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("未设 BILLING_ENABLED 时 isBillingEnabled 为 false", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    const { isBillingEnabled } = await freshGate();
    expect(isBillingEnabled()).toBe(false);
  }, SLOW_IMPORT_TIMEOUT);

  it.each(["0", "false", "true", "yes", "on", ""])(
    'BILLING_ENABLED="%s" 不应启用（只认字面量 "1"）',
    async (val) => {
      vi.stubEnv("BILLING_ENABLED", val);
      const { isBillingEnabled } = await freshGate();
      expect(isBillingEnabled()).toBe(false);
    },
    SLOW_IMPORT_TIMEOUT
  );

  it('只有 BILLING_ENABLED="1" 才启用', async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const { isBillingEnabled } = await freshGate();
    expect(isBillingEnabled()).toBe(true);
  }, SLOW_IMPORT_TIMEOUT);

  it("关闭时 openBillingGate 返回空操作，且不触碰数据库", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    const { openBillingGate } = await freshGate();

    const gate = await openBillingGate("any-user", {
      kind: "video",
      modelId: "doubao-seedance-2-5-260628",
      durationSeconds: 30,
      resolution: "1080p",
    });

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    // 即便是最贵的组合，关闭时也必须是 0，且不抛异常
    expect(gate.credits).toBe(0);
    await expect(gate.settle()).resolves.toBeUndefined();
    await expect(gate.refund("x")).resolves.toBeUndefined();
  }, SLOW_IMPORT_TIMEOUT);

  it("关闭时不会因为用户不存在 / 余额为 0 而返回 402", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    const { openBillingGate } = await freshGate();
    for (const kind of ["video", "image", "music"] as const) {
      const gate = await openBillingGate("user-with-no-account", { kind });
      expect(gate.ok, `${kind} 在计费关闭时不应被拦截`).toBe(true);
    }
  }, SLOW_IMPORT_TIMEOUT);
});
