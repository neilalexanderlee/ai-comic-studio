/**
 * 数据库定时备份 —— 打一份一致性快照，压缩后写进产物存储（OSS 或本地）。
 *
 *   pnpm db:backup                 # 默认保留最近 30 份
 *   pnpm db:backup --keep 14
 *   pnpm db:backup --dry-run       # 只报告，不写不删
 *
 * ## 为什么需要它
 *
 * 数据库是这个项目里**唯一不可再生**的东西：帧图、视频、BGM 全都能重新生成
 * （花钱花时间而已），而剧本、分镜、角色设定、剪辑状态只有这一份。
 * 服务器磁盘挂掉、误删、迁移写坏，都是一次性全损。
 *
 * ## 三个实现选择
 *
 * 1. **用 better-sqlite3 的 `.backup()`，不是 `cp`。** SQLite 开着 WAL，
 *    直接拷 .db 文件会漏掉尚未合并进主库的写入 —— 拷出来的东西看着正常、
 *    实际少了最近的数据，而且当场发现不了。
 *
 * 2. **走 `saveArtifactFromFile`，不直接调 OSS。** 这样配了 OSS 就传 OSS
 *    （服务器上还会走内网端点，不计流量），没配 OSS 的自部署用户就落在
 *    `uploads/backups/`，同一份代码两种部署都能用。
 *
 * 3. **只上传、只列举、只删除，从不下载。** 上行和内网流量不计费，
 *    而下行流量包只有 2 GB/月（2026-09-02 打穿过一次、欠费停服过）。
 *    要恢复某一份备份时再手动下载那一个文件即可。
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { saveArtifactFromFile } from "@/lib/storage/artifact-store";
import { mb, stamp, pruneBackups } from "./backup-common";

const PREFIX = "backups/";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const KEEP = Math.max(1, Number(arg("--keep") ?? 30));
const DRY = process.argv.includes("--dry-run");

function dbPath(): string {
  return path.resolve(process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db");
}

async function main() {
  const src = dbPath();
  if (!fs.existsSync(src)) throw new Error(`数据库不存在：${src}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aicomic-backup-"));
  const snapshot = path.join(tmpDir, "snapshot.db");
  const gz = `${snapshot}.gz`;

  try {
    // 一致性快照：把 WAL 里的内容一并合进去
    const db = new Database(src, { readonly: true, fileMustExist: true });
    try {
      await db.backup(snapshot);
    } finally {
      db.close();
    }

    await pipeline(
      fs.createReadStream(snapshot),
      zlib.createGzip({ level: 9 }),
      fs.createWriteStream(gz),
    );

    const rawSize = fs.statSync(snapshot).size;
    const gzSize = fs.statSync(gz).size;
    const key = `${PREFIX}aicomic-${stamp()}.db.gz`;
    console.log(`快照 ${mb(rawSize)} → 压缩 ${mb(gzSize)}（${(gzSize / rawSize * 100).toFixed(0)}%）`);

    if (DRY) {
      console.log(`[dry-run] 将写入 ${key}`);
    } else {
      const ref = await saveArtifactFromFile(key, gz);
      console.log(`已写入 ${ref}`);
    }

    await pruneBackups(PREFIX, ".db.gz", KEEP, DRY);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("备份失败：", err);
  process.exit(1);
});
