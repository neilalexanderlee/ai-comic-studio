/**
 * 清理孤儿角色资产 —— `character_assets` 里 `character_id` 指向已不存在角色的行。
 *
 * 用法：
 *   pnpm assets:prune              # 演练（默认）
 *   pnpm assets:prune --apply      # 真正删除
 *
 * ## 根因
 *
 * `schema.ts` 声明了 `characterAssets.characterId ... onDelete: "cascade"`，
 * 但**实际建表 SQL 没有写外键约束**（`character_id TEXT NOT NULL`，没有 REFERENCES）。
 * Drizzle 的 `.references()` 只影响它自己生成迁移时的输出，本项目的迁移是手写 SQL，
 * 这个约束从来没进过数据库。于是删项目/删角色时：
 *   characters 行没了 → character_assets 行留下 → 文件被删除处理器清掉 → 悬空引用
 *
 * 修复分两步：本脚本清历史残留；`deleteCharacterAssetsFor()`（lib/db/cascade.ts）
 * 让今后的删除路径显式清理，不再依赖那个并不存在的约束。
 *
 * ## 安全设计
 *
 * - 默认演练，必须显式 `--apply`
 * - 删除前 VACUUM INTO 备份整库
 * - 删除的行**完整导出**到 data/backups/orphan-assets-<时间戳>.json，可人工恢复
 * - 删除前重新校验：被 `shots.prop_refs` 引用的资产**一律不删**（哪怕它是孤儿）
 * - 只删 character 行确实不存在的；只要角色还在就不碰
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const APPLY = process.argv.includes("--apply");
const DB_FILE = (process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");

interface OrphanRow {
  id: string;
  character_id: string;
  image_path: string | null;
  audio_path: string | null;
  asset_type: string;
  tag: string;
  is_default: number;
  angle: string | null;
  created_at: number;
}

function backupDatabase(): string {
  const dir = path.join(path.dirname(DB_FILE), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `aicomic-before-prune-${Date.now()}.db`);
  const db = new Database(DB_FILE, { readonly: true });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  db.close();
  return dest;
}

function main() {
  const db = new Database(DB_FILE, { readonly: !APPLY });

  const orphans = db
    .prepare(
      `SELECT ca.* FROM character_assets ca
       LEFT JOIN characters ch ON ch.id = ca.character_id
       WHERE ch.id IS NULL`
    )
    .all() as OrphanRow[];

  // 被分镜道具引用的资产绝不删 —— 哪怕角色行没了，那条 prop_refs 仍然指着它
  const referenced = new Set<string>();
  for (const row of db
    .prepare(`SELECT prop_refs FROM shots WHERE prop_refs IS NOT NULL AND prop_refs != ''`)
    .all() as { prop_refs: string }[]) {
    try {
      for (const id of JSON.parse(row.prop_refs) as string[]) referenced.add(id);
    } catch {
      /* 坏 JSON 忽略 */
    }
  }

  const deletable = orphans.filter((o) => !referenced.has(o.id));
  const protectedRows = orphans.filter((o) => referenced.has(o.id));

  const withFile = deletable.filter((o) => o.image_path && fs.existsSync(o.image_path));

  console.log(`孤儿资产（character 行已不存在）：${orphans.length} 条`);
  console.log(`  其中被 shots.prop_refs 引用、保留不删：${protectedRows.length}`);
  console.log(`  可删除：${deletable.length}`);
  console.log(`  ⚠️ 可删除项里文件仍在磁盘上的：${withFile.length}`);
  if (withFile.length > 0) {
    console.log("     （这些行的文件还在，删行会让文件变成无人引用的垃圾。列出供你确认）");
    for (const o of withFile.slice(0, 10)) console.log(`     ${o.id} ${o.image_path}`);
  }

  const byType = new Map<string, number>();
  for (const o of deletable) byType.set(o.asset_type, (byType.get(o.asset_type) ?? 0) + 1);
  console.log("  按类型：", [...byType].map(([k, v]) => `${k}=${v}`).join(" "));

  if (!APPLY) {
    console.log("\n演练结束，未删除任何东西。确认无误后加 --apply 执行。");
    db.close();
    return;
  }
  if (deletable.length === 0) {
    console.log("\n没有可删除的行。");
    db.close();
    return;
  }

  db.close();

  const backup = backupDatabase();
  console.log(`\n已备份数据库 → ${backup}`);

  const dir = path.join(path.dirname(DB_FILE), "backups");
  const dumpPath = path.join(dir, `orphan-assets-${Date.now()}.json`);
  fs.writeFileSync(dumpPath, JSON.stringify(deletable, null, 2));
  console.log(`✓ 删除前完整导出 → ${dumpPath}`);

  const wdb = new Database(DB_FILE);
  let n = 0;
  const tx = wdb.transaction(() => {
    const stmt = wdb.prepare(`DELETE FROM character_assets WHERE id = ?`);
    for (const o of deletable) n += stmt.run(o.id).changes;
  });
  tx();
  wdb.close();

  console.log(`✓ 已删除 ${n} 条孤儿资产行`);
  console.log(`  恢复方式：用导出的 JSON 逐条 INSERT 回 character_assets，或直接还原备份库`);
}

main();
