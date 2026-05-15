/**
 * 手动执行数据库迁移
 * 用法: node scripts/run-migration.mjs
 */
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = resolve(__dirname, "..");

const Database = require("better-sqlite3");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { migrate } = require("drizzle-orm/better-sqlite3/migrator");

const dbPath = process.env.DATABASE_URL?.replace("file:", "") ?? "./data/aicomic.db";
const absolutePath = resolve(root, dbPath);

console.log("[migrate] DB path:", absolutePath);
fs.mkdirSync(dirname(absolutePath), { recursive: true });

const sqlite = new Database(absolutePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

const migrationsFolder = resolve(root, "drizzle");
console.log("[migrate] Running migrations from:", migrationsFolder);

migrate(db, { migrationsFolder });

// Verify users table
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log("[migrate] Tables:", tables.map(t => t.name).join(", "));

const hasUsers = tables.some(t => t.name === "users");
console.log(hasUsers ? "[migrate] ✓ users table created successfully" : "[migrate] ✗ users table missing!");

sqlite.close();
