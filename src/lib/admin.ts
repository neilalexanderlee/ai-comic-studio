import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * 管理员概念 —— 平台统一 Key 模式的地基。
 *
 * ## 管理员是什么
 *
 * 管理员的 `provider_secrets` 就是**平台 Key**：普通用户没自己配 Key 时，
 * 生成链路 fallback 到这一份（见 `provider-secrets.ts` 的 `resolveOne`）。
 * 这解决了「用户既要买积分又要自带 Key」这个矛盾。
 *
 * ## 第一个管理员怎么产生
 *
 * 两条规则，覆盖两种完全不同的库：
 *
 * | 场景 | 规则 |
 * |---|---|
 * | **已有库**（线上/本地都已经有用户） | `ADMIN_USERNAMES=neil,alice` 幂等授予 |
 * | **全新空库**（自部署用户） | 未设该变量且库里零用户时，第一个注册的人自动是 admin |
 *
 * 为什么不只用「全库第一个用户自动 admin」：**它在已有库上永远不会触发**。
 * 要让它生效就得写一条「把最早创建的用户设为 admin」的迁移 —— 把策略判断
 * 固化进迁移，且在别人的库上可能授权给错误的账号。
 *
 * 为什么环境变量**只授予不撤销**：把名字从列表里删掉就自动降级，会造成
 * 「改了个变量把自己踢出去且看不出为什么」。撤销走管理端显式操作。
 * 它同时也是逃生通道：丢了管理员权限时改一行环境变量重启就能拿回来。
 */

/** `ADMIN_USERNAMES`（逗号分隔）。未设置时为空数组 —— 自部署走空库首用户那条规则。 */
export function getAdminUsernames(): string[] {
  return (process.env.ADMIN_USERNAMES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 把 `ADMIN_USERNAMES` 里的用户幂等提升为管理员。
 *
 * 在 bootstrap 和每次登录成功后各调一次：bootstrap 覆盖「改了变量重启」，
 * 登录覆盖「变量里的人还没注册、注册完才第一次登录」。
 */
export async function ensureBootstrapAdmins(): Promise<void> {
  const names = getAdminUsernames();
  if (names.length === 0) return;

  const rows = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(inArray(users.username, names));

  const toPromote = rows.filter((r) => r.role !== "admin").map((r) => r.id);
  if (toPromote.length === 0) return;

  await db.update(users).set({ role: "admin" }).where(inArray(users.id, toPromote));
  invalidateAdminCaches();
  console.log(
    `[admin] 已按 ADMIN_USERNAMES 授予管理员：${rows
      .filter((r) => toPromote.includes(r.id))
      .map((r) => r.username)
      .join(", ")}`
  );
}

/**
 * 库里是否已经有账号。
 *
 * ⚠️ 邀请制的**引导死锁**就靠它解开：空库 + `REGISTRATION_MODE=invite` 时，
 * 注册要邀请码 → 码只能由管理员生成 → 管理员只能由注册产生 → 谁都进不去。
 * 自部署用户第一天就设 invite 会直接卡死，且界面上只会显示「请填写邀请码」，
 * 完全看不出是个死锁。
 *
 * 所以「库里一个用户都没有」时豁免邀请码要求 —— 那一刻**不可能**有人发过码，
 * 这个要求本身就是空的。豁免窗口只存在于第一个账号创建之前。
 */
export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return !!row;
}

/**
 * 注册时决定新用户的角色。
 *
 * 只有「库里一个用户都没有」且「没设 ADMIN_USERNAMES」时才自动给 admin ——
 * 也就是自部署用户第一次打开的那一刻。已有库永远走不到这条。
 */
export async function roleForNewUser(): Promise<"admin" | "user"> {
  if (getAdminUsernames().length > 0) return "user";
  return (await hasAnyUser()) ? "user" : "admin";
}

// ─── 角色 / 停用状态查询（带短 TTL 缓存） ─────────────────────────────────────

/**
 * 这两个缓存是为了让「每个受保护路由都检查一次停用状态」不产生每请求一次查库。
 * TTL 30 秒：停用一个账号最多 30 秒后全站生效，而配套的 `bumpUserTokenVersion`
 * 会让走异步强校验的路径立刻掉线。对「切断正在烧钱的账号」这个诉求足够快。
 */
const CACHE_TTL_MS = 30_000;

/**
 * 缓存条目上限。
 *
 * ⚠️ **这个 Map 的 key 是 `getUserIdFromRequest` 的结果，里面包含匿名指纹用户** ——
 * 公网部署下每个访客都会产生一个新 id，只增不减就是一条内存耗尽的路径
 * （而且是被外部请求驱动的，等于把它变成一个可以远程触发的资源耗尽入口）。
 * `auth-rate-limit.ts` 里的 `MAX_ENTRIES` 是同一个道理，这里沿用同一套做法：
 * **宁可短暂失去缓存（退化成每次查库，仍然正确），也不能让它无上限增长。**
 */
const MAX_CACHE_ENTRIES = 10_000;

interface UserFlags {
  role: string;
  status: string;
}

let flagsCache = new Map<string, { at: number; flags: UserFlags | null }>();

/** 角色/停用状态变更后调用，避免最长 30 秒的观感延迟 */
export function invalidateAdminCaches(): void {
  flagsCache = new Map();
  platformOwnerCache = null;
}

async function readFlags(userId: string): Promise<UserFlags | null> {
  if (!userId) return null;
  const hit = flagsCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.flags;

  const [row] = await db
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // 匿名指纹用户在 users 表里没有行 —— 那不是「被停用」，是「没有账号」，
  // 单机匿名使用必须继续可用，所以 null 一律按「正常的非管理员」处理。
  const flags = row ? { role: row.role, status: row.status } : null;
  if (flagsCache.size >= MAX_CACHE_ENTRIES) flagsCache.clear();
  flagsCache.set(userId, { at: Date.now(), flags });
  return flags;
}

export async function isAdminUser(userId: string): Promise<boolean> {
  return (await readFlags(userId))?.role === "admin";
}

export async function isUserDisabled(userId: string): Promise<boolean> {
  return (await readFlags(userId))?.status === "disabled";
}

// ─── 平台 Key 的归属人 ────────────────────────────────────────────────────────

let platformOwnerCache: { at: number; userId: string | null } | null = null;

/**
 * 平台 Key 属于**哪一个**管理员。
 *
 * 必须是确定的单一归属人，不能「在所有管理员里碰运气找一个有 Key 的」：
 * 端点和密钥必须来自同一个人（见 `provider-secrets.ts` 里的安全不变量），
 * 归属人在请求之间飘移会让同一个 providerId 时而解析得到、时而解析不到。
 *
 * 规则：`PLATFORM_KEY_USERNAME` 指定 > 最早创建的、未停用的管理员。
 */
export async function getPlatformKeyOwnerId(): Promise<string | null> {
  if (platformOwnerCache && Date.now() - platformOwnerCache.at < CACHE_TTL_MS) {
    return platformOwnerCache.userId;
  }

  const pinned = process.env.PLATFORM_KEY_USERNAME?.trim();
  let userId: string | null = null;

  if (pinned) {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, pinned), ne(users.status, "disabled")))
      .limit(1);
    userId = row?.id ?? null;
  } else {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.status, "disabled")))
      .orderBy(asc(users.createdAt))
      .limit(1);
    userId = row?.id ?? null;
  }

  platformOwnerCache = { at: Date.now(), userId };
  return userId;
}

/**
 * 普通用户还能不能自己配 Key（BYOK）。
 *
 * **默认开** —— 自部署开源用户全靠 BYOK，关掉等于废掉半个产品形态。
 * 托管部署设 `ALLOW_USER_PROVIDERS=0`：非管理员的设置页不再显示「配置模型/API」，
 * 也不接受写入 provider 密钥，统一用平台 Key。管理员不受该开关影响。
 */
export function allowUserProviders(): boolean {
  return process.env.ALLOW_USER_PROVIDERS !== "0";
}

/** 仅供测试：清掉全部缓存 */
export function __resetAdminCachesForTests(): void {
  invalidateAdminCaches();
}
