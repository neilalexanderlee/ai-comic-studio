/**
 * Unit tests for character-image.ts prompt builders.
 *
 * Regression coverage for the fix: character portrait generation
 * (beauty_image / combat_image / character_image) previously ignored
 * project.visualStyle entirely — no visualStyleTag hard-lock, and the
 * role_definition was hardcoded to a "2D动画与插画角色设定师" framing
 * even for 写实真人 (realistic / realistic_ancient) projects.
 */

import { describe, it, expect } from "vitest";
import {
  buildCharacterTurnaroundPrompt,
  buildBeautyImagePrompt,
  buildCombatImagePrompt,
} from "@/lib/ai/prompts/character-image";

const REALISTIC_ANCIENT_STYLE_CONTEXT = {
  visualStyle: "realistic_ancient",
  visualStyleTag: "真人写实摄影，古风写实纪实，影视级摄影质感，强对比度，极致细节，东方古典气韵",
  isRealisticStyle: true,
};

const REALISTIC_URBAN_STYLE_CONTEXT = {
  visualStyle: "realistic",
  visualStyleTag: "真人实拍摄影，真人电影剧照，当代中国都市，电影级摄影，自然光与人造光调度，真实色彩科学",
  isRealisticStyle: true,
};

const ANIME_STYLE_CONTEXT = {
  visualStyleTag: "日本现代2D动漫风格，赛璐璐上色，清晰线条，电影级构图，戏剧化低调光影",
  isRealisticStyle: false,
};

describe("buildBeautyImagePrompt", () => {
  it("without styleContext, falls back to the original 2D role_definition slot (backward compatible)", () => {
    const result = buildBeautyImagePrompt(
      { role_definition: "你是一位顶级的2D动画与插画角色设定师。" },
      "李明",
      "男性，二十出头"
    );
    expect(result).toContain("2D动画与插画角色设定师");
    expect(result).not.toContain("画风硬锁");
  });

  it("for a realistic style project, overrides role_definition with a photography role and adds the realism anchor", () => {
    const result = buildBeautyImagePrompt(
      { role_definition: "你是一位顶级的2D动画与插画角色设定师。" },
      "角色甲",
      "男性，约二十出头",
      REALISTIC_ANCIENT_STYLE_CONTEXT
    );
    expect(result).not.toContain("2D动画与插画角色设定师");
    expect(result).toContain("真人人像摄影师");
    expect(result).toContain("真实质感锚点");
    expect(result).toContain("画风硬锁");
    expect(result).toContain(REALISTIC_ANCIENT_STYLE_CONTEXT.visualStyleTag);
  });

  it("for a realistic ancient style project, does not leak generic render/design-sheet wording", () => {
    const result = buildBeautyImagePrompt(
      {
        role_definition: "你是一位顶级的2D动画与插画角色设定师。",
        style_matching: "如果描述中提到 写实/真人/photorealistic → 生成写实渲染",
        beauty_rules: "纯色背景，无任何杂物、文字或水印。",
        lighting_rendering: "纯白纯色背景，无杂物。在所选画风内达到最高渲染质量",
      },
      "角色甲",
      "男性，约二十出头",
      REALISTIC_ANCIENT_STYLE_CONTEXT
    );
    expect(result).toContain("真人古装剧定妆照");
    expect(result).toContain("真人摄影布光");
    expect(result).not.toContain("写实渲染");
    expect(result).not.toContain("最高渲染质量");
    expect(result).not.toContain("纯白纯色背景");
  });

  it("for a realistic urban style project, uses modern urban photo-shoot wording instead of ancient wording", () => {
    const result = buildBeautyImagePrompt(
      { role_definition: "你是一位顶级的2D动画与插画角色设定师。" },
      "林夏",
      "女性，二十七岁，白衬衫，深色西装裤，手持文件夹",
      REALISTIC_URBAN_STYLE_CONTEXT
    );
    expect(result).toContain("现代都市真人剧定妆照");
    expect(result).toContain("办公室");
    expect(result).not.toContain("古装剧");
    expect(result).not.toContain("古风");
    expect(result).not.toContain("仙侠");
  });

  it("for an anime style project, keeps the original 2D role_definition but still injects the style-lock line", () => {
    const result = buildBeautyImagePrompt(
      { role_definition: "你是一位顶级的2D动画与插画角色设定师。" },
      "李明",
      "男性，二十出头",
      ANIME_STYLE_CONTEXT
    );
    expect(result).toContain("2D动画与插画角色设定师");
    expect(result).not.toContain("真实质感锚点");
    expect(result).toContain("画风硬锁");
    expect(result).toContain(ANIME_STYLE_CONTEXT.visualStyleTag);
  });
});

describe("buildCombatImagePrompt", () => {
  it("for a realistic style project, overrides role_definition with a photography role", () => {
    const result = buildCombatImagePrompt(
      { role_definition: "你是一位顶级的2D动画与动作戏原画师。" },
      "角色甲",
      "武将，持斧",
      REALISTIC_ANCIENT_STYLE_CONTEXT
    );
    expect(result).not.toContain("2D动画与动作戏原画师");
    expect(result).toContain("真人剧组动作指导");
    expect(result).toContain("真实质感锚点");
  });

  it("for a realistic style project, replaces anime/action-effect combat slots with photo-shoot rules", () => {
    const result = buildCombatImagePrompt(
      {
        role_definition: "你是一位顶级的2D动画与动作戏原画师。",
        style_matching: "如果描述中提到 写实/真人/photorealistic → 生成写实渲染",
        combat_rules: "施展魔法/特效的瞬间，重点展现发光特效和战斗动作。",
        weapons_equipment: "动漫/卡通风要有干净的风格化线条",
        lighting_rendering: "纯白纯色背景，无杂物。在所选画风内达到最高渲染质量",
      },
      "角色甲",
      "武将，持斧",
      REALISTIC_ANCIENT_STYLE_CONTEXT
    );
    expect(result).toContain("真人古装剧武装造型摄影照");
    expect(result).toContain("真实剧组道具与服装");
    expect(result).not.toContain("魔法/特效");
    expect(result).not.toContain("发光特效");
    expect(result).not.toContain("风格化线条");
    expect(result).not.toContain("纯白纯色背景");
  });

  it("for a realistic urban style project, uses modern action/occupation wording instead of ancient weapons wording", () => {
    const result = buildCombatImagePrompt(
      { role_definition: "你是一位顶级的2D动画与动作戏原画师。" },
      "林夏",
      "女性，二十七岁，风衣，手持手机，站在写字楼大厅",
      REALISTIC_URBAN_STYLE_CONTEXT
    );
    expect(result).toContain("现代都市真人剧动作或职业造型摄影照");
    expect(result).toContain("手机");
    expect(result).not.toContain("古装剧");
    expect(result).not.toContain("持剑");
    expect(result).not.toContain("仙侠");
  });
});

describe("buildCharacterTurnaroundPrompt", () => {
  it("for a realistic style project, replaces the generic design-sheet framing with a photo-shoot framing", () => {
    const result = buildCharacterTurnaroundPrompt(
      { style_matching: "match the described style" },
      "角色甲",
      "男性，约二十出头",
      REALISTIC_ANCIENT_STYLE_CONTEXT
    );
    expect(result).toContain("真实摄影成像");
    expect(result).toContain("真实质感锚点");
    expect(result).toContain("画风硬锁");
  });

  it("without styleContext, keeps the original generic character-design-sheet framing", () => {
    const result = buildCharacterTurnaroundPrompt(
      { style_matching: "match the described style" },
      "李明",
      "男性，二十出头"
    );
    expect(result).toContain("专业角色设计文档");
    expect(result).not.toContain("真实质感锚点");
  });
});
