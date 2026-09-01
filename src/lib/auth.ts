/**
 * auth.ts — 轻量账号系统核心工具
 *
 * 认证方式：签名 httpOnly cookie（stateless，无需 sessions 表）
 *   cookie 值 = `v2.{userId}.{issuedAtSec}.{tokenVersion}.{hmac}`
 *
 * v1 格式（`{userId}.{hmac}`）已废弃：它只签了 userId，**不含过期时间也不含版本号**，
 * 意味着签发出去的 cookie 永久有效 —— 无法登出所有设备、改密码不会让旧 cookie 失效，
 * 唯一的撤销手段是改 AUTH_SECRET（会踢掉所有人）。v2 加了两样东西：
 *   - `issuedAtSec`：签发时间，配合 COOKIE_MAX_AGE 做服务端过期校验（不依赖浏览器是否删 cookie）
 *   - `tokenVersion`：对应 `users.token_version`，改密码/主动登出所有设备时自增即可批量失效
 *
 * ⚠️ 版本号的**校验需要读库**，而 `parseCookieValue` 是同步的（`getUserIdFromRequest`
 * 有 90+ 个调用点，改成异步是一次大重构）。所以：
 *   - 同步路径（`getAuthUserIdFromRequest`）只验签名和过期
 *   - 需要强撤销语义的地方用异步的 `getFreshAuthUserId()`，它会额外比对 DB 里的 token_version
 * 二期把认证换成正式方案时，这个分裂应当一并消除。
 *
 * 密码存储：Node.js 内置 crypto.scrypt（无需第三方库）
 *   格式 = `{salt_hex}:{hash_hex}`
 *
 * 环境变量：
 *   AUTH_SECRET — 签名密钥，生产环境务必设置（否则使用默认值，重启后 cookie 仍有效）
 */
import crypto from "node:crypto";

export const AUTH_COOKIE = "ai_comic_auth";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 天（原为 1 年）
const COOKIE_VERSION = "v2";

function getSecret(): string {
  const secret = process.env.AUTH_SECRET ?? "ai-comic-builder-dev-secret-please-change";
  if (
    process.env.NODE_ENV === "production" &&
    secret === "ai-comic-builder-dev-secret-please-change"
  ) {
    throw new Error(
      "[auth] AUTH_SECRET must be set in production. " +
        "Using the default dev secret is a security risk."
    );
  }
  return secret;
}

// ─── Cookie 签名 ──────────────────────────────────────────────────────────────

function hmac(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function createCookieValue(userId: string, tokenVersion = 0): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${COOKIE_VERSION}.${userId}.${issuedAt}.${tokenVersion}`;
  return `${payload}.${hmac(payload)}`;
}

/** 已解析且验签通过的 cookie 内容 */
export interface ParsedAuthCookie {
  userId: string;
  issuedAt: number;
  tokenVersion: number;
}

/**
 * 验证并解析 cookie，返回完整载荷或 null。
 * 校验项：版本前缀 → 签名（timing-safe）→ 过期时间。
 * v1 旧格式一律判为无效（无过期时间，不能继续接受），用户需要重新登录一次。
 */
export function parseAuthCookie(raw: string): ParsedAuthCookie | null {
  const parts = raw.split(".");
  if (parts.length !== 5) return null;
  const [ver, userId, issuedAtRaw, tokenVersionRaw, sig] = parts;
  if (ver !== COOKIE_VERSION || !userId) return null;

  const payload = `${ver}.${userId}.${issuedAtRaw}.${tokenVersionRaw}`;
  const expected = hmac(payload);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }

  const issuedAt = Number(issuedAtRaw);
  const tokenVersion = Number(tokenVersionRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(tokenVersion)) return null;

  // 服务端过期校验：不依赖浏览器是否遵守 Max-Age
  if (Math.floor(Date.now() / 1000) - issuedAt > COOKIE_MAX_AGE) return null;

  return { userId, issuedAt, tokenVersion };
}

/** 验证并解析 cookie 值，返回 userId 或 null */
export function parseCookieValue(raw: string): string | null {
  return parseAuthCookie(raw)?.userId ?? null;
}

/** 从 Request 的 Cookie header 中读取并验证 userId */
export function getAuthUserIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${AUTH_COOKIE}=`)) {
      const value = trimmed.slice(AUTH_COOKIE.length + 1);
      return parseCookieValue(value);
    }
  }
  return null;
}

/**
 * 生产环境加 `Secure`（只允许 HTTPS 传输）。
 * 开发环境走 http://localhost，加了 Secure 浏览器会直接丢弃 cookie，所以按环境区分。
 */
function secureAttr(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

/** 生成 Set-Cookie header 字符串（登录/注册时用） */
export function makeSetCookieHeader(userId: string, tokenVersion = 0): string {
  const value = createCookieValue(userId, tokenVersion);
  return `${AUTH_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secureAttr()}`;
}

/** 生成清除 cookie 的 Set-Cookie header（登出时用） */
export function makeClearCookieHeader(): string {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureAttr()}`;
}

// ─── 密码哈希 ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  try {
    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      });
    });
    return crypto.timingSafeEqual(Buffer.from(hashHex, "hex"), derived);
  } catch {
    return false;
  }
}

// ─── 会话版本号（强撤销） ──────────────────────────────────────────────────────

/**
 * 异步校验：签名 + 过期（同步部分）之外，再比对 DB 里的 `users.token_version`。
 * 用于需要「改了密码就立刻失效」语义的地方。同步的 `getAuthUserIdFromRequest`
 * 做不到这一点（它不能读库），两者的差别见文件头注释。
 */
export async function getFreshAuthUserId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  let raw: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${AUTH_COOKIE}=`)) {
      raw = trimmed.slice(AUTH_COOKIE.length + 1);
      break;
    }
  }
  if (!raw) return null;

  const parsed = parseAuthCookie(raw);
  if (!parsed) return null;

  const { db } = await import("@/lib/db");
  const { users } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [user] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, parsed.userId))
    .limit(1);

  if (!user) return null;
  if (user.tokenVersion !== parsed.tokenVersion) return null; // 已被撤销
  return parsed.userId;
}

/**
 * 自增用户的会话版本号 —— 使该用户此前签发的所有 cookie 立即失效。
 * 改密码、「登出所有设备」、疑似账号泄露时调用。
 */
export async function bumpUserTokenVersion(userId: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const { users } = await import("@/lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
}
