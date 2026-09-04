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
 *
 * ## 为什么是两个客户端
 *
 * `OSS_INTERNAL=1` 时，**服务端自己收发数据**走内网端点
 * （`oss-<region>-internal.aliyuncs.com`）—— 同地域内网流量不计费，而公网出流量要钱。
 * 这对本项目是关键的一笔：一次剧集导出要拉几十个源片，实测一集 125MB，
 * 走公网几次就能打穿流量包（2026-09-02 已经因此欠费停服过一次）。
 *
 * ⚠️ **但签名 URL 绝不能用内网域名。** 签出来的地址要交给两类**不在 VPC 里**的消费者：
 *   - 浏览器（`/api/uploads/_oss/<key>` 302 跳过去）
 *   - 上游模型服务（Seedance 拉参考图/参考视频）
 * 内网域名在它们那里根本解析不到。所以签名固定走公网客户端。
 *
 * 这个错误一旦犯下会**非常难查**：服务器上一切正常（数据收发都走内网），
 * 只有浏览器和上游拿到一个连不上的地址，而且是在别人的机器上失败的。
 */

/** 数据库里 OSS 引用的前缀，用来和本地路径区分 */
export const OSS_REF_PREFIX = "oss://";

let dataClient: OSS | null = null;
let signingClient: OSS | null = null;

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

/**
 * 服务端数据收发是否走内网端点。
 *
 * 只有跑在**与 bucket 同地域**的阿里云 ECS 上才该开 —— 别处开了会直接连不上
 * （内网域名在公网无法解析），而不是悄悄降级。这是刻意的：连不上会立刻报错，
 * 比"以为省了流量其实没省"好排查得多。
 */
export function isOssInternal(): boolean {
  return process.env.OSS_INTERNAL === "1";
}

function build(internal: boolean): OSS {
  const c = readConfig();
  if (!isOssEnabled()) {
    throw new Error(
      "[oss] 未配置 OSS —— 需要 OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET"
    );
  }
  return new OSS({
    region: c.region!,
    bucket: c.bucket!,
    accessKeyId: c.accessKeyId!,
    accessKeySecret: c.accessKeySecret!,
    secure: true,
    // ali-oss 自己会把 region 拼成 oss-<region>-internal.aliyuncs.com
    internal,
  });
}

/**
 * 数据面客户端：put / get / head / delete。
 * `OSS_INTERNAL=1` 时走内网 —— 这些才是真正产生流量的调用。
 */
export function getOssClient(): OSS {
  if (!dataClient) dataClient = build(isOssInternal());
  return dataClient;
}

/**
 * 签名专用客户端：**永远走公网端点**。
 * 签出来的地址要给浏览器和上游模型服务用，它们不在 VPC 里。
 */
export function getOssSigningClient(): OSS {
  if (!signingClient) signingClient = isOssInternal() ? build(false) : getOssClient();
  return signingClient;
}

/** 仅供测试：清掉单例，让下次调用重新读环境变量 */
export function __resetOssClientForTests() {
  dataClient = null;
  signingClient = null;
}
