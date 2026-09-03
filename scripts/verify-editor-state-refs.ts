/**
 * 实证验证：`episodes.editor_state` 的扫描盲区确实被两个脚本覆盖了。
 *
 * ## 为什么需要它
 *
 * `editor_state` 是一段 **JSON，素材路径内嵌在里面**，不是一个规规矩矩的引用列。
 * 存储迁移与本地清理这两个脚本都做了针对它的特殊处理，但那两段代码从来没被实证跑过 ——
 * 而它们出错的后果是**静默删掉用户时间线正在用的素材**（典型是只被时间线引用、
 * 没有任何列指向的 BGM），事后无法恢复。这类代码不能靠"读起来是对的"过关。
 *
 * ## 两个探针
 *
 *  - **探针 A（回归防线）**：只被 `editor_state` 引用，任何列都不指向它，
 *    并且在 OSS 上有一份内容一致的副本、映射文件里也有它 ——
 *    也就是说，**如果 prune-local 不扫描 editor_state，它就完全满足删除条件**。
 *    期望：被跳过，理由是"数据库仍指向这个本地路径"，文件仍在。
 *  - **探针 B（正对照）**：同时被 `shots.cut_point` 和 `editor_state` 引用。
 *    期望：storage-migrate 迁移它时，**连带把快照 JSON 里的那处引用也改写成 oss://**；
 *    随后它不再被任何本地引用，prune-local 应当真的删掉它（证明脚本本身是会干活的，
 *    探针 A 的"跳过"不是因为脚本什么都没做）。
 *
 * ## 隔离
 *
 * 数据库用副本（`DATABASE_URL` 指向沙箱），OSS 只碰 `__verify__/` 前缀并在结束时删除，
 * 探针文件放在 `UPLOAD_DIR/__verify__/` 下、结束时删除。真实数据一律不动。
 *
 * 用法：pnpm verify:editor-state
 */

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const UPLOAD_ROOT = process.env.UPLOAD_DIR || "./uploads";
const REAL_DB = (process.env.DATABASE_URL ?? "./data/aicomic.db").replace("file:", "");
const PROBE_DIR = path.join(UPLOAD_ROOT, "__verify__");
const OSS_PREFIX = "__verify__/";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}\n    ${detail}`);
}

function ossClient() {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw new Error("未配置 OSS（OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET）");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OSS = require("ali-oss");
  return new OSS({
    region: OSS_REGION, bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID, accessKeySecret: OSS_ACCESS_KEY_SECRET,
    secure: true, timeout: 5 * 60 * 1000,
  });
}

function runScript(script: string, args: string[], env: Record<string, string>): string {
  try {
    return execFileSync("npx", ["tsx", script, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
  }
}

async function main() {
  const oss = ossClient();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "acs-verify-"));
  const sandboxDb = path.join(sandbox, "aicomic.db");
  // prune-local 会在 DB 同级目录找 backups/；先建好（它现在也会自己建，这里是双保险）
  fs.mkdirSync(path.join(sandbox, "backups"), { recursive: true });

  console.log(`沙箱：${sandbox}`);
  console.log(`探针目录：${PROBE_DIR}\n`);

  try {
    // ── 准备：DB 副本 + 两个探针文件 ───────────────────────────────────────
    {
      const src = new Database(REAL_DB, { readonly: true });
      src.exec(`VACUUM INTO '${sandboxDb.replace(/'/g, "''")}'`);
      src.close();
    }

    fs.mkdirSync(PROBE_DIR, { recursive: true });
    // 引用形态必须与生产一致：相对 cwd 的 `uploads/...`，
    // 因为两个脚本都用 /(?:\.\/)?uploads\/[^"\\\s]+/ 去匹配快照 JSON
    const refA = path.join(UPLOAD_ROOT, "__verify__", "timeline-only.mp3").replace(/\\/g, "/");
    const refB = path.join(UPLOAD_ROOT, "__verify__", "column-and-timeline.mp4").replace(/\\/g, "/");
    const bodyA = Buffer.from("probe-A-timeline-only-" + "x".repeat(1000));
    const bodyB = Buffer.from("probe-B-column-and-timeline-" + "y".repeat(1000));
    fs.writeFileSync(refA, bodyA);
    fs.writeFileSync(refB, bodyB);
    const md5A = crypto.createHash("md5").update(bodyA).digest("hex");

    // 探针 A 也传一份到 OSS，并伪造一条映射记录 ——
    // 这样"如果不扫 editor_state"，它就是彻彻底底满足删除条件的
    const keyA = `${OSS_PREFIX}timeline-only.mp3`;
    await oss.put(keyA, bodyA);

    // ── 把探针写进沙箱 DB ──────────────────────────────────────────────────
    const db = new Database(sandboxDb);
    const episode = db
      .prepare(`SELECT id FROM episodes WHERE editor_state IS NOT NULL AND editor_state != '' LIMIT 1`)
      .get() as { id: string } | undefined;
    if (!episode) throw new Error("沙箱库里没有带时间线快照的剧集，无法验证");

    // 造一份最小时间线快照：一条 BGM 只引用探针 A，一条视频引用探针 B
    const snapshot = JSON.stringify({
      tracks: [
        { id: "t1", type: "video", name: "视频 1", clips: [{ id: "c1", type: "video", url: refB, startTime: 0, endTime: 3, duration: 3 }] },
        { id: "t2", type: "bgm", name: "背景音乐", clips: [{ id: "c2", type: "bgm", audioUrl: refA, startTime: 0, endTime: 3, duration: 3 }] },
      ],
    });
    db.prepare(`UPDATE episodes SET editor_state = ? WHERE id = ?`).run(snapshot, episode.id);

    const shot = db.prepare(`SELECT id FROM shots LIMIT 1`).get() as { id: string };
    db.prepare(`UPDATE shots SET cut_point = ? WHERE id = ?`).run(refB, shot.id);
    db.close();

    const env = { DATABASE_URL: sandboxDb };

    // ── 第 1 步：storage-migrate 只迁 shots.cut_point ─────────────────────
    const migrateOut = runScript(
      "scripts/storage-migrate.ts",
      ["--apply", "--only", "shots.cut_point"],
      env
    );

    const verify = new Database(sandboxDb, { readonly: true });
    const cutPoint = (verify.prepare(`SELECT cut_point AS v FROM shots WHERE id = ?`).get(shot.id) as { v: string }).v;
    const stateAfter = (verify.prepare(`SELECT editor_state AS s FROM episodes WHERE id = ?`).get(episode.id) as { s: string }).s;
    verify.close();

    check(
      "storage-migrate：列引用被迁到 OSS",
      cutPoint.startsWith("oss://"),
      `shots.cut_point = ${cutPoint}`
    );
    check(
      "storage-migrate：**快照 JSON 里内嵌的同一路径也被改写**（本次验证的核心）",
      !stateAfter.includes(refB) && /oss:\/\/__verify__\/column-and-timeline\.mp4/.test(stateAfter),
      migrateOut.match(/同步改写.*$/m)?.[0] ?? "stdout 未出现「同步改写」行",
    );
    check(
      "storage-migrate：只被时间线引用的素材不在迁移范围内（候选集来自 REF_COLUMNS）",
      stateAfter.includes(refA),
      `探针 A 在快照里仍是本地路径：${refA}`
    );

    // ── 第 2 步：给探针 A 伪造一条映射，模拟"曾迁过、如今只被时间线引用" ──
    const mapPath = path.join(sandbox, "backups", `storage-migration-${Date.now()}-probeA.json`);
    fs.writeFileSync(mapPath, JSON.stringify([
      {
        table: "episodes", column: "editor_state", id: episode.id,
        from: refA, to: `oss://${keyA}`,
        bytes: bodyA.length, md5: md5A,
      },
    ], null, 2));

    // ── 第 3 步：prune-local ───────────────────────────────────────────────
    const pruneOut = runScript("scripts/prune-local-after-migration.ts", ["--apply"], env);

    check(
      "prune-local：只被时间线引用的素材被判为「仍在用」而跳过",
      /数据库仍指向这个本地路径：\s*1/.test(pruneOut) && fs.existsSync(refA),
      `文件仍在=${fs.existsSync(refA)}；` +
        (pruneOut.match(/·\s*数据库仍指向这个本地路径：.*$/m)?.[0] ?? "stdout 未出现该跳过理由")
    );
    check(
      "prune-local：正对照 —— 已完全迁走、无本地引用的素材确实被删除",
      !fs.existsSync(refB),
      `探针 B 本地文件已删除=${!fs.existsSync(refB)}（证明脚本确实在干活，探针 A 的跳过不是空转）`
    );

    // ── 清理 ──────────────────────────────────────────────────────────────
    await oss.delete(keyA).catch(() => {});
    await oss.delete(`${OSS_PREFIX}column-and-timeline.mp4`).catch(() => {});
  } finally {
    fs.rmSync(PROBE_DIR, { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length > 0) {
    console.error(`\n失败：\n${failed.map((f) => `  · ${f.name}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
