import fs from "node:fs";
import path from "node:path";
import { execSqliteRaw, getResolvedDatabasePath } from "@/lib/db";

const DEBOUNCE_MS = 3500;
const KEEP_FILES = 8;

let timer: ReturnType<typeof setTimeout> | null = null;

function isBackupDisabled() {
  const v = process.env.AI_COMIC_DISABLE_DB_BACKUP;
  return v === "1" || v === "true";
}

/**
 * 密钥等写入后防抖触发：对当前 SQLite 执行 VACUUM INTO，生成完整库快照（含密钥表）。
 * 文件位于主库同目录下 `backups/aicomic-<ISO>.db`，超过 KEEP_FILES 份则删最旧。
 */
export function scheduleDatabaseHotBackup(): void {
  if (isBackupDisabled()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      runVacuumIntoSnapshot();
    } catch (err) {
      console.warn("[DB backup] failed:", err instanceof Error ? err.message : err);
    }
  }, DEBOUNCE_MS);
}

function runVacuumIntoSnapshot(): void {
  const mainPath = getResolvedDatabasePath();
  const backupDir = path.join(path.dirname(mainPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(backupDir, `aicomic-${stamp}.db`);

  const normalized = destPath.replace(/\\/g, "/").replace(/'/g, "''");
  execSqliteRaw(`VACUUM INTO '${normalized}'`);

  rotateOldBackups(backupDir);
}

function rotateOldBackups(backupDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(backupDir, { withFileTypes: true });
  } catch {
    return;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.startsWith("aicomic-") && e.name.endsWith(".db"))
    .map((e) => ({
      name: e.name,
      path: path.join(backupDir, e.name),
      mtime: fs.statSync(path.join(backupDir, e.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (let i = KEEP_FILES; i < files.length; i++) {
    try {
      fs.unlinkSync(files[i].path);
    } catch {
      // ignore
    }
  }
}
