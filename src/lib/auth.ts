/**
 * auth.ts — 轻量账号系统核心工具
 *
 * 认证方式：签名 httpOnly cookie（stateless，无需 sessions 表）
 *   cookie 值 = `{userId}.{hmacSha256(userId, AUTH_SECRET)}`
 *
 * 密码存储：Node.js 内置 crypto.scrypt（无需第三方库）
 *   格式 = `{salt_hex}:{hash_hex}`
 *
 * 环境变量：
 *   AUTH_SECRET — 签名密钥，生产环境务必设置（否则使用默认值，重启后 cookie 仍有效）
 */
import crypto from "node:crypto";

export const AUTH_COOKIE = "ai_comic_auth";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 年

function getSecret(): string {
  return process.env.AUTH_SECRET ?? "ai-comic-builder-dev-secret-please-change";
}

// ─── Cookie 签名 ──────────────────────────────────────────────────────────────

function hmac(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function createCookieValue(userId: string): string {
  return `${userId}.${hmac(userId)}`;
}

/** 验证并解析 cookie 值，返回 userId 或 null */
export function parseCookieValue(raw: string): string | null {
  const dotIdx = raw.indexOf(".");
  if (dotIdx === -1) return null;
  const userId = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const expected = hmac(userId);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }
  return userId || null;
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

/** 生成 Set-Cookie header 字符串（登录/注册时用） */
export function makeSetCookieHeader(userId: string): string {
  const value = createCookieValue(userId);
  return `${AUTH_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`;
}

/** 生成清除 cookie 的 Set-Cookie header（登出时用） */
export function makeClearCookieHeader(): string {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
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
