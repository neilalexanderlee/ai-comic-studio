import { describe, it, expect } from "vitest";
import {
  extractOpeningCameraDirection,
  pickFirstFramePromptBuildParams,
  resolveFirstFrameShotKind,
} from "@/lib/storyboard/first-frame-prompt";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";
import { buildFirstFramePrompt } from "@/lib/ai/prompts/frame-generate";

describe("extractOpeningCameraDirection", () => {
  it("keeps only opening segment before arrow chain", () => {
    const result = extractOpeningCameraDirection(
      "起幅[远景] → 跳切至中景 → 手持推进至特写[面部] → 定格"
    );
    expect(result).toContain("起幅[远景]");
    expect(result).not.toContain("跳切至中景");
    expect(result).not.toContain("手持推进");
    expect(result).toContain("勿使用后续");
  });
});

describe("pickFirstFramePromptBuildParams + registry first frame", () => {
  const def = getPromptDefinition("frame_generate_first");

  it("uses startFrameDesc as primary and demotes scene prompt to context", () => {
    const params = pickFirstFramePromptBuildParams({
      shot: {
        prompt: "魔族涌入，村民逃散",
        startFrameDesc: "远景静谧小镇，满月，篝火，无入侵",
        cameraDirection: "起幅[远景] → 特写",
      },
      characterDescriptions: "",
      namedCharacterCount: 0,
      hasContinuityReference: true,
      hasCharacterSheetRefs: false,
    });
    const prompt = def!.buildFullPrompt({}, params);
    expect(prompt).toContain("首帧静止画面");
    expect(prompt).toContain("远景静谧小镇");
    expect(prompt).toContain("镜头情节上下文");
    expect(prompt).toContain("魔族涌入");
    expect(prompt).not.toContain("=== 【强制】背景场景（最高优先级");
    expect(prompt).toContain("镜间衔接帧");
    expect(prompt).toContain("环境/群演首帧");
    expect(prompt).not.toContain("角色占画面40-70%");
  });

  it("environment shot uses character slot rendering only when named chars exist", () => {
    expect(resolveFirstFrameShotKind(0)).toBe("environment");
    const envParams = pickFirstFramePromptBuildParams({
      shot: { prompt: "场景", startFrameDesc: "空镜", cameraDirection: null },
      characterDescriptions: "",
      namedCharacterCount: 0,
      hasContinuityReference: false,
      hasCharacterSheetRefs: false,
    });
    const envPrompt = buildFirstFramePrompt(envParams);
    expect(envPrompt).toContain("环境/群演首帧");

    const charParams = pickFirstFramePromptBuildParams({
      shot: { prompt: "场景", startFrameDesc: "龙渊特写", cameraDirection: null },
      characterDescriptions: "龙渊: …",
      namedCharacterCount: 1,
      hasContinuityReference: false,
      hasCharacterSheetRefs: true,
    });
    const charPrompt = def!.buildFullPrompt({}, charParams);
    expect(charPrompt).toContain("有具名角色镜头");
  });
});
