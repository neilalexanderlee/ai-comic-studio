import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { scheduleDatabaseHotBackup } from "@/lib/db-file-backup";
import { db } from "@/lib/db";
import { arkAssetLibraryCredentials } from "@/lib/db/schema";
import type { ArkAssetLibraryCredentials } from "@/lib/ai/ark-asset-library";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";

/**
 * 私域素材库 AK/SK 凭证的 DB 读写。
 * 与 provider-secrets.ts（Bearer API Key）分开：素材库管控面 API 用 AK/SK 签名鉴权，
 * 且需要额外的 projectName / region 字段，通用 provider_secrets 表放不下。
 * 每用户最多一套凭证（账号级能力，不区分 Provider/模型）。
 */

export interface ArkAssetLibraryCredentialRecord {
  accessKeyId: string;
  secretAccessKey: string;
  projectName: string;
  region: string;
  updatedAt: Date;
}

export async function getArkAssetLibraryCredentials(
  userId: string
): Promise<ArkAssetLibraryCredentialRecord | null> {
  const [row] = await db
    .select({
      accessKeyId: arkAssetLibraryCredentials.accessKeyId,
      secretAccessKey: arkAssetLibraryCredentials.secretAccessKey,
      projectName: arkAssetLibraryCredentials.projectName,
      region: arkAssetLibraryCredentials.region,
      updatedAt: arkAssetLibraryCredentials.updatedAt,
    })
    .from(arkAssetLibraryCredentials)
    .where(eq(arkAssetLibraryCredentials.userId, userId))
    .limit(1);
  return row ?? null;
}

/** 供服务端生成路径直接拿到可传入 ark-asset-library.ts 的凭证对象；未配置时返回 null */
export async function resolveArkAssetLibraryClientCredentials(
  userId: string
): Promise<ArkAssetLibraryCredentials | null> {
  const row = await getArkAssetLibraryCredentials(userId);
  if (!row?.accessKeyId || !row?.secretAccessKey) return null;
  // 存量明文会被 decryptSecret 原样返回（见 secret-crypto.ts）
  return {
    accessKeyId: decryptSecret(row.accessKeyId) ?? "",
    secretAccessKey: decryptSecret(row.secretAccessKey) ?? "",
    projectName: row.projectName,
    region: row.region,
  };
}

export async function upsertArkAssetLibraryCredentials(args: {
  userId: string;
  accessKeyId: string;
  secretAccessKey: string;
  projectName?: string;
  region?: string;
}) {
  const [existing] = await db
    .select({ id: arkAssetLibraryCredentials.id })
    .from(arkAssetLibraryCredentials)
    .where(eq(arkAssetLibraryCredentials.userId, args.userId))
    .limit(1);

  if (existing) {
    await db
      .update(arkAssetLibraryCredentials)
      .set({
        accessKeyId: encryptSecret(args.accessKeyId) ?? "",
        secretAccessKey: encryptSecret(args.secretAccessKey) ?? "",
        projectName: args.projectName || "default",
        region: args.region || "cn-beijing",
        updatedAt: new Date(),
      })
      .where(eq(arkAssetLibraryCredentials.id, existing.id));
  } else {
    await db.insert(arkAssetLibraryCredentials).values({
      id: ulid(),
      userId: args.userId,
      accessKeyId: encryptSecret(args.accessKeyId) ?? "",
      secretAccessKey: encryptSecret(args.secretAccessKey) ?? "",
      projectName: args.projectName || "default",
      region: args.region || "cn-beijing",
      updatedAt: new Date(),
    });
  }

  scheduleDatabaseHotBackup();
}

export async function deleteArkAssetLibraryCredentials(userId: string) {
  await db
    .delete(arkAssetLibraryCredentials)
    .where(eq(arkAssetLibraryCredentials.userId, userId));
  scheduleDatabaseHotBackup();
}
