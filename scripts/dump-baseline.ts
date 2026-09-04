/**
 * 从一个**健康的**数据库导出基线 schema。
 *
 * 为什么基线导自真实库而不是 schema.ts：迁移历史是残缺的（早期用 drizzle-kit push
 * 直接改库），而真实库里那份 DDL 才是这些年实际演化出来的结果。导自真实库，
 * 基线天然与线上一致；从 schema.ts 反推则要重新实现 drizzle 的 DDL 生成。
 *
 * 用法：pnpm baseline:dump [数据库路径]
 * 新增迁移之后**不必**每次重跑 —— 基线只覆盖到 meta.json 的 throughTag，
 * 之后的迁移仍照常增量执行。等历史迁移多到想再压一层时才需要重跑。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.argv[2] || process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db";
const outDir = path.resolve("drizzle", "baseline");

const db = new Database(path.resolve(dbPath), { readonly: true });
const rows = db
  .prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL
       AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       AND name NOT IN ('__drizzle_migrations','__migration_lock')
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`
  )
  .all() as Array<{ type: string; name: string; sql: string }>;

const stmts = rows.map(({ sql }) => {
  let s = sql.trim().replace(/;$/, "");
  // 让基线自身可重入
  s = s.replace(/^CREATE (UNIQUE )?(TABLE|INDEX|VIEW|TRIGGER) (?!IF NOT EXISTS)/i, (m) => `${m}IF NOT EXISTS `);
  return `${s};`;
});

const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: Array<{ tag: string }>;
};
const throughTag = journal.entries[journal.entries.length - 1].tag;

fs.mkdirSync(outDir, { recursive: true });
const header = fs
  .readFileSync(path.join(outDir, "schema.sql"), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("--"))
  .join("\n");
fs.writeFileSync(path.join(outDir, "schema.sql"), `${header}\n\n${stmts.join("\n\n")}\n`);
fs.writeFileSync(
  path.join(outDir, "meta.json"),
  `${JSON.stringify({ throughTag, note: "本基线覆盖到该迁移（含）。之后新增的迁移仍按增量方式执行。" }, null, 2)}\n`
);

console.log(`基线已更新：${stmts.length} 条 DDL，覆盖到 ${throughTag}`);
db.close();
