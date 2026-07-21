/**
 * Unit tests: expandMotionScriptBrackets
 *
 * 覆盖点：
 * 1. 旧格式（无 [] 包裹）原样透传
 * 2. 单主体 bracket（无角色名冒号）— 展开为动词短语
 * 3. 具名角色 bracket（角色名:动作→动作）— 展开为「角色名动作、动作」
 * 4. 同一时间段多个 bracket — 用「；随后」衔接
 * 5. prose 模式 — 去掉时间码，跨段用「，随后」衔接
 * 6. 朝向后缀 | 朝向：xxx — 默认模式保留，prose 模式追加
 * 7. 空输入 / 纯空格
 * 8. 多段 bracket 顺序锁定（不允许 LLM 重排）
 * 9. 段落内 → 替换为 、（具名角色动作链）
 */

import { describe, it, expect } from "vitest";
import { expandMotionScriptBrackets } from "@/lib/ai/prompts/ref-video-prompt-generate";

// ── 1. 旧格式透传 ───────────────────────────────────────────────────────────

describe("旧格式（无 []）透传", () => {
  it("没有 bracket 时原样返回", () => {
    const input = "0-3s: 角色甲回头望向角色乙 3-7s: 角色乙嘴唇微颤无声";
    expect(expandMotionScriptBrackets(input)).toBe(input);
  });

  it("普通散文原样返回", () => {
    const input = "李明转身迈步，随后推开门";
    expect(expandMotionScriptBrackets(input)).toBe(input);
  });

  it("空字符串原样返回", () => {
    expect(expandMotionScriptBrackets("")).toBe("");
    expect(expandMotionScriptBrackets("   ")).toBe("");
  });
});

// ── 2. 单主体 bracket ───────────────────────────────────────────────────────

describe("单主体 bracket（无角色名冒号）", () => {
  it("展开单个 bracket 为内容文本", () => {
    const input = "0-5s: [李明转身迈步]";
    const result = expandMotionScriptBrackets(input);
    expect(result).toContain("李明转身迈步");
    expect(result).not.toContain("[");
  });

  it("bracket 内 → 替换为 、", () => {
    const input = "0-5s: [转身→迈步→推开门]";
    const result = expandMotionScriptBrackets(input);
    expect(result).toContain("转身、迈步、推开门");
  });
});

// ── 3. 具名角色 bracket ─────────────────────────────────────────────────────

describe("具名角色 bracket（角色名:动作→动作）", () => {
  it("展开为「角色名动作、动作」", () => {
    const input = "0-3s: [角色甲:转身→迈步]";
    const result = expandMotionScriptBrackets(input);
    expect(result).toContain("角色甲转身、迈步");
    expect(result).not.toContain("[");
    expect(result).not.toContain("→");
  });

  it("短名字（≤8字）认为是角色名", () => {
    const input = "0-4s: [角色乙:嘴唇微颤→眼睑下垂]";
    const result = expandMotionScriptBrackets(input);
    expect(result).toContain("角色乙嘴唇微颤、眼睑下垂");
  });

  it("冒号前含标点 → 不当角色名处理，整体 → 替换为 、", () => {
    // 冒号前有逗号，不是角色名
    const input = "0-3s: [转身，回望:此处不是角色名]";
    const result = expandMotionScriptBrackets(input);
    // 因为 potentialName 含逗号，不被识别为角色，整体当动作处理
    expect(result).not.toContain("[");
  });
});

// ── 4. 同一时间段多个 bracket ────────────────────────────────────────────────

describe("同一时间段多个 bracket — 叙事顺序锁定", () => {
  it("多个 bracket 用「；随后」衔接（默认模式）", () => {
    const input = "0-7s: [角色甲:转身→迈步] [角色乙:嘴唇微颤→眼睑下垂]";
    const result = expandMotionScriptBrackets(input);
    expect(result).toContain("角色甲转身、迈步");
    expect(result).toContain("角色乙嘴唇微颤、眼睑下垂");
    // 角色甲在前（叙事先行）
    expect(result.indexOf("角色甲")).toBeLessThan(result.indexOf("角色乙"));
  });

  it("三个 bracket 保持顺序", () => {
    const input = "0-9s: [甲:动作A] [乙:动作B] [丙:动作C]";
    const result = expandMotionScriptBrackets(input);
    const posA = result.indexOf("甲");
    const posB = result.indexOf("乙");
    const posC = result.indexOf("丙");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
  });
});

// ── 5. 默认模式（保留时间码）────────────────────────────────────────────────

describe("默认模式 — 保留时间码", () => {
  it("展开后时间码仍在结果中", () => {
    const input = "0-3s: [李明:转身] 3-7s: [角色乙:抬头]";
    const result = expandMotionScriptBrackets(input);
    expect(result).toMatch(/0-3s/);
    expect(result).toMatch(/3-7s/);
  });

  it("多段展开不打乱顺序", () => {
    const input = "0-3s: [甲:走近] 3-6s: [乙:后退]";
    const result = expandMotionScriptBrackets(input);
    expect(result.indexOf("甲")).toBeLessThan(result.indexOf("乙"));
  });
});

// ── 6. prose 模式 ───────────────────────────────────────────────────────────

describe("prose 模式（opts.prose = true）", () => {
  it("去掉时间码", () => {
    const input = "0-3s: [李明:转身→迈步] 3-7s: [李明:推开门]";
    const result = expandMotionScriptBrackets(input, { prose: true });
    expect(result).not.toMatch(/\d+-\d+s/);
    expect(result).not.toMatch(/s\s*[:：]/);
  });

  it("跨段用「，随后」衔接", () => {
    const input = "0-3s: [李明:转身→迈步] 3-7s: [李明:推开门]";
    const result = expandMotionScriptBrackets(input, { prose: true });
    expect(result).toContain("，随后");
    expect(result).toContain("李明转身、迈步");
    expect(result).toContain("李明推开门");
  });

  it("单段 prose — 无「，随后」", () => {
    const input = "0-5s: [角色甲:握剑→前冲]";
    const result = expandMotionScriptBrackets(input, { prose: true });
    expect(result).not.toContain("，随后");
    expect(result).toContain("角色甲握剑、前冲");
  });

  it("prose 模式：无 bracket 时原样返回（旧格式兼容）", () => {
    const input = "李明走向窗边，回望来时路";
    expect(expandMotionScriptBrackets(input, { prose: true })).toBe(input);
  });
});

// ── 7. 朝向后缀 ─────────────────────────────────────────────────────────────

describe("朝向后缀 | 朝向：xxx", () => {
  it("默认模式保留朝向后缀", () => {
    const input = "0-5s: [角色甲:转身] | 朝向：角色甲正面面朝镜头";
    const result = expandMotionScriptBrackets(input);
    expect(result).toContain("朝向：角色甲正面面朝镜头");
  });

  it("prose 模式朝向后缀以「，朝向」形式追加", () => {
    const input = "0-5s: [角色甲:转身] | 朝向：角色甲正面面朝镜头";
    const result = expandMotionScriptBrackets(input, { prose: true });
    expect(result).toContain("朝向");
    expect(result).toContain("角色甲正面面朝镜头");
  });

  it("朝向后缀不出现在展开正文中", () => {
    const input = "0-4s: [角色乙:抬头] | 朝向：角色乙侧面右朝";
    const result = expandMotionScriptBrackets(input);
    // 朝向应在最末尾，正文里不应在时间段展开里出现
    const bodyEnd = result.indexOf("| 朝向");
    expect(bodyEnd).toBeGreaterThan(0);
  });
});

// ── 8. 完整句子测试（对齐 buildDirectVideoPrompt 用法）────────────────────────

describe("完整句子 — buildDirectVideoPrompt 用法场景", () => {
  it("prose 模式正确组装视频提示词片段", () => {
    const input = "0-3s: [李明:转身→迈步] 3-7s: [李明:推开门]";
    const result = expandMotionScriptBrackets(input, { prose: true });
    // 期望 "李明转身、迈步，随后李明推开门"
    expect(result).toBe("李明转身、迈步，随后李明推开门");
  });

  it("多角色跨段 prose", () => {
    const input = "0-3s: [角色甲:握剑] [角色乙:后退] 3-7s: [角色甲:挥剑]";
    const result = expandMotionScriptBrackets(input, { prose: true });
    expect(result).toContain("角色甲握剑");
    expect(result).toContain("角色乙后退");
    expect(result).toContain("，随后");
    expect(result).toContain("角色甲挥剑");
  });
});
