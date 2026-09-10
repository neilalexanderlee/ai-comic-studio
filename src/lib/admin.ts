import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * 管理员概念 —— 平台统一 Key 模式的地基。
 *
 ## 三级权限
 *
 * | 角色 | 管理后台（邀请码/用户/用量） | 模型 Key（查看·配置） | 说明 |
 * |---|---|---|---|
 * | `owner` | ✅ | ✅ | 平台 Key 挂在他名下 |
 * | `admin` | ✅ | ❌ | 运营：拉人、看用量、停用账号 |
 * | `user`  | ❌ | ❌ | 只能用 |
 *
 * **拆开的理由**：改造前 `isAdminUser` 一个函数同时回答了两个不同的问题 ——
 * 「能不能进管理后台」和「能不能碰模型 Key」。合在一起意味着「想让人帮忙拉人，
 * 就得把上游密钥一并交出去」，这正是最不该捆绑的两件事。
 *
 * 所以现在是两个函数，**任何新增的权限判断都必须先想清楚问的是哪一个**：
 *   · `isPlatformStaff()` —— 管理后台准入（owner + admin）
 *   · `isKeyOwner()`      —— 模型 Key 准入（仅 owner）
 *
 * owner 的 `provider_secrets` 就是**平台 Key**：普通用户没自己配 Key 时，
 * 生成链路 fallback 到这一份（见 `provider-secrets.ts` 的 `resolveOne`）。
 *
 * ## 第一个管理员怎么产生
 *
 * 两条规则，覆盖两种完全不同的库：
 *
 * | 场景 | 规则 |
 * |---|---|
 * | **已有库**（线上/本地都已经有用户） | `ADMIN_USERNAMES=neil,alice` 幂等授予 **owner** |
 * | **全新空库**（自部署用户） | 未设该变量且库里零用户时，第一个注册的人自动是 **owner** |
 *
 * ⚠️ `ADMIN_USERNAMES` 授予的是 **owner** 而不是 admin —— 这个变量在三级权限之前
 * 就存在，当时它给的是全权。改成只给运营权限会让线上唯一的管理员突然配不了 Key，
 * 而报错只会是「未配置 Key」，完全看不出是降权造成的。
 * 运营 admin 由 owner 在管理后台里指派，不走环境变量。
 *
 * 为什么不只用「全库第一个用户自动 admin」：**它在已有库上永远不会触发**。
 * 要让它生效就得写一条「把最早创建的用户设为 admin」的迁移 —— 把策略判断
 * 固化进迁移，且在别人的库上可能授权给错误的账号。
 *
 * 为什么环境变量**只授予不撤销**：把名字从列表里删掉就自动降级，会造成
 * 「改了个变量把自己踢出去且看不出为什么」。撤销走管理端显式操作。
 * 它同时也是逃生通道：丢了管理员权限时改一行环境变量重启就能拿回来。
 */

export type Role = "owner" | "admin" | "user";

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

  const toPromote = rows.filter((r) => r.role !== "owner").map((r) => r.id);
  if (toPromote.length === 0) return;

  await db.update(users).set({ role: "owner" }).where(inArray(users.id, toPromote));
  invalidateAdminCaches();
  console.log(
    `[admin] 已按 ADMIN_USERNAMES 授予 owner：${rows
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
export async function roleForNewUser(): Promise<Role> {
  if (getAdminUsernames().length > 0) return "user";
  return (await hasAnyUser()) ? "user" : "owner";
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

/**
 * 能不能进**管理后台**（邀请码 / 用户 / 用量看板）。owner 与 admin 都可以。
 *
 * ⚠️ 这**不**代表能碰模型 Key —— 那要问 `isKeyOwner`。
 */
export async function isPlatformStaff(userId: string): Promise<boolean> {
  const role = (await readFlags(userId))?.role;
  return role === "owner" || role === "admin";
}

/**
 * 能不能**查看和配置模型 Key**，以及在平台模式下继续用自己的 Key（BYOK 例外）。
 * **只有 owner。**
 *
 * 运营 admin 走到这里一律 false：让他帮忙拉人、看用量，不等于把上游密钥交给他。
 */
export async function isKeyOwner(userId: string): Promise<boolean> {
  return (await readFlags(userId))?.role === "owner";
}

/** 当前角色，取不到（匿名指纹用户）时按 user 处理 */
export async function roleOf(userId: string): Promise<Role> {
  const role = (await readFlags(userId))?.role;
  return role === "owner" || role === "admin" ? role : "user";
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
 * 规则：`PLATFORM_KEY_USERNAME` 指定 > 最早创建的、未停用的 **owner**。
 * 运营 admin 名下没有密钥，选中他会让全站解析不到 Key，所以这里只认 owner ——
 * **指定的那个也要过这一关**，见下面的 role 限定。
 */
export async function getPlatformKeyOwnerId(): Promise<string | null> {
  if (platformOwnerCache && Date.now() - platformOwnerCache.at < CACHE_TTL_MS) {
    return platformOwnerCache.userId;
  }

  const earliestOwner = async (): Promise<string | null> => {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "owner"), ne(users.status, "disabled")))
      .orderBy(asc(users.createdAt))
      .limit(1);
    return row?.id ?? null;
  };

  const pinned = process.env.PLATFORM_KEY_USERNAME?.trim();
  let userId: string | null = null;

  if (pinned) {
    // ⚠️ 必须同时限定 role='owner'。只按用户名找会选中一个**无权配置 Key** 的账号
    // （`isKeyOwner` 只认 owner，运营 admin 的设置页根本没有密钥配置区），
    // 于是它名下永远不会有密钥 —— 症状是全站解析不到 Key，而报错只会是
    // 「未配置 Key」，完全看不出是这个环境变量指错了人。
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.username, pinned), eq(users.role, "owner"), ne(users.status, "disabled"))
      )
      .limit(1);
    userId = row?.id ?? null;

    if (!userId) {
      // 回落到正常查找，而不是返回 null。与「认不出来的环境变量值回落到默认值
      // 而不是 0」同一条原则：配错的失效方式应当是「没按你指定的那个来」，
      // 不是「谁都用不了」。
      userId = await earliestOwner();
      console.warn(
        `[admin] PLATFORM_KEY_USERNAME="${pinned}" 未匹配到未停用的 owner 账号，` +
          `已回落到最早创建的 owner${userId ? "" : "（库里也没有可用的 owner）"}。` +
          `请确认该用户名存在、未被停用、且角色是 owner —— 运营 admin 名下没有密钥。`
      );
    }
  } else {
    userId = await earliestOwner();
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
