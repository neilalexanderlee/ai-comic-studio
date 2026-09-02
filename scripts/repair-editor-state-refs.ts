/**
 * 修复 `episodes.editor_state`（时间线快照）里残留的本地素材路径。
 *
 * 用法：
 *   pnpm editor-state:repair              # 演练
 *   pnpm editor-state:repair --apply      # 执行
 *
 * ## 背景：一个被存量迁移漏掉的引用面
 *
 * 时间线快照是一段 JSON，里面**内嵌了素材的存储引用**（视频 url、BGM audioUrl、
 * 缩略图 thumbnailUrl）。存量迁移只改了数据库的**列**，没改这段 JSON —— 于是：
 *
 *   - 视频迁到 OSS、shots.video_url 更新了，快照里仍是旧的本地路径
 *   - 本地冗余副本被清理后，快照里的路径全部失效
 *   - 用户打开编辑器时，保存的剪辑加载不出素材
 *
 * `storage-audit.ts` 原先也只扫列、不扫这段 JSON，所以没报警。已一并补上。
 *
 * ## 本脚本做两件事
 *
 * 1. **补迁**：快照里引用、但从未迁移过的素材（典型是 BGM —— 它不被任何数据库列
 *    引用，只活在时间线里，所以 storage-migrate 直接跳过了它）先传到 OSS。
 * 2. **改写**：把快照里的本地路径逐个替换成对应的 `oss://` 引用。
 *
 * ## 安全设计
 *
 * - 默认演练
 * - 改库前 VACUUM INTO 备份
 * - 逐条替换、精确匹配完整路径字符串，不做模糊正则替换
 * - 映射不到、文件也不在盘的路径**原样保留**（不清空）—— 那是历史丢失，
 *   清空只会掩盖问题，留着至少能看出「这里曾经有个素材」
 * - 改写前后都会打印每集的引用统计，便于核对
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const APPLY = process.argv.includes("--apply");
const DB_FILE = (process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");
const BACKUP_DIR = path.join(path.dirname(DB_FILE), "backups");
const UPLOAD_ROOT = process.env.UPLOAD_DIR || "./uploads";

/** 匹配快照 JSON 里的本地素材路径 */
const LOCAL_PATH_RE = /(?:\.\/)?uploads\/[^"\\\s]+/g;

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

function loadMigrationMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fs.readdirSync(BACKUP_DIR).filter((x) => x.startsWith("storage-migration-") && x.endsWith(".json"))) {
    for (const e of JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), "utf8")) as { from: string; to: string }[]) {
      m.set(e.from, e.to);
      m.set(path.normalize(e.from), e.to);
      // 快照里可能带 ./ 前缀，也可能不带
      m.set(e.from.replace(/^\.\//, ""), e.to);
      m.set("./" + e.from.replace(/^\.\//, ""), e.to);
    }
  }
  return m;
}

function backupDb(): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `aicomic-before-editorstate-${Date.now()}.db`);
  const db = new Database(DB_FILE, { readonly: true });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  db.close();
  return dest;
}

async function main() {
  const oss = ossClient();
  const map = loadMigrationMap();

  const db = new Database(DB_FILE, { readonly: true });
  const episodes = db
    .prepare(`SELECT id, title, editor_state AS state FROM episodes WHERE editor_state IS NOT NULL AND editor_state != ''`)
    .all() as { id: string; title: string; state: string }[];
  db.close();

  // 先收集所有需要补迁的路径（在盘、但没有 OSS 映射）
  const needUpload = new Set<string>();
  for (const ep of episodes) {
    for (const p of new Set(ep.state.match(LOCAL_PATH_RE) ?? [])) {
      if (map.has(p)) continue;
      if (fs.existsSync(p)) needUpload.add(p);
    }
  }

  console.log(`时间线快照：${episodes.length} 集`);
  console.log(`需要补迁到 OSS 的素材：${needUpload.size} 个（多为 BGM —— 它只活在时间线里，不被任何数据库列引用，所以存量迁移跳过了它）`);
  for (const p of needUpload) console.log(`  · ${p}  ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`);

  if (!APPLY) {
    let mapped = 0, unmapped = 0;
    for (const ep of episodes) {
      for (const p of new Set(ep.state.match(LOCAL_PATH_RE) ?? [])) {
        if (map.has(p) || needUpload.has(p)) mapped++; else unmapped++;
      }
    }
    console.log(`\n可改写为 oss:// 的引用：${mapped} 个；无法映射（文件已丢失）：${unmapped} 个`);
    console.log("\n演练结束，未上传也未改库。确认后加 --apply。");
    return;
  }

  // ① 补迁
  if (needUpload.size > 0) {
    if (!oss) throw new Error("有素材需要补迁但未配置 OSS");
    for (const p of needUpload) {
      const rel = path.relative(path.resolve(UPLOAD_ROOT), path.resolve(p)).replace(/\\/g, "/");
      if (rel.startsWith("..")) { console.warn(`  ! 不在 UPLOAD_DIR 内，跳过：${p}`); continue; }
      const buf = fs.readFileSync(p);
      await oss.put(rel, buf);
      const head = await oss.head(rel);
      const etag = String(head.res.headers.etag ?? "").replace(/"/g, "").toLowerCase();
      const md5 = crypto.createHash("md5").update(buf).digest("hex");
      if (etag !== md5) { console.error(`  ✗ 校验不通过，不改写：${p}`); continue; }
      map.set(p, `oss://${rel}`);
      console.log(`  ✓ 已补迁 ${p} → oss://${rel}`);
    }
  }

  // ② 改写快照
  console.log(`\n已备份数据库 → ${backupDb()}`);
  const wdb = new Database(DB_FILE);
  let changedEpisodes = 0, replaced = 0, kept = 0;
  const tx = wdb.transaction(() => {
    for (const ep of episodes) {
      let next = ep.state;
      for (const p of new Set(ep.state.match(LOCAL_PATH_RE) ?? [])) {
        const to = map.get(p);
        if (!to) { kept++; continue; }   // 映射不到就原样保留，不清空
        // 精确整串替换，避免前缀路径被误改
        next = next.split(`"${p}"`).join(`"${to}"`);
        replaced++;
      }
      if (next !== ep.state) {
        wdb.prepare(`UPDATE episodes SET editor_state = ? WHERE id = ?`).run(next, ep.id);
        changedEpisodes++;
      }
    }
  });
  tx();
  wdb.close();

  console.log(`✓ 改写 ${changedEpisodes} 集，替换 ${replaced} 处引用；保留（无法映射）${kept} 处`);
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
