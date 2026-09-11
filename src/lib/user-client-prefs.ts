import { db } from "@/lib/db";
import { userClientPrefs } from "@/lib/db/schema";
import type { ModelStorePersistPayload } from "@/stores/model-store";
import { eq, sql } from "drizzle-orm";

export type { ModelStorePersistPayload };

let tableReady = false;

export async function ensureUserClientPrefsTable() {
  if (tableReady) return;
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS user_client_prefs (
      user_id TEXT PRIMARY KEY NOT NULL,
      model_store_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  tableReady = true;
}

/**
 * 带版本号的那一份。
 *
 * `updatedAt` 是客户端判断「服务端那份比我手里这份新吗」的唯一依据 ——
 * 必须是**服务端时钟**：浏览器本地时间可能与服务器差几分钟（甚至被用户改过），
 * 两边各记各的时间戳就会出现「我这份明明更旧却被判成更新」，
 * 而症状是「在另一台设备上改的模型列表莫名其妙被旧的盖回去」。
 */
export interface ModelStoreRecord {
  payload: ModelStorePersistPayload;
  /** 毫秒时间戳（服务端时钟） */
  updatedAt: number;
}

export async function getModelStoreRecord(userId: string): Promise<ModelStoreRecord | null> {
  if (!userId) return null;
  await ensureUserClientPrefsTable();
  const [row] = await db.select().from(userClientPrefs).where(eq(userClientPrefs.userId, userId)).limit(1);
  if (!row?.modelStoreJson) return null;
  try {
    return {
      payload: JSON.parse(row.modelStoreJson) as ModelStorePersistPayload,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : Number(row.updatedAt) * 1000,
    };
  } catch {
    return null;
  }
}

export async function getModelStorePrefs(userId: string): Promise<ModelStorePersistPayload | null> {
  return (await getModelStoreRecord(userId))?.payload ?? null;
}

/** @returns 写入后的 `updatedAt`（毫秒，服务端时钟），供客户端记下「我手里是哪一版」 */
export async function upsertModelStorePrefs(
  userId: string,
  payload: ModelStorePersistPayload
): Promise<number> {
  if (!userId) return 0;
  await ensureUserClientPrefsTable();
  const json = JSON.stringify(payload);
  const now = new Date();
  const [existing] = await db.select({ userId: userClientPrefs.userId }).from(userClientPrefs).where(eq(userClientPrefs.userId, userId)).limit(1);
  if (existing) {
    await db
      .update(userClientPrefs)
      .set({ modelStoreJson: json, updatedAt: now })
      .where(eq(userClientPrefs.userId, userId));
  } else {
    await db.insert(userClientPrefs).values({ userId, modelStoreJson: json, updatedAt: now });
  }
  // ⚠️ 回读而不是直接返回 `now.getTime()`：Drizzle 的 `mode:"timestamp"` 只存到**秒**，
  // 毫秒部分会被截掉。返回未截断的值会让客户端记下一个「比服务端那份大」的版本号，
  // 于是下次拉取时永远判成「本地更新」，服务端的改动再也进不来。
  return (await getModelStoreRecord(userId))?.updatedAt ?? now.getTime();
}
