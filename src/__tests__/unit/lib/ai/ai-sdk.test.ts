import { describe, expect, it } from "vitest";
import { extractJSON } from "@/lib/ai/ai-sdk";

describe("extractJSON", () => {
  it("ignores a lone slash after a complete JSON object", () => {
    const result = extractJSON('{"description":"角色描述","visualHint":"银发金瞳"}\n/');

    expect(JSON.parse(result)).toEqual({
      description: "角色描述",
      visualHint: "银发金瞳",
    });
  });

  it("ignores prose after a complete JSON array", () => {
    expect(JSON.parse(extractJSON('[{"name":"角色甲"}]\n以上是结果。'))).toEqual([
      { name: "角色甲" },
    ]);
  });

  it("keeps braces inside JSON strings", () => {
    expect(JSON.parse(extractJSON('{"description":"披风纹样 {甲}，持剑"}\n/'))).toEqual({
      description: "披风纹样 {甲}，持剑",
    });
  });
});
