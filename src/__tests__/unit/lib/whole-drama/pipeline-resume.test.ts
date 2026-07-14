import { describe, expect, it } from "vitest";
import { resolveWholeDramaResume, type WholeDramaImportLog } from "@/lib/whole-drama/pipeline-resume";

const init = (sourceType: "idea" | "novel" | "script"): WholeDramaImportLog => ({
  step: 0,
  status: "done",
  message: "整剧模式项目已创建",
  metadata: { phase: "whole_drama_init", sourceType },
});

describe("resolveWholeDramaResume", () => {
  it("从持久化初始化日志恢复小说来源", () => {
    const state = resolveWholeDramaResume({ script: "小说原文" }, [init("novel")]);

    expect(state.sourceType).toBe("novel");
    expect(state.sourceText).toBe("小说原文");
    expect(state.snapshot.step1Done).toBe(false);
  });

  it("不会把文件解析日志误判为小说改编完成", () => {
    const state = resolveWholeDramaResume(
      { script: "解析后的小说原文" },
      [init("novel"), { step: 1, status: "done", message: "文件解析完成", metadata: { charCount: 1000 } }]
    );

    expect(state.snapshot.step1Done).toBe(false);
  });

  it("恢复已经完成的角色与分集结果", () => {
    const characters = [{ name: "角色甲", frequency: 3, description: "主角" }];
    const episodes = [{ title: "第 1 集", description: "开端", keywords: "", idea: "正文" }];
    const state = resolveWholeDramaResume(
      { script: "改编后的剧本" },
      [
        init("novel"),
        { step: 1, status: "done", message: "小说改编完成", metadata: { phase: "source_transform" } },
        { step: 2, status: "done", message: "角色完成", metadata: { characters } },
        { step: 3, status: "done", message: "分集完成", metadata: { episodes } },
      ]
    );

    expect(state.snapshot.step1Done).toBe(true);
    expect(state.snapshot.characters).toEqual(characters);
    expect(state.snapshot.episodes).toEqual(episodes);
    expect(state.snapshot.step3Done).toBe(true);
  });

  it("已有剧本不需要 source_transform 日志", () => {
    const state = resolveWholeDramaResume({ script: "完整剧本" }, [init("script")]);

    expect(state.snapshot.step1Done).toBe(true);
  });
});
