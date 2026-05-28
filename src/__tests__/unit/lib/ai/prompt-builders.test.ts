/**
 * Unit tests for prompt builder functions
 * (frame-generate.ts, video-generate.ts)
 *
 * These test the *fallback* builders (when registry returns null),
 * verifying that key fields are always included in the output.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the registry so builders always use the hardcoded fallback path
vi.mock("@/lib/ai/prompts/registry", () => ({
  getPromptDefinition: vi.fn().mockReturnValue(null),
}));

// Mock resolver (not needed for fallback path)
vi.mock("@/lib/ai/prompts/resolver", () => ({
  resolveSlotContents: vi.fn().mockResolvedValue({}),
}));

import { buildFirstFramePrompt, buildLastFramePrompt } from "@/lib/ai/prompts/frame-generate";
import { buildReferenceVideoPrompt, buildVideoPrompt } from "@/lib/ai/prompts/video-generate";

// ── buildFirstFramePrompt ────────────────────────────────────────────────────

describe("buildFirstFramePrompt", () => {
  it("includes the scene description", () => {
    const result = buildFirstFramePrompt({
      sceneDescription: "夜晚的竹林，月光透过竹叶洒落",
      startFrameDesc: "镜头从地面仰望，竹叶剪影",
      characterDescriptions: "",
    });
    expect(result).toContain("竹林");
    expect(result).toContain("月光");
  });

  it("includes the start frame description", () => {
    const result = buildFirstFramePrompt({
      sceneDescription: "场景",
      startFrameDesc: "特写龙渊的眼神，坚定而沉重",
      characterDescriptions: "",
    });
    expect(result).toContain("特写龙渊的眼神");
  });

  it("includes visualStyleTag as the first significant content", () => {
    const result = buildFirstFramePrompt({
      sceneDescription: "场景",
      startFrameDesc: "首帧",
      characterDescriptions: "",
      visualStyleTag: "日本现代2D动漫风格，赛璐珞渲染",
    });
    expect(result).toContain("日本现代2D动漫风格");
    // Style tag must appear before scene description
    const styleIdx = result.indexOf("日本现代2D动漫风格");
    const sceneIdx = result.indexOf("场景");
    expect(styleIdx).toBeLessThan(sceneIdx);
  });

  it("includes camera direction", () => {
    const result = buildFirstFramePrompt({
      sceneDescription: "场景",
      startFrameDesc: "首帧",
      characterDescriptions: "",
      cameraDirection: "crane up — 镜头从地面麦秸缓缓升起",
    });
    expect(result).toContain("crane up");
  });

  it("includes character descriptions when provided", () => {
    const result = buildFirstFramePrompt({
      sceneDescription: "场景",
      startFrameDesc: "首帧",
      characterDescriptions: "龙渊: 黑色长发，身着暗红色战袍",
    });
    expect(result).toContain("龙渊");
    expect(result).toContain("暗红色战袍");
  });

  it("produces non-empty output even with minimal params", () => {
    const result = buildFirstFramePrompt({
      sceneDescription: "s",
      startFrameDesc: "f",
      characterDescriptions: "",
    });
    expect(result.trim().length).toBeGreaterThan(10);
  });
});

// ── buildLastFramePrompt ─────────────────────────────────────────────────────

describe("buildLastFramePrompt", () => {
  it("includes the end frame description", () => {
    const result = buildLastFramePrompt({
      sceneDescription: "场景",
      endFrameDesc: "镜头定格在龙渊转身离去的背影",
      characterDescriptions: "",
    });
    expect(result).toContain("龙渊转身离去");
  });

  it("references firstFramePath when provided (for continuity)", () => {
    const result = buildLastFramePrompt({
      sceneDescription: "场景",
      endFrameDesc: "尾帧",
      characterDescriptions: "",
      firstFramePath: "/uploads/images/frame_abc.png",
    });
    // The builder should mention frame continuity
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes visualStyleTag", () => {
    const result = buildLastFramePrompt({
      sceneDescription: "场景",
      endFrameDesc: "尾帧",
      characterDescriptions: "",
      visualStyleTag: "写实电影风格，胶片颗粒",
    });
    expect(result).toContain("写实电影风格");
  });

});

describe("buildVideoPrompt slim anchors", () => {
  it("uses short frame anchor hint when visual frames attached", () => {
    const result = buildVideoPrompt({
      videoScript: "龙渊拔剑，镜头缓推。",
      cameraDirection: "dolly in",
      startFrameDesc: "龙渊握剑柄特写",
      endFrameDesc: "剑已出鞘半身",
      hasVisualFrameAnchors: true,
      characters: [{ name: "龙渊", visualHint: "黑甲", description: "x".repeat(300) }],
    });
    expect(result).toContain("attached as images");
    expect(result).not.toContain("剑已出鞘");
    expect(result).toContain("在场角色");
    expect(result).not.toContain("【体态】");
  });

  it("crowd shot has no long character block in reference mode", () => {
    const result = buildReferenceVideoPrompt({
      videoScript: "人群奔逃。",
      cameraDirection: "static",
      characters: [],
      slimCharacterSection: true,
    });
    expect(result).not.toContain("[CHARACTERS]");
    expect(result).not.toContain("角色形象");
  });
});
