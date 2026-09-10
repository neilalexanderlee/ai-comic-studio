import { describe, it, expect } from "vitest";
import { roleBadge } from "@/components/admin/role-badge";

describe("用户列表的角色徽章", () => {
  it("普通用户不挂徽章", () => {
    expect(roleBadge("user", false)).toBeNull();
  });

  it("运营 admin 挂「运营管理员」，且永远不会被当成 Key 来源", () => {
    expect(roleBadge("admin", false)?.text).toBe("运营管理员");
    // 就算 isPlatformKeyOwner 传错也不该出现 owner 文案
    expect(roleBadge("admin", true)?.text).toBe("运营管理员");
  });

  /**
   * 这条是这个函数存在的理由：role 列没有唯一约束，可以有多个 owner，
   * 而 getPlatformKeyOwnerId() 只取创建最早的那个。两人都「可配置密钥」，
   * 但只有一个是当前实际生效的 Key 来源 —— 合并成一个判断就会丢掉这个区别。
   */
  it("多个 owner 时，只有生效的那个说「平台 Key 来源」", () => {
    expect(roleBadge("owner", true)?.text).toBe("owner · 平台 Key 来源");
    expect(roleBadge("owner", false)?.text).toBe("owner · 可配置密钥");
  });

  it("两种 owner 徽章用同一套配色 —— 区别在文案不在颜色", () => {
    expect(roleBadge("owner", true)?.className).toBe(roleBadge("owner", false)?.className);
  });

  it("未知角色按普通用户处理，不会漏挂成管理员徽章", () => {
    expect(roleBadge("", false)).toBeNull();
    expect(roleBadge("superuser", true)).toBeNull();
  });
});
