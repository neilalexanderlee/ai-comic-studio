import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, getResolvedDatabasePath } from "@/lib/db";
import { providerSecrets } from "@/lib/db/schema";

const KDF_SALT = "aicomic-secrets-vault-v1";

function vaultKey(): Buffer | null {
  const pass = process.env.AI_COMIC_SECRETS_VAULT_KEY?.trim();
  if (!pass || pass.length < 8) return null;
  return scryptSync(pass, KDF_SALT, 32);
}

/**
 * 将 provider_secrets 全表加密写入主库目录下的 `secrets-vault.enc.json`（权限 600）。
 * 需设置 AI_COMIC_SECRETS_VAULT_KEY（≥8 字符）；未设置则跳过。
 * 用于主库损坏时手工解密恢复；日常仍以 SQLite 为准。
 */
export async function syncSecretsVaultEncAfterMutation(): Promise<void> {
  const key = vaultKey();
  if (!key) return;

  try {
    const rows = await db.select().from(providerSecrets);
    const plain = JSON.stringify(
      rows.map((r) => ({
        userId: r.userId,
        providerId: r.providerId,
        apiKey: r.apiKey,
        secretKey: r.secretKey,
        updatedAt:
          r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
      }))
    );

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = {
      v: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: enc.toString("base64"),
    };

    const dest = path.join(path.dirname(getResolvedDatabasePath()), "secrets-vault.enc.json");
    fs.writeFileSync(dest, JSON.stringify(payload), { mode: 0o600 });
  } catch (err) {
    console.warn("[secrets-vault] write skipped:", err instanceof Error ? err.message : err);
  }
}
