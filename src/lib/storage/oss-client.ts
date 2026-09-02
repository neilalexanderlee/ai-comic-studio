import "server-only";
import OSS from "ali-oss";

/**
 * 阿里云 OSS 客户端（惰性单例）。
 *
 * **未配置四个环境变量时，`isOssEnabled()` 返回 false，整个存储层退回本地磁盘。**
 * 这与计费闸门是同一个原则：自部署用户不该被迫依赖对象存储。
 *
 * bucket 必须是**私有**的：匿名裸 URL 返回 403，对外访问一律走
 * `signatureUrl()` 签发的临时链接（见 artifact-store.ts 的 resolveArtifactUrl）。
 */

/** 数据库里 OSS 引用的前缀，用来和本地路径区分 */
export const OSS_REF_PREFIX = "oss://";

let client: OSS | null = null;

function readConfig() {
  return {
    region: process.env.OSS_REGION?.trim(),
    bucket: process.env.OSS_BUCKET?.trim(),
    accessKeyId: process.env.OSS_ACCESS_KEY_ID?.trim(),
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET?.trim(),
  };
}

export function isOssEnabled(): boolean {
  const c = readConfig();
  return !!(c.region && c.bucket && c.accessKeyId && c.accessKeySecret);
}

export function getOssClient(): OSS {
  if (client) return client;
  const c = readConfig();
  if (!isOssEnabled()) {
    throw new Error(
      "[oss] 未配置 OSS —— 需要 OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET"
    );
  }
  client = new OSS({
    region: c.region!,
    bucket: c.bucket!,
    accessKeyId: c.accessKeyId!,
    accessKeySecret: c.accessKeySecret!,
    secure: true,
  });
  return client;
}

/** 仅供测试：清掉单例，让下次调用重新读环境变量 */
export function __resetOssClientForTests() {
  client = null;
}
