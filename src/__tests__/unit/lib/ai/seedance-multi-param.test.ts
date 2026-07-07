/**
 * Unit tests for seedance-multi-param.ts
 *
 * 覆盖角度变体的 @参考N 编号、参考定义段格式、9 张上限（Seedance 2.0 多模态视频生成）等核心行为。
 */

import { describe, it, expect } from "vitest";
import {
  buildSeedanceMultiParamVideoPrompt,
  type SeedanceAsset,
  type SeedanceShot,
} from "@/lib/ai/prompts/seedance-multi-param";

// ── 基础 Fixture ──────────────────────────────────────────────────────────────

const shotBase: SeedanceShot = {
  hasStoryboardImage: false,
  duration: 5,
  sceneDescription: "角色甲站在画面中央",
  dialogues: [],
};

const shotWithImage: SeedanceShot = {
  ...shotBase,
  hasStoryboardImage: true,
  storyboardImagePath: "/uploads/shot1.png",
};

// ── 辅助：从输出提取参考定义段行 ──────────────────────────────────────────────

function extractRefLines(output: string): string[] {
  const lines = output.split("\n");
  const start = lines.findIndex((l) => l.startsWith("参考定义:"));
  if (start === -1) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith("生成一个"));
  const block = end === -1 ? lines.slice(start + 1) : lines.slice(start + 1, end);
  return block.filter((l) => l.startsWith("@参考"));
}

// ── 无角度变体（基准行为，不应回归）────────────────────────────────────────────

describe("无角度变体时的基准行为", () => {
  const assets: SeedanceAsset[] = [
    { id: "a1", name: "角色甲", type: "role" },
    { id: "a2", name: "角色乙", type: "role" },
  ];

  it("两角色无分镜图：@参考1、@参考2 各对应一个角色", () => {
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotBase] })
    );
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatch(/^@参考1: 角色甲/);
    expect(refs[1]).toMatch(/^@参考2: 角色乙/);
  });

  it("无角度变体时，角色主图行不含'正面（外貌主参考）'", () => {
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotBase] })
    );
    expect(refs[0]).not.toContain("正面（外貌主参考）");
  });

  it("有分镜图时：storyboard_image 编号紧跟角色图之后", () => {
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotWithImage] })
    );
    // @参考1 角色甲，@参考2 角色乙，@参考3 分镜图
    expect(refs).toHaveLength(3);
    expect(refs[2]).toMatch(/^@参考3: 分镜1/);
  });
});

// ── 角度变体编号 ───────────────────────────────────────────────────────────────

describe("角度变体 @参考N 编号", () => {
  it("单角色有 3q 变体：主图 @参考1，3q 变体 @参考2", () => {
    const assets: SeedanceAsset[] = [
      {
        id: "a1",
        name: "角色甲",
        type: "role",
        angleImages: [{ angle: "3q", path: "/uploads/char-3q.png" }],
      },
    ];
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotBase] })
    );
    expect(refs[0]).toMatch(/^@参考1: 角色甲，角色正面（外貌主参考）/);
    expect(refs[1]).toMatch(/^@参考2: 角色甲四分之三侧面视图（与@参考1同一角色/);
  });

  it("单角色有 3 个角度变体：编号 1→2→3→4（主图+3q+profile+back）", () => {
    const assets: SeedanceAsset[] = [
      {
        id: "a1",
        name: "角色甲",
        type: "role",
        angleImages: [
          { angle: "3q", path: "/uploads/3q.png" },
          { angle: "profile", path: "/uploads/profile.png" },
          { angle: "back", path: "/uploads/back.png" },
        ],
      },
    ];
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotBase] })
    );
    expect(refs).toHaveLength(4);
    expect(refs[0]).toMatch(/^@参考1:/);
    expect(refs[1]).toMatch(/^@参考2:.*四分之三侧面/);
    expect(refs[2]).toMatch(/^@参考3:.*正侧面/);
    expect(refs[3]).toMatch(/^@参考4:.*背面/);
  });

  it("两角色各有角度变体：编号不错位（甲主图→甲变体→乙主图→乙变体）", () => {
    const assets: SeedanceAsset[] = [
      {
        id: "a1",
        name: "角色甲",
        type: "role",
        angleImages: [{ angle: "3q", path: "/uploads/jia-3q.png" }],
      },
      {
        id: "a2",
        name: "角色乙",
        type: "role",
        angleImages: [{ angle: "profile", path: "/uploads/yi-profile.png" }],
      },
    ];
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotBase] })
    );
    // @参考1 甲主图，@参考2 甲3q，@参考3 乙主图，@参考4 乙侧面
    expect(refs[0]).toMatch(/^@参考1: 角色甲/);
    expect(refs[1]).toMatch(/^@参考2: 角色甲四分之三侧面.*@参考1/);
    expect(refs[2]).toMatch(/^@参考3: 角色乙/);
    expect(refs[3]).toMatch(/^@参考4: 角色乙正侧面.*@参考3/);
  });

  it("有角度变体时分镜图编号紧跟最后一个角度变体", () => {
    const assets: SeedanceAsset[] = [
      {
        id: "a1",
        name: "角色甲",
        type: "role",
        angleImages: [{ angle: "3q", path: "/uploads/3q.png" }],
      },
    ];
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotWithImage] })
    );
    // @参考1 主图，@参考2 3q变体，@参考3 分镜图
    expect(refs).toHaveLength(3);
    expect(refs[2]).toMatch(/^@参考3: 分镜1/);
  });

  it("有音频时：音频编号跟在所有图片之后", () => {
    const assets: SeedanceAsset[] = [
      {
        id: "a1",
        name: "角色甲",
        type: "role",
        hasAudio: true,
        angleImages: [{ angle: "3q", path: "/uploads/3q.png" }],
      },
    ];
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotBase] })
    );
    // @参考1 主图，@参考2 3q变体，@参考3 音频
    // 主图行末尾应有 "参考音频为：@参考3"
    expect(refs[0]).toContain("参考音频为：@参考3");
    // 音频行不独立出现（追加在主图行尾，不新起行）
    expect(refs).toHaveLength(2); // 主图 + 3q变体，音频不新起行
  });
});

// ── 非角色资产不受影响 ─────────────────────────────────────────────────────────

describe("非角色资产（scene/prop）不标注'正面（外貌主参考）'", () => {
  it("场景资产主图行只显示'场景'描述，无角度后缀", () => {
    const assets: SeedanceAsset[] = [
      { id: "s1", name: "书房", type: "scene" },
    ];
    const refs = extractRefLines(
      buildSeedanceMultiParamVideoPrompt({ assets, shots: [shotBase] })
    );
    expect(refs[0]).toBe("@参考1: 书房，场景");
  });
});
