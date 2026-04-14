import { and, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { providerSecrets } from "@/lib/db/schema";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";

type ProviderConfigWithId = ProviderConfig & {
  providerId?: string;
};

export interface ModelConfigPayload {
  text?: ProviderConfigWithId | null;
  image?: ProviderConfigWithId | null;
  video?: ProviderConfigWithId | null;
}

let providerSecretsTableReady = false;

async function ensureProviderSecretsTable() {
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

async function resolveOne(
  userId: string,
  config?: ProviderConfigWithId | null
): Promise<ProviderConfig | null | undefined> {
  await ensureProviderSecretsTable();
  if (!config) return config;
  const providerId = config.providerId;
  if (!providerId) return config;

  const [secret] = await db
    .select({
      apiKey: providerSecrets.apiKey,
      secretKey: providerSecrets.secretKey,
    })
    .from(providerSecrets)
    .where(
      and(
        eq(providerSecrets.userId, userId),
        eq(providerSecrets.providerId, providerId)
      )
    )
    .limit(1);

  if (!secret?.apiKey) {
    return {
      ...config,
      apiKey: "",
      secretKey: undefined,
    };
  }

  return {
    ...config,
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

  if (existing) {
    await db
      .update(providerSecrets)
      .set({
        apiKey: args.apiKey,
        secretKey: args.secretKey ?? null,
        updatedAt: new Date(),
      })
      .where(eq(providerSecrets.id, existing.id));
    return;
  }

  await db.insert(providerSecrets).values({
    id: ulid(),
    userId: args.userId,
    providerId: args.providerId,
    apiKey: args.apiKey,
    secretKey: args.secretKey ?? null,
    updatedAt: new Date(),
  });
}

export async function getProviderSecret(userId: string, providerId: string) {
  await ensureProviderSecretsTable();
  const [secret] = await db
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
  return secret ?? null;
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
}
