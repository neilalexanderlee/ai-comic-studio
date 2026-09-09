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
import { allowUserProviders, getPlatformKeyOwnerId, isAdminUser } from "@/lib/admin";

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

/**
 * 这次生成烧的是谁的 Key。
 *
 * `platform` 的请求受平台每日限额与全局并发约束（`billing/platform-usage.ts`），
 * `user`（BYOK）的不受约束 —— 自部署用户永远是后者，因此行为一行不变。
 */
export type KeySource = "user" | "platform";

/**
 * 取出某个归属人名下这个 provider 的**密钥与端点**。
 *
 * ⚠️ **安全不变量：密钥和端点必须来自同一个归属人。**
 *
 * `providerId` 是**客户端生成的 ULID**，存在用户自己的 model-store 里；平台模式下
 * 客户端还会拿到管理员的 provider 列表，也就知道了管理员的 providerId。
 * 所以如果写成「地址取用户的 prefs、密钥取管理员的」，用户只要在自己这边建一条
 * 同 id、baseUrl 指向自己服务器的 provider 记录，**一个请求就收到平台 Key** ——
 * 正是约定 8n 想堵的那个洞换个姿势复活。
 *
 * 这个函数把两者绑在同一个 ownerId 上，是唯一允许读取平台 Key 的路径。
 */
async function readOwnedCredentials(ownerId: string, providerId: string) {
  const secret = await readDecryptedSecret(ownerId, providerId);
  if (!secret?.apiKey) return null;
  // 服务端没有这个 provider 的记录 = 不知道该往哪发。**绝不退回用请求体里的地址** ——
  // 那正是「密钥从服务端取、地址听客户端的」这个洞本身。
  const trusted = await resolveTrustedEndpoint(ownerId, providerId);
  if (!trusted) return null;
  return { secret, trusted };
}

async function resolveOne(
  userId: string,
  config?: ProviderConfigWithId | null
): Promise<{ config: ProviderConfig | null | undefined; keySource: KeySource }> {
  await ensureProviderSecretsTable();
  if (!config) return { config, keySource: "user" };
  const providerId = config.providerId;
  if (!providerId) return { config, keySource: "user" };

  const empty = { ...config, apiKey: "", secretKey: undefined };

  // ① 用户自己的 Key 优先（BYOK）。
  //    托管模式（ALLOW_USER_PROVIDERS=0）下非管理员跳过这一步：那边统一用平台 Key，
  //    读到一条历史残留的用户密钥会让「我明明没配 Key 却在用别的地址」难以解释。
  const byokAllowed = allowUserProviders() || (await isAdminUser(userId));
  if (byokAllowed) {
    const own = await readOwnedCredentials(userId, providerId);
    if (own) {
      return {
        config: {
          ...config,
          protocol: own.trusted.protocol,
          baseUrl: own.trusted.baseUrl,
          apiKey: own.secret.apiKey,
          secretKey: own.secret.secretKey ?? undefined,
        },
        keySource: "user",
      };
    }
  }

  // ② 平台 Key 兜底：管理员在设置页配的那一份。
  //    这就是「用户既要买积分又要自带 Key」这个矛盾的解法。
  const ownerId = await getPlatformKeyOwnerId();
  if (!ownerId || ownerId === userId) return { config: empty, keySource: "user" };

  const platform = await readOwnedCredentials(ownerId, providerId);
  if (!platform) return { config: empty, keySource: "user" };

  return {
    config: {
      ...config,
      protocol: platform.trusted.protocol,
      baseUrl: platform.trusted.baseUrl,
      apiKey: platform.secret.apiKey,
      secretKey: platform.secret.secretKey ?? undefined,
    },
    keySource: "platform",
  };
}

export interface ResolvedModelConfig {
  config: ModelConfigPayload | undefined;
  /** 每种能力各自用的是谁的 Key —— 限额与（将来的）计费按这个判断 */
  sources: { text: KeySource; image: KeySource; video: KeySource };
}

/**
 * 注入密钥并**同时告知密钥来源**。生成入口（花钱的那条路）用这个。
 *
 * keySource 现在就必须一路传到用量闸门：等以后开计费再补，就是一次
 * 「写入路径和读取路径不一致」的半途重构（约定 8d 警告过的那种）。
 */
export async function resolveModelConfigWithSource(
  userId: string,
  modelConfig?: ModelConfigPayload
): Promise<ResolvedModelConfig> {
  if (!modelConfig) {
    return { config: modelConfig, sources: { text: "user", image: "user", video: "user" } };
  }
  const text = await resolveOne(userId, modelConfig.text);
  const image = await resolveOne(userId, modelConfig.image);
  const video = await resolveOne(userId, modelConfig.video);
  return {
    config: { text: text.config, image: image.config, video: video.config },
    sources: { text: text.keySource, image: image.keySource, video: video.keySource },
  };
}

/** 不关心密钥来源的调用方（剧本解析等纯文本路径）用这个薄封装 */
export async function hydrateModelConfigSecrets(
  userId: string,
  modelConfig?: ModelConfigPayload
): Promise<ModelConfigPayload | undefined> {
  return (await resolveModelConfigWithSource(userId, modelConfig)).config;
}

/**
 * 单个 provider 的密钥解析（BGM / 模型列表这类不走 modelConfig 的路径）。
 * 与 `resolveOne` 同一套优先级和同一条安全不变量。
 */
export async function resolveProviderCredentials(
  userId: string,
  providerId: string
): Promise<
  | { ok: true; protocol: string; baseUrl: string; apiKey: string; secretKey?: string; keySource: KeySource }
  | { ok: false }
> {
  await ensureProviderSecretsTable();
  if (!providerId) return { ok: false };

  const byokAllowed = allowUserProviders() || (await isAdminUser(userId));
  if (byokAllowed) {
    const own = await readOwnedCredentials(userId, providerId);
    if (own) {
      return {
        ok: true,
        protocol: own.trusted.protocol,
        baseUrl: own.trusted.baseUrl,
        apiKey: own.secret.apiKey,
        secretKey: own.secret.secretKey ?? undefined,
        keySource: "user",
      };
    }
  }

  const ownerId = await getPlatformKeyOwnerId();
  if (!ownerId || ownerId === userId) return { ok: false };
  const platform = await readOwnedCredentials(ownerId, providerId);
  if (!platform) return { ok: false };

  return {
    ok: true,
    protocol: platform.trusted.protocol,
    baseUrl: platform.trusted.baseUrl,
    apiKey: platform.secret.apiKey,
    secretKey: platform.secret.secretKey ?? undefined,
    keySource: "platform",
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
