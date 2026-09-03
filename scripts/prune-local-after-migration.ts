/**
 * 删除已迁移到 OSS 的本地冗余副本。
 *
 * 用法：
 *   pnpm local:prune                 # 演练（默认）
 *   pnpm local:prune --apply         # 执行
 *
 * ## 这是本次改造里唯一真正删除素材的操作，所以校验最严
 *
 * 只有同时满足以下全部条件的本地文件才会被删：
 *
 * 1. 它出现在某次迁移的映射文件里（data/backups/storage-migration-*.json）
 * 2. 映射记录的 OSS 对象**当前确实存在**
 * 3. OSS 对象的 **ETag 与迁移时记录的 MD5 一致**（内容没被改动/损坏）
 * 4. OSS 对象的**大小与本地文件一致**
 * 5. 数据库里**没有任何字段还指向这个本地路径**（说明确实已切到 OSS）
 *
 * 任何一条不满足就跳过并说明原因 —— 宁可留着不删，也不能删掉唯一的副本。
 *
 * 删除前会打印总量并要求 --apply；删除清单写入
 * data/backups/pruned-local-<时间戳>.json（记录路径与 md5，便于事后核对）。
 *
 * ⚠️ 删掉之后**本地就没有副本了**，OSS 成为唯一存储。
 *    执行前请确认 pnpm storage:audit 全绿，并在界面上实际验证过素材可访问。
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const APPLY = process.argv.includes("--apply");
const DB_FILE = (process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");
const BACKUP_DIR = path.join(path.dirname(DB_FILE), "backups");

interface MappingEntry {
  table: string; column: string; id: string;
  from: string; to: string; bytes: number; md5: string;
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

function ossClient() {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw new Error("未配置 OSS");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OSS = require("ali-oss");
  return new OSS({
    region: OSS_REGION, bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID, accessKeySecret: OSS_ACCESS_KEY_SECRET,
    secure: true, timeout: 15 * 60 * 1000,
  });
}

async function main() {
  const oss = ossClient();

  // 收集所有迁移映射。
  // mkdir 而不是直接 readdir：目录不存在时 readdirSync 直接抛 ENOENT，
  // 而"还没迁过任何东西"是完全正常的状态，应该报告"没有映射"而不是崩掉。
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const mapFiles = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("storage-migration-") && f.endsWith(".json"));
  const entries: MappingEntry[] = mapFiles.flatMap((f) =>
    JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), "utf8"))
  );
  console.log(`读取 ${mapFiles.length} 个映射文件，共 ${entries.length} 条迁移记录`);

  // 数据库里当前仍被引用的本地路径（用于第 5 条校验）
  const db = new Database(DB_FILE, { readonly: true });
  const stillReferenced = new Set<string>();
  for (const [t, c] of REF_COLUMNS) {
    try {
      for (const r of db.prepare(`SELECT ${c} AS v FROM ${t} WHERE ${c} IS NOT NULL AND ${c} != ''`).all() as { v: string }[]) {
        if (!r.v.startsWith("oss://")) stillReferenced.add(path.resolve(r.v));
      }
    } catch { /* 表/列不存在 */ }
  }
  // ⚠️ 引用不只在列里：时间线快照 JSON 里内嵌的路径同样算"仍被引用"。
  // 漏掉这里会把"时间线正在用、但没有任何列指向它"的素材（典型是 BGM）删掉。
  try {
    for (const r of db
      .prepare(`SELECT editor_state AS s FROM episodes WHERE editor_state IS NOT NULL AND editor_state != ''`)
      .all() as { s: string }[]) {
      for (const m of r.s.match(/(?:\.\/)?uploads\/[^"\\\s]+/g) ?? []) {
        stillReferenced.add(path.resolve(m));
      }
    }
  } catch { /* 列不存在 */ }
  db.close();

  const deletable: MappingEntry[] = [];
  const skipped: { entry: MappingEntry; why: string }[] = [];

  for (const e of entries) {
    if (!fs.existsSync(e.from)) { skipped.push({ entry: e, why: "本地文件已不存在" }); continue; }
    if (stillReferenced.has(path.resolve(e.from))) {
      skipped.push({ entry: e, why: "数据库仍指向这个本地路径" }); continue;
    }
    const key = e.to.replace(/^oss:\/\//, "");
    try {
      const head = await oss.head(key);
      const etag = String(head.res.headers.etag ?? "").replace(/"/g, "").toLowerCase();
      const size = Number(head.res.headers["content-length"]);
      const localSize = fs.statSync(e.from).size;
      if (etag !== e.md5) { skipped.push({ entry: e, why: `OSS ETag 与迁移时 MD5 不符` }); continue; }
      if (size !== localSize) { skipped.push({ entry: e, why: `大小不符（本地 ${localSize} / OSS ${size}）` }); continue; }
      deletable.push(e);
    } catch {
      skipped.push({ entry: e, why: "OSS 上找不到该对象" });
    }
  }

  const bytes = deletable.reduce((a, e) => a + fs.statSync(e.from).size, 0);
  console.log(`\n可删除：${deletable.length} 个，共 ${(bytes / 1048576).toFixed(0)} MB`);
  console.log(`跳过：${skipped.length} 个`);
  const reasons = new Map<string, number>();
  for (const s of skipped) reasons.set(s.why, (reasons.get(s.why) ?? 0) + 1);
  for (const [why, n] of reasons) console.log(`  · ${why}：${n}`);

  if (!APPLY) {
    console.log("\n演练结束，未删除任何文件。确认后加 --apply。");
    console.log("⚠️ 删除后本地不再有副本，OSS 成为唯一存储。执行前请确认 pnpm storage:audit 全绿。");
    return;
  }
  if (deletable.length === 0) return;

  const listPath = path.join(BACKUP_DIR, `pruned-local-${Date.now()}.json`);
  fs.writeFileSync(
    listPath,
    JSON.stringify(deletable.map((e) => ({ path: e.from, oss: e.to, md5: e.md5, bytes: e.bytes })), null, 2)
  );
  console.log(`\n✓ 删除清单 → ${listPath}`);

  let n = 0, freed = 0;
  for (const e of deletable) {
    try {
      // 删除前最后一次内容核对：本地文件 MD5 必须仍等于迁移时记录的值。
      // 万一这个文件在迁移后被改过，OSS 上的就不是它的副本了。
      const localMd5 = crypto.createHash("md5").update(fs.readFileSync(e.from)).digest("hex");
      if (localMd5 !== e.md5) { console.warn(`  ! 本地文件已变更，保留：${e.from}`); continue; }
      const size = fs.statSync(e.from).size;
      fs.unlinkSync(e.from);
      n++; freed += size;
    } catch (err) {
      console.warn(`  ! 删除失败：${e.from} — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`✓ 已删除 ${n} 个本地文件，释放 ${(freed / 1048576).toFixed(0)} MB`);
  console.log(`  这些文件在 OSS 上仍有副本（已逐个校验 ETag 与大小）`);
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
