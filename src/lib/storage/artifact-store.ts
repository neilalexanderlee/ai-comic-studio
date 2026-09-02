import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * 生成产物的存储抽象。
 *
 * ## 为什么需要它
 *
 * 二期要把 1.1GB 的生成物从本地磁盘迁到阿里云 OSS，并且 Seedance 2.5 的参考视频
 * **只接受公网 URL 或 asset:// 素材 ID，不支持 base64** —— 白模预演功能因此被卡住。
 * 但 32 个写盘点直接调 `fs.writeFileSync(path.join(uploadDir, ...))`，
 * 一次性全改风险太高。
 *
 * ## 关键设计：本地与 OSS 共存，而非一次性切换
 *
 * 数据库里存的是一个**存储引用（storage ref）**字符串，两种形态：
 *
 *   - 本地：`./uploads/bgm/xxx.wav`   —— 与改造前**完全一致**，存量数据零改动
 *   - OSS ：`oss://bgm/xxx.wav`       —— 新增前缀，一眼可辨
 *
 * `resolveArtifactUrl()` / `readArtifact()` / `deleteArtifact()` 同时认这两种。
 * 于是：
 *   - 未配置 OSS 时行为与改造前完全一致（自部署用户无感）
 *   - 配置了 OSS 后新产物走 OSS，**存量本地文件继续可读**，不需要停机迁移
 *   - 迁移可以按目录分批做，任何一步中断都不会让系统处于半坏状态
 *
 * 这是刻意避免「半途而废的存储层重构」—— 那种状态下路径写入和读取不一致，
 * 症状是「文件明明生成了但界面显示缺失」，极难排查。
 */

import { getOssClient, isOssEnabled, OSS_REF_PREFIX } from "./oss-client";

const LOCAL_ROOT = process.env.UPLOAD_DIR || "./uploads";

/** 产物分类，对应存储中的一级目录 */
export type ArtifactCategory =
  | "frames"
  | "videos"
  | "images"
  | "bgm"
  | "characters"
  | "renders"
  | "style-refs"
  | "previz";

/** 判断一个存储引用是否指向 OSS */
export function isOssRef(ref: string): boolean {
  return ref.startsWith(OSS_REF_PREFIX);
}

/** 从 OSS 引用中取出 object key（`oss://bgm/x.wav` → `bgm/x.wav`） */
export function ossKeyOf(ref: string): string {
  return ref.slice(OSS_REF_PREFIX.length);
}

/**
 * 保存一个产物，返回**存储引用**（写进数据库的那个字符串）。
 *
 * @param relPath 相对于存储根的路径，如 `bgm/abc.wav`；
 *                也可以是更深的层级，如 `projects/<id>/<version>/videos/x.mp4`
 */
export async function saveArtifact(relPath: string, data: Buffer): Promise<string> {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (isOssEnabled()) {
    const client = getOssClient();
    await client.put(normalized, data);
    return `${OSS_REF_PREFIX}${normalized}`;
  }

  const dest = path.join(LOCAL_ROOT, normalized);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
  // 返回**实际写入路径**，而不是硬编码的 `./uploads/...`。
  // UPLOAD_DIR 可以被改（Docker 里是 /app/uploads），硬编码会让引用指向不存在的位置。
  // 与 download-with-retry.ts 的既有做法一致；存量数据中 `./uploads/x` 和 `uploads/x`
  // 两种形态本来就并存，读取与 URL 解析都能处理。
  return dest;
}

/** 读取一个产物。同时支持本地路径与 `oss://` 引用。 */
export async function readArtifact(ref: string): Promise<Buffer> {
  if (isOssRef(ref)) {
    const client = getOssClient();
    const res = await client.get(ossKeyOf(ref));
    return res.content as Buffer;
  }
  return fs.readFileSync(ref);
}

/** 产物是否存在。本地查磁盘，OSS 查 head。 */
export async function artifactExists(ref: string | null | undefined): Promise<boolean> {
  if (!ref) return false;
  if (isOssRef(ref)) {
    try {
      await getOssClient().head(ossKeyOf(ref));
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(ref);
}

/** 删除产物。不存在时静默返回（幂等）。 */
export async function deleteArtifact(ref: string | null | undefined): Promise<void> {
  if (!ref) return;
  try {
    if (isOssRef(ref)) {
      await getOssClient().delete(ossKeyOf(ref));
    } else {
      fs.unlinkSync(ref);
    }
  } catch {
    /* 已经没了，无所谓 */
  }
}

/** 签名 URL 默认有效期（秒）。够浏览器播放/下载一次，又不至于被长期转发。 */
export const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * 把存储引用解析成浏览器可访问的 URL。
 *
 * - OSS  → **签名 URL**（bucket 是私有的，裸 URL 会 403，已实测验证）
 * - 本地 → 走 `/api/uploads/[...path]`，与改造前一致（该路由有鉴权）
 */
export function resolveArtifactUrl(ref: string): string {
  if (isOssRef(ref)) {
    return getOssClient().signatureUrl(ossKeyOf(ref), { expires: SIGNED_URL_TTL_SECONDS });
  }
  const normalized = ref.replace(/\\/g, "/");
  return `/api/uploads/${normalized.replace(/^.*uploads\//, "")}`;
}
