/**
 * 清理 uploads/ 下无人引用的孤儿文件。
 *
 * 用法：
 *   pnpm files:prune              # 演练（默认）
 *   pnpm files:prune --apply      # 执行
 *   pnpm files:prune --ext .png   # 只处理某类扩展名（可重复）
 *
 * ## 引用面必须扫全 —— 这是本脚本最容易出错的地方
 *
 * 素材引用不只存在于数据库的列里。踩过的坑：
 * `episodes.editor_state`（时间线快照）是一段 **JSON，内嵌着素材路径**，
 * 只扫列就会把「时间线正在用的 BGM」误判成孤儿删掉。
 *
 * 所以这里同时扫描：
 *   1. 15 个存放产物引用的数据库列
 *   2. `episodes.editor_state` JSON 里内嵌的路径
 *
 * 并且用**两种口径**判定「被引用」：
 *   - 完整路径相同
 *   - **文件名相同** —— 素材迁到 OSS 后数据库里存的是 `oss://<key>`，
 *     本地残留副本的文件名与 key 的 basename 一致；只比路径会把它们误判成孤儿。
 *
 * ## 安全设计
 *
 * - 默认演练
 * - 删除清单（路径 + 大小 + md5）先写入 data/backups/pruned-orphans-*.json
 * - 只删普通文件，不碰目录结构
 * - 删除的是**磁盘文件**，不动数据库
 *
 * ⚠️ 孤儿帧图从 UI 上已经不可达（项目没有「帧图历史」表，只有 shot_video_history
 *    管视频版本），删掉不影响界面上任何可执行的操作；但删了就没了。
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const APPLY = process.argv.includes("--apply");
const DB_FILE = (process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");
const UPLOAD_ROOT = process.env.UPLOAD_DIR || "./uploads";
const BACKUP_DIR = path.join(path.dirname(DB_FILE), "backups");

function extFilters(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--ext" && process.argv[i + 1]) out.push(process.argv[i + 1].toLowerCase());
  }
  return out;
}

const REF_COLUMNS: [string, string][] = [
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
  ["shots", "preview_url"],
  ["shots", "poster_url"],
  ["shot_video_history", "video_url"],
  ["track_videos", "video_url"],
];

const EMBEDDED_REF_RE = /(?:oss:\/\/|(?:\.\/)?uploads\/)[^"\\\s]+/g;

function collectReferenced(): { paths: Set<string>; names: Set<string> } {
  const db = new Database(DB_FILE, { readonly: true });
  const paths = new Set<string>();
  const names = new Set<string>();

  const add = (ref: string) => {
    if (!ref) return;
    names.add(path.basename(ref));
    if (!ref.startsWith("oss://")) paths.add(path.resolve(ref));
  };

  for (const [t, c] of REF_COLUMNS) {
    try {
      for (const r of db.prepare(`SELECT ${c} AS v FROM ${t} WHERE ${c} IS NOT NULL AND ${c} != ''`).all() as { v: string }[]) {
        add(r.v);
      }
    } catch { /* 表/列不存在 */ }
  }

  // 时间线快照里的内嵌引用 —— 漏掉这里会误删「正在用的 BGM」
  try {
    for (const r of db.prepare(`SELECT editor_state AS s FROM episodes WHERE editor_state IS NOT NULL AND editor_state != ''`).all() as { s: string }[]) {
      for (const m of r.s.match(EMBEDDED_REF_RE) ?? []) add(m);
    }
  } catch { /* 列不存在 */ }

  db.close();
  return { paths, names };
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile()) acc.push(full);
  }
  return acc;
}

function main() {
  const { paths, names } = collectReferenced();
  console.log(`数据库 + 时间线快照中被引用的素材：${names.size} 个文件名 / ${paths.size} 个本地路径\n`);

  const filters = extFilters();
  const all = fs.existsSync(UPLOAD_ROOT) ? walk(UPLOAD_ROOT) : [];
  const orphans = all.filter((f) => {
    if (names.has(path.basename(f))) return false;
    if (paths.has(path.resolve(f))) return false;
    if (filters.length > 0 && !filters.includes(path.extname(f).toLowerCase())) return false;
    return true;
  });

  const byExt = new Map<string, { n: number; bytes: number }>();
  let total = 0;
  for (const f of orphans) {
    const ext = path.extname(f).toLowerCase() || "(无扩展名)";
    const size = fs.statSync(f).size;
    const cur = byExt.get(ext) ?? { n: 0, bytes: 0 };
    byExt.set(ext, { n: cur.n + 1, bytes: cur.bytes + size });
    total += size;
  }

  console.log(`磁盘文件 ${all.length} 个，其中孤儿 ${orphans.length} 个，共 ${(total / 1048576).toFixed(1)} MB`);
  for (const [ext, v] of [...byExt].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${ext.padEnd(14)} ${String(v.n).padStart(4)} 个  ${(v.bytes / 1048576).toFixed(1).padStart(7)} MB`);
  }

  if (!APPLY) {
    console.log("\n演练结束，未删除任何文件。确认后加 --apply。");
    return;
  }
  if (orphans.length === 0) return;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const listPath = path.join(BACKUP_DIR, `pruned-orphans-${Date.now()}.json`);
  fs.writeFileSync(
    listPath,
    JSON.stringify(
      orphans.map((f) => ({
        path: f,
        bytes: fs.statSync(f).size,
        md5: crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex"),
      })),
      null,
      2
    )
  );
  console.log(`\n✓ 删除清单（含 md5）→ ${listPath}`);

  let n = 0, freed = 0;
  for (const f of orphans) {
    try {
      const size = fs.statSync(f).size;
      fs.unlinkSync(f);
      n++; freed += size;
    } catch (err) {
      console.warn(`  ! 删除失败：${f} — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`✓ 已删除 ${n} 个文件，释放 ${(freed / 1048576).toFixed(1)} MB`);
}

main();
