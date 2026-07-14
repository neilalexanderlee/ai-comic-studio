import { describe, expect, it } from "vitest";
import { buildNovelCondensePrompt, buildOutlineExpandPrompt } from "@/lib/ai/prompts/outline-expand";

describe("buildOutlineExpandPrompt", () => {
  it("为故事想法补充整剧扩写约束", () => {
    const prompt = buildOutlineExpandPrompt("少年寻找古剑", "idea");

    expect(prompt).toContain("故事想法");
    expect(prompt).toContain("补全世界观、人物弧光与多集剧情结构");
    expect(prompt).toContain("少年寻找古剑");
  });

  it("为小说改编保留原作主线", () => {
    const prompt = buildOutlineExpandPrompt("第一章正文", "novel");

    expect(prompt).toContain("小说正文或梗概");
    expect(prompt).toContain("保留原作核心人物关系、主线冲突与关键转折");
    expect(prompt).toContain("第一章正文");
  });

  it("长小说分段摘要携带稳定的段落序号", () => {
    const prompt = buildNovelCondensePrompt("章节正文", 1, 3);

    expect(prompt).toContain("第 2/3 段");
    expect(prompt).toContain("章节正文");
    expect(prompt).toContain("800 字以内");
  });
});
