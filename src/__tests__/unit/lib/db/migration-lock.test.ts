/**
 * 迁移锁 —— 跑在**真实的临时 SQLite 文件**上（不是内存库：要模拟两个进程打开同一个库）。
 *
 * 锁住的不变量：
 *  · 锁被占用时，第二个调用者不会同时进入迁移
 *  · 持有者崩掉留下的陈旧锁能被抢占 —— 否则一次崩溃会让后续所有启动永久卡死
 *  · 迁移结束后锁必须释放，**失败路径也要释放**
 *
 * 背景：`bootstrap()` 里就有 `runMigrations()`，而 web 与 worker 是两个都会调用它的
 * 进程。全新数据库 + 两个进程同时首启时，两边交错跑同一批迁移，实测撞出
 * `no such table: character_assets` 并把 worker 打进重启循环。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

// 全局 setup.ts 同时 mock 了 node:fs 和 @/lib/db；本测试两者都要真的：
// 迁移锁的正确性全在真实文件与真实 SQLite 连接上，mock 掉就等于没测。
vi.mock("node:fs", async (importOriginal) => importOriginal());
vi.mock("@/lib/db", async (importOriginal) => importOriginal());
import fs from "node:fs";

let tmpDir: string;
let dbFile: string;

/**
 * 预先把所有迁移标记为已应用，让 runMigrations() 变成一次干净空转。
 *
 * 这样测的就只有锁本身。刻意**不**跑真实迁移链：那条链目前建不出全新数据库
 * （`character_assets` 没有任何迁移创建它），锁的测试不该被那个独立缺陷绑架。
 */
async function seedApplied() {
  const Database = (await import("better-sqlite3")).default;
  const crypto = await import("node:crypto");
  const db = new Database(dbFile);
  db.prepare(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at INTEGER)`
  ).run();
  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  for (const e of journal.entries) {
    const file = path.join("drizzle", `${e.tag}.sql`);
    if (!fs.existsSync(file)) continue;
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file, "utf8")).digest("hex");
    db.prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`).run(hash, Date.now());
  }
  db.close();
}

async function freshDb() {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", `file:${dbFile}`);
  await seedApplied();
  return await import("@/lib/db");
}

/** 直接开一个独立连接，模拟"另一个进程" */
async function otherProcessHandle() {
  const Database = (await import("better-sqlite3")).default;
  return new Database(dbFile);
}

beforeEach(() => {
  // `createDb()` 把连接缓存在 globalThis 上，`vi.resetModules()` 清不掉它 ——
  // 不手动清，第二个用例会复用第一个用例那条指向已删除文件的连接。
  const g = globalThis as unknown as { sqlite?: unknown; drizzleDb?: unknown };
  delete g.sqlite;
  delete g.drizzleDb;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-miglock-"));
  dbFile = path.join(tmpDir, "test.db");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("迁移锁", () => {
  it("正常跑完之后锁被释放，不会挡住下一次启动", async () => {
    const { runMigrations } = await freshDb();
    runMigrations();

    const other = await otherProcessHandle();
    const held = other
      .prepare(`SELECT COUNT(*) c FROM __migration_lock`)
      .get() as { c: number };
    expect(held.c).toBe(0);
    other.close();
  });

  it("可重复调用，每次都干净地拿锁又还锁", async () => {
    const { runMigrations } = await freshDb();
    for (let i = 0; i < 3; i++) expect(() => runMigrations()).not.toThrow();

    const other = await otherProcessHandle();
    const held = other.prepare(`SELECT COUNT(*) c FROM __migration_lock`).get() as { c: number };
    expect(held.c).toBe(0);
    other.close();
  });

  it("锁被别的进程持有且未过期时，绝不闯进去 —— 宁可超时报错", async () => {
    // 等待是同步的（Atomics.wait），同线程里没法边等边释放，
    // 所以把等待上限调到 1.2 秒，验证"确实在等且最终报超时"。
    vi.stubEnv("MIGRATION_LOCK_WAIT_MS", "1200");
    const { runMigrations } = await freshDb();
    runMigrations(); // 让锁表存在

    const other = await otherProcessHandle();
    other
      .prepare(`INSERT INTO __migration_lock (id, locked_at, owner) VALUES (1, ?, 'pid:other')`)
      .run(Date.now());

    const started = Date.now();
    expect(() => runMigrations()).toThrow(/等待迁移锁超时/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);

    // 超时不该把别人的锁抢走
    const held = other.prepare(`SELECT owner FROM __migration_lock WHERE id = 1`).get() as {
      owner: string;
    };
    expect(held.owner).toBe("pid:other");
    other.close();
  });

  it("陈旧锁会被抢占 —— 一次崩溃不该让后续启动永久卡死", async () => {
    const { runMigrations } = await freshDb();
    runMigrations();

    const other = await otherProcessHandle();
    // 伪造一个 20 分钟前留下的锁（持有者已经崩了）
    other
      .prepare(`INSERT INTO __migration_lock (id, locked_at, owner) VALUES (1, ?, 'pid:dead')`)
      .run(Date.now() - 20 * 60 * 1000);

    const started = Date.now();
    expect(() => runMigrations()).not.toThrow();
    // 抢占是立即的，不该在这里等满超时
    expect(Date.now() - started).toBeLessThan(3000);

    const held = other
      .prepare(`SELECT COUNT(*) c FROM __migration_lock`)
      .get() as { c: number };
    expect(held.c).toBe(0);
    other.close();
  });
});
