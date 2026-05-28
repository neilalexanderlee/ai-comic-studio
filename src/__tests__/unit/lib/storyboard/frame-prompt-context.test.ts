import { describe, it, expect } from "vitest";
import {
  extractClosingCameraDirection,
  extractOpeningCameraDirection,
  pickFirstFramePromptBuildParams,
  pickLastFramePromptBuildParams,
  resolveFrameShotKind,
} from "@/lib/storyboard/frame-prompt-context";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";
import { buildLastFramePrompt } from "@/lib/ai/prompts/frame-generate";

describe("extractClosingCameraDirection", () => {
  it("keeps only closing segment after arrow chain", () => {
    const result = extractClosingCameraDirection(
      "起幅[远景] → 跳切至中景 → 手持推进至特写[面部] → 定格落幅"
    );
    expect(result).toContain("定格落幅");
    expect(result).not.toContain("起幅[远景]");
    expect(result).toContain("落幅");
  });
});

describe("pickLastFramePromptBuildParams + registry last frame", () => {
  const def = getPromptDefinition("frame_generate_last");

  it("uses endFrameDesc as primary and demotes scene prompt to context", () => {
    const params = pickLastFramePromptBuildParams({
      shot: {
        prompt: "魔族涌入，村民逃散",
        endFrameDesc: "远景小镇火光收束，满月，无前景正脸",
        cameraDirection: "起幅[远景] → 定格落幅",
      },
      characterDescriptions: "",
      namedCharacterCount: 0,
      hasAnchorFirst: true,
      hasCharacterSheetRefs: false,
    });
    const prompt = def!.buildFullPrompt({}, params);
    expect(prompt).toContain("尾帧静止画面");
    expect(prompt).toContain("远景小镇火光收束");
    expect(prompt).toContain("镜头情节上下文");
    expect(prompt).toContain("魔族涌入");
    expect(prompt).not.toContain("=== 【强制】背景场景（无独立尾帧描述时的回退）");
    expect(prompt).toContain("环境/群演尾帧");
    expect(prompt).not.toContain("角色占画面40-70%");
  });

  it("environment last frame via buildLastFramePrompt", () => {
    expect(resolveFrameShotKind(0)).toBe("environment");
    const prompt = buildLastFramePrompt(
      pickLastFramePromptBuildParams({
        shot: { prompt: "入侵", endFrameDesc: "空镜收束", cameraDirection: null },
        characterDescriptions: "",
        namedCharacterCount: 0,
        hasAnchorFirst: true,
        hasCharacterSheetRefs: false,
      })
    );
    expect(prompt).toContain("环境/群演尾帧");
  });
});

describe("pickFirstFramePromptBuildParams", () => {
  it("opening camera extraction unchanged", () => {
    const result = extractOpeningCameraDirection("起幅[远景] → 特写");
    expect(result).toContain("起幅[远景]");
    expect(result?.split("→")[0]).not.toMatch(/特写$/);
  });
});
