import { db } from "@/lib/db";
import {
  projects,
  promptPresets,
  promptTemplates,
  providerSecrets,
  userClientPrefs,
} from "@/lib/db/schema";
import { ensureProviderSecretsTable } from "@/lib/provider-secrets";
import { ensureUserClientPrefsTable } from "@/lib/user-client-prefs";
import { eq, or, sql } from "drizzle-orm";

function isReclaimDisabled() {
  const v = process.env.AI_COMIC_DISABLE_LOCAL_RECLAIM;
  return v === "1" || v === "true";
}

function isNonEmptyUid(uid: string | null | undefined): uid is string {
  return Boolean(uid && uid.trim() !== "");
}

async function currentUserHasClaims(userId: string): Promise<boolean> {
  await ensureProviderSecretsTable();
  await ensureUserClientPrefsTable();

  const [{ pc }] = await db
    .select({ pc: sql<number>`count(*)` })
    .from(projects)
    .where(eq(projects.userId, userId));
  if (Number(pc) > 0) return true;

  const [{ sc }] = await db
    .select({ sc: sql<number>`count(*)` })
    .from(providerSecrets)
    .where(eq(providerSecrets.userId, userId));
  if (Number(sc) > 0) return true;

  const [{ tc }] = await db
    .select({ tc: sql<number>`count(*)` })
    .from(promptTemplates)
    .where(eq(promptTemplates.userId, userId));
  if (Number(tc) > 0) return true;

  const [{ prc }] = await db
    .select({ prc: sql<number>`count(*)` })
    .from(promptPresets)
    .where(eq(promptPresets.userId, userId));
  if (Number(prc) > 0) return true;

  const [{ ucc }] = await db
    .select({ ucc: sql<number>`count(*)` })
    .from(userClientPrefs)
    .where(eq(userClientPrefs.userId, userId));
  return Number(ucc) > 0;
}

/** 各表中出现的非空 user_id 并集 */
async function distinctLegacyOwners(): Promise<Set<string>> {
  await ensureProviderSecretsTable();
  await ensureUserClientPrefsTable();
  const out = new Set<string>();

  const pu = await db.selectDistinct({ userId: projects.userId }).from(projects);
  for (const r of pu) if (isNonEmptyUid(r.userId)) out.add(r.userId);

  const su = await db.selectDistinct({ userId: providerSecrets.userId }).from(providerSecrets);
  for (const r of su) if (isNonEmptyUid(r.userId)) out.add(r.userId);

  const tu = await db.selectDistinct({ userId: promptTemplates.userId }).from(promptTemplates);
  for (const r of tu) if (isNonEmptyUid(r.userId)) out.add(r.userId);

  const pu2 = await db.selectDistinct({ userId: promptPresets.userId }).from(promptPresets);
  for (const r of pu2) if (isNonEmptyUid(r.userId)) out.add(r.userId!);

  const uu = await db.selectDistinct({ userId: userClientPrefs.userId }).from(userClientPrefs);
  for (const r of uu) if (isNonEmptyUid(r.userId)) out.add(r.userId);

  return out;
}

async function totalLegacyRows(): Promise<number> {
  await ensureProviderSecretsTable();
  await ensureUserClientPrefsTable();
  const [{ pc }] = await db.select({ pc: sql<number>`count(*)` }).from(projects);
  const [{ sc }] = await db.select({ sc: sql<number>`count(*)` }).from(providerSecrets);
  const [{ tc }] = await db.select({ tc: sql<number>`count(*)` }).from(promptTemplates);
  const [{ prc }] = await db.select({ prc: sql<number>`count(*)` }).from(promptPresets);
  const [{ ucc }] = await db.select({ ucc: sql<number>`count(*)` }).from(userClientPrefs);
  return Number(pc) + Number(sc) + Number(tc) + Number(prc) + Number(ucc);
}

/**
 * 本地 SQLite、无登录：删 cookie 后把「单租户」下的项目、密钥与提示词归属迁到当前浏览器 ID。
 * 同时扩展 provider_secrets / prompt_*，避免模型密钥仍挂在旧 ID 上。
 */
export async function reclaimLocalProjectsForUser(currentUserId: string): Promise<void> {
  if (!currentUserId || isReclaimDisabled()) return;

  if (await currentUserHasClaims(currentUserId)) return;

  const owners = await distinctLegacyOwners();
  const now = new Date();

  if (owners.size > 1) return;

  const anyRows = (await totalLegacyRows()) > 0;
  if (!anyRows) return;

  if (owners.size === 1) {
    const prev = [...owners][0];
    await db
      .update(projects)
      .set({ userId: currentUserId, updatedAt: now })
      .where(or(eq(projects.userId, prev), eq(projects.userId, "")));

    await db
      .update(providerSecrets)
      .set({ userId: currentUserId, updatedAt: now })
      .where(or(eq(providerSecrets.userId, prev), eq(providerSecrets.userId, "")));

    await db
      .update(promptTemplates)
      .set({ userId: currentUserId, updatedAt: now })
      .where(or(eq(promptTemplates.userId, prev), eq(promptTemplates.userId, "")));

    await db
      .update(promptPresets)
      .set({ userId: currentUserId })
      .where(or(eq(promptPresets.userId, prev), eq(promptPresets.userId, "")));

    await db
      .update(userClientPrefs)
      .set({ userId: currentUserId, updatedAt: now })
      .where(or(eq(userClientPrefs.userId, prev), eq(userClientPrefs.userId, "")));
    return;
  }

  await db
    .update(projects)
    .set({ userId: currentUserId, updatedAt: now })
    .where(or(eq(projects.userId, ""), sql`trim(${projects.userId}) = ''`));

  await db
    .update(providerSecrets)
    .set({ userId: currentUserId, updatedAt: now })
    .where(or(eq(providerSecrets.userId, ""), sql`trim(${providerSecrets.userId}) = ''`));

  await db
    .update(promptTemplates)
    .set({ userId: currentUserId, updatedAt: now })
    .where(or(eq(promptTemplates.userId, ""), sql`trim(${promptTemplates.userId}) = ''`));

  await db
    .update(promptPresets)
    .set({ userId: currentUserId })
    .where(or(eq(promptPresets.userId, ""), sql`trim(${promptPresets.userId}) = ''`));

  await db
    .update(userClientPrefs)
    .set({ userId: currentUserId, updatedAt: now })
    .where(or(eq(userClientPrefs.userId, ""), sql`trim(${userClientPrefs.userId}) = ''`));
}
