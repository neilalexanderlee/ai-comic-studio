import fs from "node:fs";
import path from "node:path";

export type ArtStyleFileType =
  | "prefix"       // 全局色彩盘 + 必守/严禁规则
  | "character"    // 角色生成约束 + 模板
  | "scene"        // 场景生成约束 + 模板
  | "storyboard"   // 分镜图提示词技法（图像生成侧：情绪→面容/光影词库）
  | "table"        // 分镜表生成约束（shot_split 侧：运镜禁忌/环境动态/节奏规范）
  | "planning"     // 导演规划（全片色调/光影方案/配乐方向）
  | "video";       // 视频风格标签（Seedance/首尾帧模式）

const STYLES_DIR = path.join(process.cwd(), "src/lib/ai/prompts/art-styles");

/**
 * Load a specific art style constraint file.
 * Returns empty string if the file doesn't exist (graceful fallback).
 */
export function getArtStylePrompt(visualStyle: string, type: ArtStyleFileType): string {
  if (!visualStyle || visualStyle === "auto") return "";
  const filePath = path.join(STYLES_DIR, visualStyle, `${type}.md`);
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

/**
 * Check if a style has a constraint file of the given type.
 */
export function hasArtStyleFile(visualStyle: string, type: ArtStyleFileType): boolean {
  if (!visualStyle || visualStyle === "auto") return false;
  const filePath = path.join(STYLES_DIR, visualStyle, `${type}.md`);
  return fs.existsSync(filePath);
}

/**
 * List all visual styles that have art style files.
 */
export function listAvailableStyles(): string[] {
  try {
    return fs
      .readdirSync(STYLES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
