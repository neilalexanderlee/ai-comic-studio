import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  sqlite: unknown;
  drizzleDb: DrizzleDB;
};

function createDb(): DrizzleDB {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

  // Dynamic require to avoid loading native binary at build time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");

  const dbPath =
    process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db";
  const absolutePath = path.resolve(dbPath);

  // Ensure the directory exists before opening the database
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const sqlite = globalForDb.sqlite ?? new Database(absolutePath);
  // Keep a handle so migration helpers can inspect the same connection.
  globalForDb.sqlite = sqlite;

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const instance = drizzle(sqlite, { schema });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.drizzleDb = instance;
  }
  return instance;
}

/** 与 createDb 一致的主库绝对路径（用于备份等） */
export function getResolvedDatabasePath(): string {
  const dbPath =
    process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db";
  return path.resolve(dbPath);
}

/** 在主连接上执行单条 SQL（如 VACUUM INTO） */
export function execSqliteRaw(statement: string): void {
  createDb();
  const sqlite = globalForDb.sqlite as { exec: (sql: string) => void };
  sqlite.exec(statement);
}

type SqliteHandle = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => unknown;
  };
  // exec() runs raw SQL and supports multiple statements in one call —
  // this is what drizzle-orm's own migrator uses internally for SQLite.
  exec: (sql: string) => void;
};

function getSqliteHandle(): SqliteHandle {
  createDb();
  return globalForDb.sqlite as SqliteHandle;
}

/**
 * 对指定表执行参数化 UPDATE，返回实际更新行数。
 * 专为 migrate-data 等需要安全参数绑定的场景设计。
 * 内部使用 better-sqlite3 prepared statement，避免 drizzle Proxy 层的类型歧义。
 */
export function runParameterizedUpdate(
  table: string,
  set: Record<string, string>,
  where: Record<string, string>
): number {
  const sqlite = getSqliteHandle() as unknown as {
    prepare: (sql: string) => { run: (...args: string[]) => { changes: number } };
  };
  const setClauses = Object.keys(set).map((k) => `"${k}" = ?`).join(", ");
  const whereClauses = Object.keys(where).map((k) => `"${k}" = ?`).join(" AND ");
  const params = [...Object.values(set), ...Object.values(where)];
  try {
    const stmt = sqlite.prepare(`UPDATE "${table}" SET ${setClauses} WHERE ${whereClauses}`);
    const result = stmt.run(...params);
    return result.changes;
  } catch {
    return -1; // 表不存在等错误，由调用方处理
  }
}

/**
 * Idempotent migration runner — reads the drizzle journal and applies each
 * migration that hasn't been recorded in __drizzle_migrations yet.
 *
 * Handles both:
 *   • Fresh databases (Docker / new installs) — all migrations run cleanly.
 *   • Legacy databases — tables/columns that already exist produce "already
 *     exists" / "duplicate column name" errors which are silently skipped, so
 *     the hash is still recorded and the migration won't run again.
 *
 * Hash computation matches drizzle-orm's own migrator (SHA-256 of raw file
 * content), so the __drizzle_migrations table stays compatible.
 */
function applyMigrations() {
  const sqlite = getSqliteHandle();
  const migrationsFolder = path.resolve("drizzle");

  // Ensure tracking table exists
  sqlite
    .prepare(
      `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         hash       TEXT    NOT NULL,
         created_at INTEGER
       )`
    )
    .run();

  // Load journal
  type JournalEntry = { idx: number; tag: string; breakpoints: boolean };
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };

  // Collect already-applied hashes
  const applied = new Set<string>(
    (
      sqlite
        .prepare("SELECT hash FROM __drizzle_migrations")
        .all() as Array<{ hash: string }>
    ).map((r) => r.hash)
  );

  for (const entry of journal.entries) {
    const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlFile)) {
      console.warn(`[DB] Migration file not found, skipping: ${entry.tag}`);
      continue;
    }

    const content = fs.readFileSync(sqlFile, "utf8");
    // Same hash algorithm as drizzle-orm's migrator
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    if (applied.has(hash)) continue;

    // Split on statement-breakpoint markers; filter empty strings.
    // Each chunk may itself contain multiple semicolon-separated statements
    // (e.g. migrations that do CREATE TABLE / INSERT / DROP TABLE / RENAME),
    // so we use exec() which handles multi-statement SQL natively — exactly
    // what drizzle-orm's SQLite migrator does internally.
    const chunks = (
      entry.breakpoints
        ? content.split("--> statement-breakpoint")
        : [content]
    )
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`[DB] Applying migration: ${entry.tag}`);

    // ⚠️ 必须整体事务包裹。
    //
    // 真实事故（migration 0042）：文件里没有 statement-breakpoint，整份 SQL 作为
    // 一块交给 exec()，序列是 CREATE shots_new → INSERT → DROP shots → RENAME。
    // 无事务时第一次跑 CREATE 提交成功、INSERT 失败，留下一张空的 shots_new；
    // 第二次跑 CREATE 报 "already exists" 被下面的 catch 吞掉，exec() 在第一句
    // 就中止、后三句从未执行，**却照样被记录为「已应用」** ——
    // 于是 emotion / framing / lighting_atm 三列永远留在了 shots 表里。
    //
    // 加上事务后，一份迁移要么整体生效、要么整体回滚，不会再留下半截状态。
    sqlite.exec("BEGIN");
    let committed = false;
    try {
    for (const chunk of chunks) {
      try {
        sqlite.exec(chunk);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Schema already present from a pre-tracking install — safe to skip
        if (
          msg.includes("already exists") ||
          msg.includes("duplicate column name")
        ) {
          console.warn(
            `[DB] Skipping already-applied chunk in ${entry.tag}: ${msg}`
          );
        } else {
          throw err;
        }
      }
    }

      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)"
        )
        .run(hash, Date.now());

      sqlite.exec("COMMIT");
      committed = true;
    } finally {
      // 任一语句抛出时整体回滚，绝不留下半截迁移
      if (!committed) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          /* 没有活跃事务时 ROLLBACK 会报错，忽略 */
        }
      }
    }
  }

  console.log("[DB] Migrations complete.");
}

/**
 * 迁移锁。
 *
 * ## 为什么需要
 *
 * `bootstrap()` 里就有 `runMigrations()`，而 web 与 worker 是**两个都会调用它的进程**。
 * 在已经迁移过的库上这没事（各自读到"全部已应用"直接返回）；但**全新数据库 + 两个进程
 * 同时首启**时，两边会交错地跑同一批迁移，撞出
 * `no such table: character_assets` 这类"表还没建就去 ALTER"的错误 ——
 * 实测把 worker 打进了重启循环。
 *
 * 这是 worker 外置引入的缺陷：单进程时代不存在第二个迁移者。
 *
 * ## 为什么不是"只让 web 迁移"
 *
 * 那样 worker-only 的部署（以及自部署用户把 web 侧关掉的情况）就永远迁移不了。
 * 锁的语义是"谁先到谁做，其余的等它做完"，两种拓扑都成立。
 */
const MIGRATION_LOCK_STALE_MS = 10 * 60 * 1000;
const MIGRATION_LOCK_POLL_MS = 500;

/**
 * 等锁的上限。可用 `MIGRATION_LOCK_WAIT_MS` 覆盖 ——
 * 等待是**同步**的（见 sleepSync），单测里没法靠定时器在同一线程释放锁，
 * 只能把上限调短来验证"确实在等而不是直接闯进去"。
 */
function migrationLockWaitMs(): number {
  const raw = Number(process.env.MIGRATION_LOCK_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
}

function sleepSync(ms: number): void {
  // 迁移发生在启动阶段，此时阻塞事件循环是可接受的 —— 而且必须同步，
  // 因为 runMigrations 是同步函数，改成异步会波及每一个调用方。
  //
  // ⚠️ 代价：等待期间**本线程的定时器不会触发**。所以持锁方必须是另一个进程
  //（生产上正是如此），同线程里"边等边释放"是解不开的死锁。
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 返回 true 表示本进程拿到了锁并应当执行迁移；false 表示别的进程已经做完了。 */
function acquireMigrationLock(sqlite: SqliteHandle, owner: string): boolean {
  sqlite
    .prepare(
      `CREATE TABLE IF NOT EXISTS __migration_lock (
         id        INTEGER PRIMARY KEY CHECK (id = 1),
         locked_at INTEGER NOT NULL,
         owner     TEXT
       )`
    )
    .run();

  const deadline = Date.now() + migrationLockWaitMs();
  for (;;) {
    try {
      sqlite
        .prepare(`INSERT INTO __migration_lock (id, locked_at, owner) VALUES (1, ?, ?)`)
        .run(Date.now(), owner);
      return true;
    } catch {
      // 已被占用。持有者可能已经崩了 —— 超过阈值就抢过来，
      // 否则一次崩溃会让后续所有启动永久卡死。
      const row = sqlite
        .prepare(`SELECT locked_at, owner FROM __migration_lock WHERE id = 1`)
        .get() as { locked_at: number; owner: string | null } | undefined;

      if (row && Date.now() - row.locked_at > MIGRATION_LOCK_STALE_MS) {
        console.warn(`[DB] 迁移锁已陈旧（持有者 ${row.owner}），抢占`);
        sqlite.prepare(`DELETE FROM __migration_lock WHERE id = 1`).run();
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error("[DB] 等待迁移锁超时：另一个进程迁移耗时过长或已卡死");
      }
      sleepSync(MIGRATION_LOCK_POLL_MS);
    }
  }
}

/**
 * 执行迁移。**同一时刻只有一个进程真正在跑**，其余进程在这里等它做完再返回。
 */
export function runMigrations() {
  const sqlite = getSqliteHandle();
  const owner = `pid:${process.pid}`;

  acquireMigrationLock(sqlite, owner);
  try {
    // 拿到锁之后才读"已应用"集合 —— 等待期间别的进程可能刚好全部做完，
    // 那样这里就是一次干净的空转。
    applyMigrations();
  } finally {
    try {
      sqlite.prepare(`DELETE FROM __migration_lock WHERE id = 1`).run();
    } catch (err) {
      console.warn("[DB] 释放迁移锁失败:", err);
    }
  }
}

// Proxy preserves the `db` export API — lazy-inits on first property access
export const db: DrizzleDB = new Proxy({} as DrizzleDB, {
  get(_, prop) {
    const instance = createDb();
    const value = (instance as never)[prop];
    if (typeof value === "function") {
      return (value as Function).bind(instance);
    }
    return value;
  },
});

export type DB = typeof db;
