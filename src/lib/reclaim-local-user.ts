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
import { eq, or, sql, desc } from "drizzle-orm";

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

/**
 * When multiple orphan user IDs exist, pick the "richest" one —
 * the owner with the most projects + the most recently updated project.
 * This handles the case where the user has cleared browser data multiple times.
 */
async function pickBestOwner(owners: Set<string>): Promise<string | null> {
  if (owners.size === 0) return null;
  if (owners.size === 1) return [...owners][0];

  let best: string | null = null;
  let bestScore = -1;
  let bestUpdated = new Date(0);

  for (const uid of owners) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(eq(projects.userId, uid));
    const projectCount = Number(count);

    // Get most recently updated project for this owner
    const [latest] = await db
      .select({ updatedAt: projects.updatedAt })
      .from(projects)
      .where(eq(projects.userId, uid))
      .orderBy(desc(projects.updatedAt))
      .limit(1);

    const updatedAt = latest?.updatedAt ?? new Date(0);

    // Score: project count wins, then recency as tiebreaker
    if (
      projectCount > bestScore ||
      (projectCount === bestScore && updatedAt > bestUpdated)
    ) {
      best = uid;
      bestScore = projectCount;
      bestUpdated = updatedAt;
    }
  }

  return best;
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
 * 本地 SQLite、无登录：删 cookie 后把数据归属迁到当前浏览器 ID。
 * - 只有 1 个旧 owner：直接迁移
 * - 有多个旧 owner（多次清数据产生的孤立 UUID）：选项目数最多、最近更新的那个迁移
 * - 所有旧 owner 的数据合并到 currentUserId 后旧行被覆盖（UPDATE … WHERE userId = prev）
 */
export async function reclaimLocalProjectsForUser(currentUserId: string): Promise<void> {
  if (!currentUserId || isReclaimDisabled()) return;

  if (await currentUserHasClaims(currentUserId)) return;

  const owners = await distinctLegacyOwners();
  if (owners.size === 0) return;

  const now = new Date();

  // Pick the single best owner to reclaim from; for single-owner this is identical to before
  const prev = await pickBestOwner(owners);
  if (!prev) return;

  console.log(`[Reclaim] Reassigning data from ${prev} → ${currentUserId} (${owners.size} orphan owner(s) found)`);

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
}
