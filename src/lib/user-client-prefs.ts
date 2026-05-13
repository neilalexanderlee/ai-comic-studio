import { db } from "@/lib/db";
import { userClientPrefs } from "@/lib/db/schema";
import type { ModelRef, Provider } from "@/stores/model-store";
import { eq, sql } from "drizzle-orm";

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

/** 与 model-store zustand partialize 一致（密钥仍在 provider_secrets） */
export type ModelStorePersistPayload = {
  providers: Array<Omit<Provider, "apiKey" | "secretKey"> & { apiKey?: string; secretKey?: undefined }>;
  defaultTextModel: ModelRef | null;
  defaultImageModel: ModelRef | null;
  defaultVideoModel: ModelRef | null;
};

export async function getModelStorePrefs(userId: string): Promise<ModelStorePersistPayload | null> {
  if (!userId) return null;
  await ensureUserClientPrefsTable();
  const [row] = await db.select().from(userClientPrefs).where(eq(userClientPrefs.userId, userId)).limit(1);
  if (!row?.modelStoreJson) return null;
  try {
    return JSON.parse(row.modelStoreJson) as ModelStorePersistPayload;
  } catch {
    return null;
  }
}

export async function upsertModelStorePrefs(userId: string, payload: ModelStorePersistPayload): Promise<void> {
  if (!userId) return;
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
}
