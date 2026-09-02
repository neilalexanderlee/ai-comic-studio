/**
 * 存量产物迁移：本地磁盘 → 阿里云 OSS。
 *
 * 用法：
 *   pnpm storage:migrate                     # 演练（默认，只报告不改任何东西）
 *   pnpm storage:migrate --apply             # 真正执行
 *   pnpm storage:migrate --apply --limit 20  # 先小批量试水
 *   pnpm storage:migrate --apply --only shots.anchor_first   # 只迁某一列
 *   pnpm storage:migrate --rollback <mapping.json>           # 把 DB 引用改回本地
 *
 * ## 安全设计（针对「素材不能丢」）
 *
 * 1. **只复制，绝不删除本地文件。** 迁移后本地仍是完整副本，
 *    OSS 是新增的一份。要不要删本地是另一件事，需要你在确认无误后单独决定。
 * 2. **上传后按 MD5 校验**，比对本地文件与 OSS 上对象的内容摘要。
 *    校验不通过就跳过，不更新 DB —— 宁可这条没迁成，也不能让 DB 指向坏对象。
 * 3. **先校验、后改库。** 顺序是 上传 → 校验 → 更新 DB 引用。
 *    任何一步失败，DB 保持原样，本地文件照常可用。
 * 4. **默认演练。** 不加 `--apply` 什么都不写。
 * 5. **改库前自动备份数据库**到 data/backups/。
 * 6. **产出映射文件** data/backups/storage-migration-<时间戳>.json，
 *    记录每条 旧引用 → 新引用，可用 `--rollback` 一键改回去。
 * 7. **幂等可续跑。** 已经是 oss:// 的引用直接跳过；中断后重跑只处理剩下的。
 * 8. **缺失文件跳过并计数**，不会把 DB 字段清空 —— 那是不可逆操作，
 *    交给人判断（见 storage-audit.ts 的同款处理）。
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const REF_COLUMNS: [table: string, column: string][] = [
  ["projects", "final_video_url"],
  ["episodes", "final_video_url"],
  ["characters", "reference_image"],
  ["characters", "beauty_image"],
  ["characters", "combat_image"],
  ["character_assets", "image_path"],
  ["character_assets", "audio_path"],
  ["shots", "anchor_first"],
  ["shots", "anchor_last_ai"],
  ["shots", "video_url"],
  ["shots", "cut_point"],
  ["shot_video_history", "video_url"],
  ["track_videos", "video_url"],
];

interface MappingEntry {
  table: string;
  column: string;
  id: string;
  from: string;
  to: string;
  bytes: number;
  md5: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const LIMIT = Number(arg("--limit") ?? "0") || Infinity;
const ONLY = arg("--only");
const ROLLBACK = arg("--rollback");

const UPLOAD_ROOT = process.env.UPLOAD_DIR || "./uploads";
const DB_FILE = (process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");

function md5(buf: Buffer) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

function ossClient() {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw new Error("未配置 OSS（需要 OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET）");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OSS = require("ali-oss");
  return new OSS({
    region: OSS_REGION,
    bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET,
    secure: true,
  });
}

/** 本地路径 → OSS object key（保持相对 UPLOAD_DIR 的目录结构） */
function toKey(localRef: string): string | null {
  const rel = path.relative(path.resolve(UPLOAD_ROOT), path.resolve(localRef)).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return null; // 不在 UPLOAD_DIR 之内，不迁
  return rel;
}

function backupDatabase(): string {
  const dir = path.join(path.dirname(DB_FILE), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `aicomic-before-migration-${Date.now()}.db`);
  // better-sqlite3 的 backup 是异步的；这里用 VACUUM INTO 拿到一致性快照（含 WAL）
  const db = new Database(DB_FILE, { readonly: true });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  db.close();
  return dest;
}

async function rollback(mappingPath: string) {
  const entries = JSON.parse(fs.readFileSync(mappingPath, "utf8")) as MappingEntry[];
  console.log(`回滚 ${entries.length} 条引用（DB 改回本地路径；OSS 对象保留不动）`);
  if (!APPLY) {
    console.log("演练模式，未写入。确认无误后加 --apply 执行。");
    return;
  }
  const backup = backupDatabase();
  console.log(`已备份数据库 → ${backup}`);
  const db = new Database(DB_FILE);
  let n = 0;
  const tx = db.transaction(() => {
    for (const e of entries) {
      const r = db
        .prepare(`UPDATE ${e.table} SET ${e.column} = ? WHERE id = ? AND ${e.column} = ?`)
        .run(e.from, e.id, e.to);
      n += r.changes;
    }
  });
  tx();
  db.close();
  console.log(`✓ 已回滚 ${n} 条`);
}

async function migrate() {
  const oss = ossClient();
  const db = new Database(DB_FILE, { readonly: !APPLY });

  const todo: { table: string; column: string; id: string; ref: string }[] = [];
  for (const [table, column] of REF_COLUMNS) {
    if (ONLY && `${table}.${column}` !== ONLY) continue;
    let rows: { id: string; ref: string }[];
    try {
      rows = db
        .prepare(`SELECT id, ${column} AS ref FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
        .all() as { id: string; ref: string }[];
    } catch {
      continue;
    }
    for (const r of rows) {
      if (r.ref.startsWith("oss://")) continue; // 已迁移，幂等跳过
      todo.push({ table, column, id: r.id, ref: r.ref });
    }
  }
  db.close();

  console.log(`待迁移 ${todo.length} 条引用${APPLY ? "" : "（演练模式）"}\n`);

  const mapping: MappingEntry[] = [];
  let migrated = 0, skippedMissing = 0, skippedOutside = 0, failed = 0, bytes = 0;

  for (const item of todo) {
    if (migrated >= LIMIT) break;

    if (!fs.existsSync(item.ref)) {
      skippedMissing++;
      continue;
    }
    const key = toKey(item.ref);
    if (!key) {
      skippedOutside++;
      console.warn(`  ! 不在 UPLOAD_DIR 之内，跳过：${item.ref}`);
      continue;
    }

    const buf = fs.readFileSync(item.ref);
    const localMd5 = md5(buf);

    if (!APPLY) {
      migrated++;
      bytes += buf.length;
      continue;
    }

    try {
      await oss.put(key, buf);
      // 校验：拿 OSS 上对象的 ETag（单次 put 的 ETag 即 MD5）比对
      const head = await oss.head(key);
      const etag = String(head.res.headers.etag ?? "").replace(/"/g, "").toLowerCase();
      if (etag !== localMd5) {
        failed++;
        console.error(`  ✗ 校验不通过，未更新 DB：${item.ref}（本地 ${localMd5} ≠ OSS ${etag}）`);
        continue;
      }
      mapping.push({
        table: item.table, column: item.column, id: item.id,
        from: item.ref, to: `oss://${key}`, bytes: buf.length, md5: localMd5,
      });
      migrated++;
      bytes += buf.length;
      if (migrated % 25 === 0) console.log(`  …已上传校验 ${migrated} 个`);
    } catch (err) {
      failed++;
      console.error(`  ✗ 上传失败：${item.ref} — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\n上传阶段：成功 ${migrated} | 文件缺失跳过 ${skippedMissing} | ` +
      `不在 UPLOAD_DIR 跳过 ${skippedOutside} | 失败 ${failed} | ${(bytes / 1048576).toFixed(1)} MB`
  );

  if (!APPLY) {
    console.log("\n演练结束，未上传也未改库。确认无误后加 --apply 执行。");
    return;
  }
  if (mapping.length === 0) {
    console.log("没有可更新的引用。");
    return;
  }

  // 全部上传并校验通过后，才统一改库
  const backup = backupDatabase();
  console.log(`\n已备份数据库 → ${backup}`);

  const wdb = new Database(DB_FILE);
  let updated = 0;
  const tx = wdb.transaction(() => {
    for (const e of mapping) {
      // 条件里带上旧值：期间若有并发改动，这条就不更新，而不是覆盖掉新值
      const r = wdb
        .prepare(`UPDATE ${e.table} SET ${e.column} = ? WHERE id = ? AND ${e.column} = ?`)
        .run(e.to, e.id, e.from);
      updated += r.changes;
    }
  });
  tx();
  wdb.close();

  const mapPath = path.join(path.dirname(DB_FILE), "backups", `storage-migration-${Date.now()}.json`);
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2));

  console.log(`✓ 已更新 ${updated} 条 DB 引用`);
  console.log(`✓ 映射文件 → ${mapPath}`);
  console.log(`  回滚：pnpm storage:migrate --rollback ${mapPath} --apply`);
  console.log(`\n本地文件一个都没删 —— OSS 上是新增副本。请先跑 pnpm storage:audit 复核。`);
}

async function main() {
  if (ROLLBACK) return rollback(ROLLBACK);
  return migrate();
}

main().catch((err) => {
  console.error("迁移失败:", err);
  process.exit(1);
});
