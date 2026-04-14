import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function getSqliteHandle() {
  createDb();
  return globalForDb.sqlite as {
    prepare: (sql: string) => { get: (...args: unknown[]) => any; all: (...args: unknown[]) => any[]; run: (...args: unknown[]) => any };
    transaction: (fn: (rows: Array<{ hash: string; created_at: number }>) => void) => (rows: Array<{ hash: string; created_at: number }>) => void;
  };
}

function hasMigrationsTable(sqlite: ReturnType<typeof getSqliteHandle>) {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations' LIMIT 1")
    .get();
  return !!row;
}

function getMigrationRowCount(sqlite: ReturnType<typeof getSqliteHandle>) {
  const row = sqlite.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function hasProjectsUserIdColumn(sqlite: ReturnType<typeof getSqliteHandle>) {
  const cols = sqlite.prepare("PRAGMA table_info(projects)").all() as Array<{ name?: string }>;
  return cols.some((c) => c.name === "user_id");
}

function isDuplicateColumnError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("duplicate column name");
}

function backfillMigrationHistoryFromFreshDb(
  sqlite: ReturnType<typeof getSqliteHandle>,
  migrationsFolder: string
) {
  // Dynamic require to avoid loading native binary at build time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");

  const tempPath = path.join(
    os.tmpdir(),
    `aicomicbuilder-migrate-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  const tempSqlite = new Database(tempPath);
  try {
    tempSqlite.pragma("journal_mode = WAL");
    tempSqlite.pragma("foreign_keys = ON");
    const tempDb = drizzle(tempSqlite, { schema });
    migrate(tempDb, { migrationsFolder });
    const rows = tempSqlite
      .prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at")
      .all() as Array<{ hash: string; created_at: number }>;

    if (rows.length === 0) return;
    const insert = sqlite.prepare(
      "INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)"
    );
    const tx = sqlite.transaction((entries: Array<{ hash: string; created_at: number }>) => {
      for (const r of entries) {
        insert.run(r.hash, r.created_at);
      }
    });
    tx(rows);
  } finally {
    tempSqlite.close();
    fs.rmSync(tempPath, { force: true });
  }
}

export function runMigrations() {
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
  const migrationsFolder = path.resolve("drizzle");
  const instance = createDb();
  try {
    migrate(instance, { migrationsFolder });
  } catch (err) {
    const sqlite = getSqliteHandle();
    const shouldBackfill =
      isDuplicateColumnError(err) &&
      hasMigrationsTable(sqlite) &&
      getMigrationRowCount(sqlite) === 0 &&
      hasProjectsUserIdColumn(sqlite);

    if (!shouldBackfill) throw err;

    console.warn(
      "[DB] Detected legacy schema with empty __drizzle_migrations. Backfilling migration history..."
    );
    backfillMigrationHistoryFromFreshDb(sqlite, migrationsFolder);
    migrate(instance, { migrationsFolder });
    console.warn("[DB] Migration history backfilled.");
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
