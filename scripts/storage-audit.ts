/**
 * 产物完整性审计 —— 检查数据库里每一条产物引用是否真的指向存在的文件。
 *
 * 用法：
 *   pnpm storage:audit              # 只报告
 *   pnpm storage:audit --json       # 机器可读，便于对比两次结果
 *
 * 为什么需要它：
 * 数据库里的产物引用（帧图、视频、角色图、音频…）散落在 13 个列上，
 * 文件在磁盘或 OSS 上。两者一旦对不上，界面表现是「图裂了 / 视频点不开」，
 * 但根因可能是文件被误删、目录被搬走、或迁移到一半中断 —— 靠肉眼根本查不出来。
 *
 * **迁移前后各跑一次，数字必须一致**（本地数下降多少，OSS 数就应该上升多少，
 * 缺失数不允许增加）。这是存量迁移唯一可靠的验收手段。
 */

import "dotenv/config";
import fs from "node:fs";
import Database from "better-sqlite3";

/** 所有存放产物引用的 (表, 列) */
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

export interface AuditRow {
  table: string;
  column: string;
  id: string;
  ref: string;
  kind: "local" | "oss";
  exists: boolean;
}

export interface AuditReport {
  total: number;
  local: number;
  oss: number;
  missingLocal: number;
  missingOss: number;
  missing: AuditRow[];
  byColumn: { table: string; column: string; total: number; missing: number; oss: number }[];
}

function ossClient() {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) return null;
  // 动态 require：未配置 OSS 时不该强依赖这个包
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

/**
 * `episodes.editor_state` 是一段 JSON，里面**内嵌**了素材引用（视频 url / BGM audioUrl /
 * 缩略图）。它不是一个「列 = 一个引用」的结构，所以最初的审计漏掉了它 ——
 * 结果是存量迁移改了列却没改这段 JSON，本地副本清理后用户保存的剪辑全部失效，
 * 而审计还报全绿。必须一并扫描。
 */
const EDITOR_STATE_PATH_RE = /(?:\.\/)?uploads\/[^"\\\s]+/g;

export async function runAudit(dbPath?: string): Promise<AuditReport> {
  const file = (dbPath ?? process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");
  const db = new Database(file, { readonly: true });
  const oss = ossClient();

  // 先把 OSS 上的 key 全列出来，避免逐个 head 造成成千上万次请求
  const ossKeys = new Set<string>();
  if (oss) {
    let marker: string | undefined;
    do {
      const res = await oss.list({ "max-keys": 1000, marker }, {});
      for (const o of res.objects ?? []) ossKeys.add(o.name);
      marker = res.nextMarker;
    } while (marker);
  }

  const rows: AuditRow[] = [];
  const byColumn: AuditReport["byColumn"] = [];

  for (const [table, column] of REF_COLUMNS) {
    let records: { id: string; ref: string }[];
    try {
      records = db
        .prepare(`SELECT id, ${column} AS ref FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
        .all() as { id: string; ref: string }[];
    } catch {
      continue; // 表/列不存在（旧库），跳过
    }

    let missing = 0;
    let ossCount = 0;
    for (const { id, ref } of records) {
      const isOss = ref.startsWith("oss://");
      if (isOss) ossCount++;
      const exists = isOss
        ? oss
          ? ossKeys.has(ref.slice("oss://".length))
          : false // 未配置 OSS 却存在 oss:// 引用 —— 无法读取，按缺失计
        : fs.existsSync(ref);
      if (!exists) missing++;
      rows.push({ table, column, id, ref, kind: isOss ? "oss" : "local", exists });
    }
    byColumn.push({ table, column, total: records.length, missing, oss: ossCount });
  }

  // 时间线快照里的内嵌引用（见上方 EDITOR_STATE_PATH_RE 的说明）
  try {
    const snaps = db
      .prepare(`SELECT id, editor_state AS state FROM episodes WHERE editor_state IS NOT NULL AND editor_state != ''`)
      .all() as { id: string; state: string }[];
    let missing = 0, ossCount = 0, total = 0;
    for (const s of snaps) {
      const locals = new Set(s.state.match(EDITOR_STATE_PATH_RE) ?? []);
      const ossHits = s.state.match(/oss:\/\/[^"\\\s]+/g) ?? [];
      for (const ref of ossHits) {
        total++; ossCount++;
        const exists = oss ? ossKeys.has(ref.slice("oss://".length)) : false;
        if (!exists) missing++;
        rows.push({ table: "episodes", column: "editor_state", id: s.id, ref, kind: "oss", exists });
      }
      for (const ref of locals) {
        total++;
        const exists = fs.existsSync(ref);
        if (!exists) missing++;
        rows.push({ table: "episodes", column: "editor_state", id: s.id, ref, kind: "local", exists });
      }
    }
    byColumn.push({ table: "episodes", column: "editor_state", total, missing, oss: ossCount });
  } catch {
    /* 表/列不存在 */
  }

  db.close();

  const missing = rows.filter((r) => !r.exists);
  return {
    total: rows.length,
    local: rows.filter((r) => r.kind === "local").length,
    oss: rows.filter((r) => r.kind === "oss").length,
    missingLocal: missing.filter((r) => r.kind === "local").length,
    missingOss: missing.filter((r) => r.kind === "oss").length,
    missing,
    byColumn,
  };
}

async function main() {
  const asJson = process.argv.includes("--json");
  const report = await runAudit();

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.missing.length > 0 ? 1 : 0);
  }

  console.log("产物完整性审计\n");
  for (const c of report.byColumn) {
    if (c.total === 0) continue;
    const flag = c.missing > 0 ? ` ⚠️ 缺失 ${c.missing}` : "";
    console.log(`  ${`${c.table}.${c.column}`.padEnd(34)} ${String(c.total).padStart(5)} 条  OSS ${String(c.oss).padStart(5)}${flag}`);
  }
  console.log(
    `\n总计 ${report.total} 条引用 | 本地 ${report.local} | OSS ${report.oss} | ` +
      `缺失 ${report.missing.length}（本地 ${report.missingLocal} / OSS ${report.missingOss}）`
  );

  if (report.missing.length > 0) {
    console.log("\n缺失明细（前 15 条）：");
    for (const m of report.missing.slice(0, 15)) {
      console.log(`  ${m.table}.${m.column} [${m.id.slice(0, 12)}…] ${m.ref}`);
    }
    if (report.missing.length > 15) console.log(`  …还有 ${report.missing.length - 15} 条`);
    console.log("\n⚠️ 缺失引用不会自动清理 —— 清空 DB 字段是不可逆的，需要人工确认后再决定。");
    process.exit(1);
  }
  console.log("\n✓ 全部引用都能对应到实际文件");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("审计失败:", err);
    process.exit(2);
  });
}
