import { describe, expect, it } from "vitest";
import { validateWholeDramaSourceLength, WHOLE_DRAMA_SOURCE_LIMITS } from "@/lib/whole-drama/limits";

describe("validateWholeDramaSourceLength", () => {
  it("拒绝空输入", () => {
    expect(validateWholeDramaSourceLength("idea", "   ")).toBe("输入内容不能为空");
  });

  it("接受限制内的内容", () => {
    expect(validateWholeDramaSourceLength("novel", "正文")).toBeNull();
  });

  it("接受超过 15 万字的成熟剧本，由后续流程分块分析", () => {
    expect(validateWholeDramaSourceLength("script", "字".repeat(170_707))).toBeNull();
  });

  it("拒绝超过小说来源限制的内容", () => {
    const novelLimit = WHOLE_DRAMA_SOURCE_LIMITS.novel;
    expect(novelLimit).not.toBeNull();
    const text = "字".repeat((novelLimit ?? 0) + 1);
    expect(validateWholeDramaSourceLength("novel", text)).toContain("不能超过");
  });
});
