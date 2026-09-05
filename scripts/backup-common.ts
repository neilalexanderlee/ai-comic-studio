/**
 * 备份脚本共用的那几件事：时间戳、列举、按保留份数清理。
 *
 * 抽出来是因为已经有第二个备份脚本（数据库 / 本地文档）要用同一套逻辑 ——
 * 两份副本必然漂移，而这类脚本漂移的后果是「以为在备份，其实没有」。
 */
import fs from "node:fs";
import path from "node:path";
import { deleteArtifact } from "@/lib/storage/artifact-store";
import { isOssEnabled, getOssClient, OSS_REF_PREFIX } from "@/lib/storage/oss-client";

export const mb = (b: number) => (b / 1024 / 1024).toFixed(2) + " MB";

/** UTC 时间戳；按字典序排就是按时间排 */
export function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

/**
 * 列出某个前缀下已有的备份，**按新到旧**排序。
 * 只读元数据，不下载内容 —— 下行流量包只有 2 GB/月。
 */
export async function listBackups(prefix: string, suffix: string): Promise<string[]> {
  if (isOssEnabled()) {
    const out: string[] = [];
    let marker: string | undefined;
    do {
      const r = (await getOssClient().list(
        { prefix, "max-keys": 1000, marker } as never,
        {},
      )) as { objects?: { name: string }[]; nextMarker?: string };
      for (const o of r.objects ?? []) {
        if (o.name.endsWith(suffix)) out.push(OSS_REF_PREFIX + o.name);
      }
      marker = r.nextMarker;
    } while (marker);
    return out.sort().reverse();
  }
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const dir = path.resolve(uploadDir, prefix);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => path.join(uploadDir, prefix, f))
    .sort()
    .reverse();
}

/** 只保留最近 keep 份，其余删除。返回被删掉的引用。 */
export async function pruneBackups(
  prefix: string,
  suffix: string,
  keep: number,
  dryRun: boolean,
): Promise<string[]> {
  const existing = await listBackups(prefix, suffix);
  // dry-run 时这一份还没真的写进去，所以少留一个名额来模拟真实结果
  const stale = existing.slice(dryRun ? keep - 1 : keep);
  for (const ref of stale) {
    if (dryRun) console.log(`[dry-run] 将删除 ${ref}`);
    else {
      await deleteArtifact(ref);
      console.log(`已删除过期备份 ${ref}`);
    }
  }
  if (stale.length === 0) {
    console.log(`现有备份 ${existing.length} 份，未超过保留上限 ${keep}`);
  }
  return stale;
}
