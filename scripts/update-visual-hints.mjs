/**
 * update-visual-hints.mjs
 *
 * 根据 v11 剧本里的标准视觉标识符，批量更新数据库 characters.visualHint 字段。
 * 只覆盖名称匹配的角色，不影响其他字段。
 *
 * 用法:
 *   node scripts/update-visual-hints.mjs
 *
 * 可选: 指定项目 ID 只更新该项目的角色
 *   PROJECT_ID=xxx node scripts/update-visual-hints.mjs
 */

import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = resolve(__dirname, "..");

const Database = require("better-sqlite3");

const dbPath = process.env.DATABASE_URL?.replace("file:", "") ?? "./data/aicomic.db";
const absolutePath = resolve(root, dbPath);

console.log("[update-visual-hints] DB path:", absolutePath);

const sqlite = new Database(absolutePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

/**
 * 标准视觉标识符 — 来自 v11 剧本高频使用的描述（最完整版本）。
 *
 * 规则：
 *  - 用最完整的视觉标识（含武器/装备），让 Seedream 生成时能区分角色
 *  - 不含年龄/身高（那些变化，不适合固化为 hint）
 *  - 不含情绪状态
 */
const VISUAL_HINTS = [
  // ─── 主角 ──────────────────────────────────────────────
  {
    name: "龙渊",
    visualHint: "黑甲银纹无双剑金色龙鳞刃纹琥珀眼",
    notes: "主线成年形态；童年形态由 sceneDescription 描述，不需要 hint",
  },
  {
    name: "灵瑶",
    visualHint: "暗红旗袍黑靴露指拳套",
    notes: "主线成年形态",
  },
  // ─── 队友 ──────────────────────────────────────────────
  {
    name: "白夜",
    visualHint: "白发白和服霜魂野太刀",
    notes: "霜魂/霜魂刀在全剧武器名，刀型为野太刀",
  },
  {
    name: "萝拉",
    visualHint: "紫发紫眸黑锥尾永夜法杖",
    notes: "黑锥尾指永夜法杖杖顶形状",
  },
  // ─── 师父 ──────────────────────────────────────────────
  {
    name: "铁狼",
    visualHint: "灰色短发疤痕脸破损披风宽刃剑",
    notes: "",
  },
  {
    name: "赤狮",
    visualHint: "白色长发束马尾武者体格",
    notes: "",
  },
  // ─── 反派 ──────────────────────────────────────────────
  {
    name: "神无",
    visualHint: "暗金色鳞片皮肤金色竖瞳灰白短发金丝华服",
    notes: "约150cm，古龙族贵族形态",
  },
  {
    name: "梦魇",
    visualHint: "苍白面容淡紫眼眸深紫长袍黑蝶翼",
    notes: "",
  },
  {
    name: "炎魔",
    visualHint: "暗红熔岩皮肤金橙燃烧眼眸赤红重铠双头战锤",
    notes: "约195cm",
  },
  {
    name: "吞噬者",
    visualHint: "漆黑混沌形态深渊黑雾紫色裂缝眼眸",
    notes: "无固定形态，以黑雾和紫色裂缝为主要识别特征",
  },
  {
    name: "魔龙",
    visualHint: "漆黑巨龙鳞甲赤红眼眸熔岩喷吐",
    notes: "boss形态，无人形",
  },
  {
    name: "魔王",
    visualHint: "漆黑全身铠甲胸口血红宝石白发竖瞳",
    notes: "约210cm，终章形态",
  },
];

// 查询所有角色（可按项目过滤）
const projectId = process.env.PROJECT_ID;
let characters;
if (projectId) {
  characters = sqlite
    .prepare("SELECT id, name, project_id, visual_hint FROM characters WHERE project_id = ?")
    .all(projectId);
  console.log(`\n[update-visual-hints] 筛选项目 ${projectId}，找到 ${characters.length} 个角色\n`);
} else {
  characters = sqlite
    .prepare("SELECT id, name, project_id, visual_hint FROM characters")
    .all();
  console.log(`\n[update-visual-hints] 全库扫描，找到 ${characters.length} 个角色\n`);
}

const update = sqlite.prepare(
  "UPDATE characters SET visual_hint = ? WHERE id = ?"
);

let updatedCount = 0;
let skippedCount = 0;

for (const char of characters) {
  const hint = VISUAL_HINTS.find(
    (h) => h.name === char.name || char.name.startsWith(h.name)
  );
  if (!hint) {
    console.log(`  ⏭  ${char.name} — 无匹配规则，跳过`);
    skippedCount++;
    continue;
  }

  if (char.visual_hint === hint.visualHint) {
    console.log(`  ✓  ${char.name} — 已是最新值，无需更新`);
    skippedCount++;
    continue;
  }

  update.run(hint.visualHint, char.id);
  console.log(`  ↑  ${char.name}`);
  console.log(`     旧: ${char.visual_hint || "（空）"}`);
  console.log(`     新: ${hint.visualHint}`);
  updatedCount++;
}

console.log(`\n[update-visual-hints] 完成：更新 ${updatedCount} 条，跳过 ${skippedCount} 条`);

sqlite.close();
