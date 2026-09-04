/**
 * 空库基线 —— 跑在**真实的临时 SQLite 文件**上。
 *
 * 背景：本项目早期用 `drizzle-kit push` 直接改库，没留下对应迁移。
 * `character_assets` 整张表、`shots.first_frame_remote_url` / `scene_title` 等列
 * 都是"只被后来的迁移重命名/删除过，却从没被任何迁移创建过"。
 * 于是**现有库能用只是因为它从没被从零建过** —— 全新安装跑到 0017 就连环失败
 * （实测 7 个迁移失败、3 张表建不出来，Docker 部署直接起不来）。
 *
 * 锁住的不变量：
 *  · 空库能建出完整 schema，且与 schema.ts 声明的表一一对应
 *  · **既有库绝不走基线路径** —— 判空的谓词写错会让它去动生产库
 *  · 基线覆盖到的迁移被记为已应用，之后新增的迁移仍照常增量执行
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs", async (importOriginal) => importOriginal());
vi.mock("@/lib/db", async (importOriginal) => importOriginal());
import fs from "node:fs";

let tmpDir: string;
let dbFile: string;

async function freshDb() {
  const g = globalThis as unknown as { sqlite?: unknown; drizzleDb?: unknown };
  delete g.sqlite;
  delete g.drizzleDb;
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", `file:${dbFile}`);
  return await import("@/lib/db");
}

async function tables(): Promise<string[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbFile);
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
         AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         AND name NOT LIKE '\\_\\_%' ESCAPE '\\'
       ORDER BY name`
    )
    .all() as Array<{ name: string }>;
  db.close();
  return rows.map((r) => r.name);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-baseline-"));
  dbFile = path.join(tmpDir, "test.db");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("空库基线", () => {
  it("空库能建出 schema.ts 声明的全部表", async () => {
    const { runMigrations } = await freshDb();
    runMigrations();

    const built = new Set(await tables());
    const declared = new Set(
      [...fs.readFileSync("src/lib/db/schema.ts", "utf8").matchAll(/sqliteTable\("([a-z_]+)"/g)].map(
        (m) => m[1]
      )
    );
    expect(declared.size).toBeGreaterThan(20); // 正则失效时别静默通过
    const missing = [...declared].filter((t) => !built.has(t));
    expect(missing).toEqual([]);
  });

  it("基线覆盖到的迁移被记为已应用 —— 不会再去重放它们", async () => {
    const { runMigrations } = await freshDb();
    runMigrations();

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbFile);
    const applied = (
      db.prepare(`SELECT COUNT(*) c FROM __drizzle_migrations`).get() as { c: number }
    ).c;
    db.close();

    const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const { throughTag } = JSON.parse(
      fs.readFileSync("drizzle/baseline/meta.json", "utf8")
    ) as { throughTag: string };
    const expected = journal.entries.findIndex((e) => e.tag === throughTag) + 1;
    expect(expected).toBeGreaterThan(0); // throughTag 必须在 journal 里
    expect(applied).toBe(expected);
  });

  it("可重复执行 —— 第二次不报错也不改变 schema", async () => {
    const { runMigrations } = await freshDb();
    runMigrations();
    const first = await tables();
    expect(() => runMigrations()).not.toThrow();
    expect(await tables()).toEqual(first);
  });

  /**
   * 这条最要紧。判空的谓词一旦写错（`LIKE '__%'` 里的 `_` 是单字符通配符，
   * 会匹配几乎所有表名），既有库会被判成空库并被拖去建基线 —— 实测踩过。
   */
  it("既有库不会被判成空库", async () => {
    const Database = (await import("better-sqlite3")).default;
    const seed = new Database(dbFile);
    seed.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY)`);
    seed.close();

    const { runMigrations } = await freshDb();
    // 走增量路径时，这条残缺的历史链一定会失败 —— 失败本身就证明没走基线
    let wentBaseline = true;
    try {
      runMigrations();
    } catch {
      wentBaseline = false;
    }
    expect(wentBaseline).toBe(false);

    // 并且基线确实没被应用：character_assets 只有基线建得出来
    //（残缺的历史链里没有任何迁移创建它 —— 那正是本次修复的起因）
    expect(await tables()).not.toContain("character_assets");
  });
});
