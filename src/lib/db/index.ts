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
export function runMigrations() {
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
  }

  console.log("[DB] Migrations complete.");
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
