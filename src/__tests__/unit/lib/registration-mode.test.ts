/**
 * 注册准入模式。
 *
 * 锁住的不变量：
 *  · **未设 `REGISTRATION_MODE` 时行为与改造前完全一致** —— 这是本项目反复强调的
 *    「默认值要让单机装机即用」（BILLING_ENABLED / WORKER_IN_WEB / REQUIRE_AUTH 同理）
 *  · 两个开关冲突时 **fail closed** —— `ALLOW_REGISTRATION=0` 是别人当安全措施设下的，
 *    不能被一个后加的开关静默地重新打开
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  registrationConflictHint,
  registrationModeIsUnrecognized,
  resolveRegistrationMode,
} from "@/lib/registration";

afterEach(() => vi.unstubAllEnvs());

describe("未设 REGISTRATION_MODE 时完全等价于旧的 ALLOW_REGISTRATION", () => {
  it("两者都没设 → open（自部署第一次打开就能建号）", () => {
    expect(resolveRegistrationMode()).toBe("open");
  });

  it("ALLOW_REGISTRATION=0 → closed", () => {
    vi.stubEnv("ALLOW_REGISTRATION", "0");
    expect(resolveRegistrationMode()).toBe("closed");
  });

  it.each(["1", "true", "yes", ""])("ALLOW_REGISTRATION=%s → open（只认字面量 0）", (v) => {
    vi.stubEnv("ALLOW_REGISTRATION", v);
    expect(resolveRegistrationMode()).toBe("open");
  });
});

describe("三态", () => {
  it.each(["open", "invite", "closed"] as const)("REGISTRATION_MODE=%s 生效", (mode) => {
    vi.stubEnv("REGISTRATION_MODE", mode);
    expect(resolveRegistrationMode()).toBe(mode);
  });

  it("大小写与空格容错", () => {
    vi.stubEnv("REGISTRATION_MODE", "  INVITE ");
    expect(resolveRegistrationMode()).toBe("invite");
  });

  it("认不出来的值回落到旧开关，并且能被检出以便告警", () => {
    vi.stubEnv("REGISTRATION_MODE", "whitelist");
    expect(resolveRegistrationMode()).toBe("open");
    expect(registrationModeIsUnrecognized()).toBe(true);
  });
});

describe("冲突时 fail closed", () => {
  it("ALLOW_REGISTRATION=0 压过 REGISTRATION_MODE=invite", () => {
    vi.stubEnv("ALLOW_REGISTRATION", "0");
    vi.stubEnv("REGISTRATION_MODE", "invite");
    expect(resolveRegistrationMode()).toBe("closed");
  });

  it("冲突时必须给出可操作的说明 —— 否则「设了 invite 却注册不了」毫无线索", () => {
    vi.stubEnv("ALLOW_REGISTRATION", "0");
    vi.stubEnv("REGISTRATION_MODE", "invite");
    const hint = registrationConflictHint();
    expect(hint).toContain("ALLOW_REGISTRATION");
    expect(hint).toContain("REGISTRATION_MODE");
  });

  it("不冲突时不产生噪音", () => {
    vi.stubEnv("REGISTRATION_MODE", "invite");
    expect(registrationConflictHint()).toBeNull();
  });
});
