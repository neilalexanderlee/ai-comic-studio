/**
 * 给已有视频补生成预览代理 + 封面帧。
 *
 * 用法：
 *   pnpm proxies:backfill                  # 演练
 *   pnpm proxies:backfill --apply          # 执行
 *   pnpm proxies:backfill --apply --limit 3
 *
 * 安全设计（与 storage-migrate 同一套原则）：
 * - 默认演练
 * - **只新增，不动原片**：`shots.videoUrl` 一个字符都不改
 * - 改库前 VACUUM INTO 备份
 * - 幂等可续跑：已有 previewUrl 的跳过，中断后重跑只处理剩下的
 * - 单条失败不影响其余（代理是可选优化，缺了只是慢，不是坏）
 */

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) || Infinity : Infinity;
})();

const DB_FILE = (process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");
const UPLOAD_ROOT = process.env.UPLOAD_DIR || "./uploads";

function ossClient() {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OSS = require("ali-oss");
  return new OSS({
    region: OSS_REGION, bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID, accessKeySecret: OSS_ACCESS_KEY_SECRET,
    secure: true, timeout: 15 * 60 * 1000,
  });
}
const oss = ossClient();

async function materialize(ref: string): Promise<{ p: string; clean: () => void }> {
  if (!ref.startsWith("oss://")) return { p: ref, clean: () => {} };
  if (!oss) throw new Error("引用是 oss:// 但未配置 OSS");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-bf-"));
  const dest = path.join(dir, path.basename(ref));
  const r = await oss.get(ref.slice(6));
  fs.writeFileSync(dest, r.content);
  return { p: dest, clean: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

async function save(key: string, buf: Buffer): Promise<string> {
  if (oss) {
    await oss.put(key, buf);
    return `oss://${key}`;
  }
  const dest = path.join(UPLOAD_ROOT, key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

function backupDb(): string {
  const dir = path.join(path.dirname(DB_FILE), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `aicomic-before-proxies-${Date.now()}.db`);
  const db = new Database(DB_FILE, { readonly: true });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  db.close();
  return dest;
}

async function main() {
  const db = new Database(DB_FILE, { readonly: true });
  const rows = db
    .prepare(
      `SELECT id, sequence, video_url AS videoUrl FROM shots
       WHERE video_url IS NOT NULL AND video_url != ''
         AND (preview_url IS NULL OR preview_url = '')
       ORDER BY sequence`
    )
    .all() as { id: string; sequence: number; videoUrl: string }[];
  db.close();

  console.log(`待补代理的分镜：${rows.length} 个${APPLY ? "" : "（演练模式）"}\n`);
  if (!APPLY) {
    console.log("演练结束，未生成也未改库。确认后加 --apply。");
    return;
  }
  if (rows.length === 0) return;

  const updates: { id: string; previewUrl: string; posterUrl: string }[] = [];
  let done = 0, failed = 0, srcBytes = 0, proxyBytes = 0;

  for (const row of rows) {
    if (done >= LIMIT) break;
    const src = await materialize(row.videoUrl);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acs-proxy-"));
    const id = crypto.randomUUID();
    const mp4 = path.join(tmp, `${id}.mp4`);
    const jpg = path.join(tmp, `${id}.jpg`);
    try {
      await execFileAsync("ffmpeg", ["-y", "-i", src.p, "-vf", "scale=-2:480",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "48",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", mp4]);
      await execFileAsync("ffmpeg", ["-y", "-i", src.p, "-frames:v", "1",
        "-vf", "scale=-2:480", "-q:v", "4", jpg]);

      // 代理放在原片旁边的 previews/ 目录，便于人工对照与清理
      const base = row.videoUrl.startsWith("oss://")
        ? path.posix.dirname(row.videoUrl.slice(6))
        : path.relative(path.resolve(UPLOAD_ROOT), path.resolve(path.dirname(row.videoUrl))).replace(/\\/g, "/");
      const previewUrl = await save(`${base}/previews/${id}.mp4`, fs.readFileSync(mp4));
      const posterUrl = await save(`${base}/previews/${id}.jpg`, fs.readFileSync(jpg));

      srcBytes += fs.statSync(src.p).size;
      proxyBytes += fs.statSync(mp4).size;
      updates.push({ id: row.id, previewUrl, posterUrl });
      done++;
      console.log(`  ✓ 分镜${row.sequence}  ${(fs.statSync(src.p).size / 1048576).toFixed(1)}MB → ${(fs.statSync(mp4).size / 1048576).toFixed(2)}MB`);
    } catch (err) {
      failed++;
      console.error(`  ✗ 分镜${row.sequence} 失败：${err instanceof Error ? err.message.split("\n")[0] : err}`);
    } finally {
      src.clean();
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  }

  console.log(`\n生成 ${done} 个，失败 ${failed} 个`);
  if (done > 0) {
    console.log(`  源片合计 ${(srcBytes / 1048576).toFixed(0)}MB → 代理 ${(proxyBytes / 1048576).toFixed(1)}MB（${(srcBytes / proxyBytes).toFixed(0)}x）`);
  }
  if (updates.length === 0) return;

  console.log(`\n已备份数据库 → ${backupDb()}`);
  const wdb = new Database(DB_FILE);
  let n = 0;
  const tx = wdb.transaction(() => {
    // 只写 preview_url / poster_url，绝不碰 video_url
    const stmt = wdb.prepare(`UPDATE shots SET preview_url = ?, poster_url = ? WHERE id = ?`);
    for (const u of updates) n += stmt.run(u.previewUrl, u.posterUrl, u.id).changes;
  });
  tx();
  wdb.close();
  console.log(`✓ 已更新 ${n} 条（原片 videoUrl 未改动）`);
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
