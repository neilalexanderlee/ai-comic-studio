import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * 数据库里密钥字段的透明加解密（AES-256-GCM）。
 *
 * 解决的问题：`provider_secrets.api_key` / `secret_key` 和
 * `ark_asset_library_credentials` 的 AK/SK 原先是**明文**写进 SQLite 的。
 * 单机自用时问题不大，一旦上公网，一次库文件泄漏 = 所有用户的上游 API Key 全泄。
 *
 * 设计取舍：
 *   - **未设置密钥时保持明文**，只在启动时警告一次。这样本地开发/存量安装不会突然读不出密钥；
 *     生产部署必须设置 `AI_COMIC_SECRETS_VAULT_KEY`（与加密备份文件共用同一个环境变量，
 *     避免用户要管两把钥匙）。
 *   - 密文自带 `enc:v1:` 前缀，**解密时能同时兼容存量明文**，所以不需要数据迁移：
 *     存量明文继续可读，下一次保存该密钥时自动升级成密文。
 *   - 每条记录独立随机 IV，不复用。
 */

const PREFIX = "enc:v1:";
const KDF_SALT = "aicomic-secrets-vault-v1"; // 与 secrets-vault-file.ts 保持一致

let warned = false;

function secretKey(): Buffer | null {
  const pass = process.env.AI_COMIC_SECRETS_VAULT_KEY?.trim();
  if (!pass || pass.length < 8) {
    if (!warned) {
      warned = true;
      console.warn(
        "[secret-crypto] AI_COMIC_SECRETS_VAULT_KEY 未设置（或短于 8 字符）——" +
          " provider 密钥将以明文存库。公网部署前必须设置该环境变量。"
      );
    }
    return null;
  }
  return scryptSync(pass, KDF_SALT, 32);
}

/** 生产环境可用它做启动自检：未启用加密时拒绝启动。 */
export function isSecretEncryptionEnabled(): boolean {
  const pass = process.env.AI_COMIC_SECRETS_VAULT_KEY?.trim();
  return !!pass && pass.length >= 8;
}

/** 加密一个密钥值。未配置密钥时原样返回（明文降级）。空值不加密。 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  const key = secretKey();
  if (!key) return plain;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/**
 * 解密。非 `enc:v1:` 前缀的值视为存量明文原样返回。
 * 解密失败（密钥换了 / 数据损坏）时返回空串而不是抛异常 —— 让调用方走
 * 「未配置密钥」的正常提示路径，而不是把整条生成链路炸掉。
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return stored ?? null;
  if (!stored.startsWith(PREFIX)) return stored; // 存量明文

  const key = secretKey();
  if (!key) {
    console.warn("[secret-crypto] 读到密文但未配置 AI_COMIC_SECRETS_VAULT_KEY，无法解密");
    return "";
  }

  try {
    const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    console.warn(
      "[secret-crypto] 解密失败（密钥是否变更？）：",
      err instanceof Error ? err.message : err
    );
    return "";
  }
}
