/**
 * 结构性防回归测试：防止"新增/修改风格时漏同步某处"这一类低级 bug 再次出现
 * （历史案例：realistic_ancient/anime_2d_retro 曾在多处被遗漏，参见 CLAUDE.md 已知陷阱表）。
 *
 * 只做「文件是否存在」「key 是否存在」「字段是否非空」这类结构性断言，不碰任何 prose 措辞，
 * 因此新增风格时只要漏配一项就会在这里直接失败，而不是像正则解析 markdown 那样静默退化。
 */

import { describe, it, expect, vi } from "vitest";

// 全局 setup.ts 为其他单测 mock 了 node:fs（避免碰真实磁盘）；这个测试的意义就是校验
// art-styles/ 目录下的真实文件是否存在，必须用回真实 fs，与 prompt-templates-deplot.test.ts 同一模式。
vi.mock("node:fs", async (importOriginal) => importOriginal());

import {
  listAvailableStyles,
  hasArtStyleFile,
  getArtStylePrompt,
  type ArtStyleFileType,
} from "@/lib/ai/prompts/art-styles/index";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/visual-style-presets";

const REQUIRED_FILE_TYPES: ArtStyleFileType[] = [
  "prefix",
  "character",
  "scene",
  "table",
  "planning",
  "rewrite_vocab",
];

const styleDirs = listAvailableStyles();
// auto 是虚拟风格（AI自动检测），没有对应的 art-styles 目录，也不需要 negativePrompt
const realStyleKeys = Object.keys(VISUAL_STYLE_PRESETS).filter((k) => k !== "auto");

describe("art-style 双向一致性（VISUAL_STYLE_PRESETS ⟷ art-styles/ 目录）", () => {
  it("listAvailableStyles() 应返回非空列表", () => {
    expect(styleDirs.length).toBeGreaterThan(0);
  });

  it.each(styleDirs)("目录 art-styles/%s 必须有对应的 VISUAL_STYLE_PRESETS 条目", (dir) => {
    expect(VISUAL_STYLE_PRESETS[dir]).toBeDefined();
  });

  it.each(realStyleKeys)("VISUAL_STYLE_PRESETS['%s'] 必须有对应的 art-styles 目录", (key) => {
    expect(styleDirs).toContain(key);
  });
});

describe.each(realStyleKeys)("风格 %s 的必需资源完整性", (style) => {
  it.each(REQUIRED_FILE_TYPES)(`必须存在非空的 ${style}/%s.md`, (fileType) => {
    expect(hasArtStyleFile(style, fileType)).toBe(true);
    expect(getArtStylePrompt(style, fileType).length).toBeGreaterThan(0);
  });

  it("VISUAL_STYLE_PRESETS 的 tag 字段必须非空", () => {
    expect(VISUAL_STYLE_PRESETS[style].tag.trim().length).toBeGreaterThan(0);
  });

  it("VISUAL_STYLE_PRESETS 的 negativePrompt 字段必须非空", () => {
    expect(VISUAL_STYLE_PRESETS[style].negativePrompt?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("label / description 字段必须非空", () => {
    expect(VISUAL_STYLE_PRESETS[style].label.trim().length).toBeGreaterThan(0);
    expect(VISUAL_STYLE_PRESETS[style].description.trim().length).toBeGreaterThan(0);
  });
});

describe("VISUAL_STYLE_PRESETS['auto']（AI自动检测，无对应目录）", () => {
  it("tag 必须为空字符串（约定：交给 AI 从剧本推断，不强制风格）", () => {
    expect(VISUAL_STYLE_PRESETS.auto.tag).toBe("");
  });
});
