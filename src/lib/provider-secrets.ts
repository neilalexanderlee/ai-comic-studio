import { and, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { scheduleDatabaseHotBackup } from "@/lib/db-file-backup";
import { db } from "@/lib/db";
import { providerSecrets } from "@/lib/db/schema";
import { syncSecretsVaultEncAfterMutation } from "@/lib/secrets-vault-file";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { getModelStorePrefs } from "@/lib/user-client-prefs";
import { assertUsableEndpoint } from "@/lib/provider-endpoint";
import { isBillingEnabled } from "@/lib/billing/gate";

type ProviderConfigWithId = ProviderConfig & {
  providerId?: string;
};

export interface ModelConfigPayload {
  text?: ProviderConfigWithId | null;
  image?: ProviderConfigWithId | null;
  video?: ProviderConfigWithId | null;
}

let providerSecretsTableReady = false;

export async function ensureProviderSecretsTable() {
  if (providerSecretsTableReady) return;
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS provider_secrets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      secret_key TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS provider_secrets_user_provider_idx
    ON provider_secrets(user_id, provider_id)
  `);
  providerSecretsTableReady = true;
}

/**
 * **本模块读取密钥的唯一入口**，返回值一定是明文。
 *
 * 之所以强制走这一个函数：曾经 `resolveOne` 和 `getProviderSecret` 各自 `db.select` 一遍，
 * 加密上线时只给后者接了 `decryptSecret`，前者（所有图片/视频/文本生成的密钥注入热路径）
 * 漏了，结果把密文当 API Key 发给上游，报 401「API key format is incorrect」。
 * 合并成一个读取点后，这类「漏接解密」在结构上不再可能发生。
 *
 * 存量明文会被 `decryptSecret` 原样返回，因此不需要数据迁移。
 */
async function readDecryptedSecret(userId: string, providerId: string) {
  const [row] = await db
    .select({
      apiKey: providerSecrets.apiKey,
      secretKey: providerSecrets.secretKey,
      updatedAt: providerSecrets.updatedAt,
    })
    .from(providerSecrets)
    .where(
      and(
        eq(providerSecrets.userId, userId),
        eq(providerSecrets.providerId, providerId)
      )
    )
    .limit(1);

  if (!row) return null;
  return {
    updatedAt: row.updatedAt,
    apiKey: decryptSecret(row.apiKey) ?? "",
    secretKey: decryptSecret(row.secretKey),
  };
}

/**
 * 取出这个 provider 的**可信端点**：协议与地址一律以服务端存的 provider 记录为准
 * （`user_client_prefs.model_store_json`），请求体里带来的同名字段不作数。
 *
 * 理由见 `provider-endpoint.ts` 的文件头：密钥从服务端取、地址却听客户端的，
 * 在平台统一 Key 模式下等于把 Key 送给任何人；今天也已经是一个 SSRF 面。
 *
 * 找不到记录返回 null —— 调用方据此**拒绝注入密钥**，而不是退回去用客户端给的地址。
 */
export async function resolveTrustedEndpoint(
  userId: string,
  providerId: string
): Promise<{ protocol: string; baseUrl: string } | null> {
  const prefs = await getModelStorePrefs(userId);
  const provider = prefs?.providers?.find((p) => p.id === providerId);
  if (!provider?.baseUrl) return null;
  assertUsableEndpoint(provider.baseUrl, { allowPrivate: !isBillingEnabled() });
  return { protocol: provider.protocol, baseUrl: provider.baseUrl };
}

async function resolveOne(
  userId: string,
  config?: ProviderConfigWithId | null
): Promise<ProviderConfig | null | undefined> {
  await ensureProviderSecretsTable();
  if (!config) return config;
  const providerId = config.providerId;
  if (!providerId) return config;

  const secret = await readDecryptedSecret(userId, providerId);

  if (!secret?.apiKey) {
    return {
      ...config,
      apiKey: "",
      secretKey: undefined,
    };
  }

  // 服务端没有这个 provider 的记录 = 不知道该往哪发。**绝不退回用请求体里的地址** ——
  // 那正是「密钥从服务端取、地址听客户端的」这个洞本身。
  const trusted = await resolveTrustedEndpoint(userId, providerId);
  if (!trusted) {
    return { ...config, apiKey: "", secretKey: undefined };
  }

  return {
    ...config,
    protocol: trusted.protocol,
    baseUrl: trusted.baseUrl,
    apiKey: secret.apiKey,
    secretKey: secret.secretKey ?? undefined,
  };
}

export async function hydrateModelConfigSecrets(
  userId: string,
  modelConfig?: ModelConfigPayload
): Promise<ModelConfigPayload | undefined> {
  if (!modelConfig) return modelConfig;
  return {
    text: await resolveOne(userId, modelConfig.text),
    image: await resolveOne(userId, modelConfig.image),
    video: await resolveOne(userId, modelConfig.video),
  };
}

export async function upsertProviderSecret(args: {
  userId: string;
  providerId: string;
  apiKey: string;
  secretKey?: string;
}) {
  await ensureProviderSecretsTable();
  const [existing] = await db
    .select({ id: providerSecrets.id })
    .from(providerSecrets)
    .where(
      and(
        eq(providerSecrets.userId, args.userId),
        eq(providerSecrets.providerId, args.providerId)
      )
    )
    .limit(1);

  // 落库前加密（未配置 AI_COMIC_SECRETS_VAULT_KEY 时降级为明文，见 secret-crypto.ts）
  const encApiKey = encryptSecret(args.apiKey) ?? "";
  const encSecretKey = encryptSecret(args.secretKey ?? null);

  if (existing) {
    await db
      .update(providerSecrets)
      .set({
        apiKey: encApiKey,
        secretKey: encSecretKey,
        updatedAt: new Date(),
      })
      .where(eq(providerSecrets.id, existing.id));
  } else {
    await db.insert(providerSecrets).values({
      id: ulid(),
      userId: args.userId,
      providerId: args.providerId,
      apiKey: encApiKey,
      secretKey: encSecretKey,
      updatedAt: new Date(),
    });
  }

  scheduleDatabaseHotBackup();
  await syncSecretsVaultEncAfterMutation();
}

export async function getProviderSecret(userId: string, providerId: string) {
  await ensureProviderSecretsTable();
  return readDecryptedSecret(userId, providerId);
}

export async function deleteProviderSecret(userId: string, providerId: string) {
  await ensureProviderSecretsTable();
  await db
    .delete(providerSecrets)
    .where(
      and(
        eq(providerSecrets.userId, userId),
        eq(providerSecrets.providerId, providerId)
      )
    );

  scheduleDatabaseHotBackup();
  await syncSecretsVaultEncAfterMutation();
}
