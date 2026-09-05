/**
 * 本地文档与部署脚本的备份 —— 把 `docs/` 与 `deploy/` 打包传到产物存储。
 *
 *   pnpm docs:backup
 *   pnpm docs:backup --dry-run
 *   pnpm docs:backup --keep 20
 *
 * ## 为什么这两个目录需要单独备份
 *
 * 它们都在 `.gitignore` 里（`docs/` 含外部客户资料，`deploy/` 是我们自家的服务器拓扑，
 * 刻意不进公开仓库），于是出现一个尴尬的局面：
 * **代码在 GitHub、数据在 OSS，唯独这两个目录只有一份，就在这台笔记本上。**
 * 而其中一份正是「服务器没了怎么恢复」的操作手册。
 *
 * ## 为什么从本机跑，而不是挂在服务器的 cron 上
 *
 * 服务器上那份是 `deploy-ecs.sh` rsync 过去的**上次部署时的快照**；
 * 真正在改的是本机这一份。挂服务器 cron 只会每天忠实地备份一份过期副本。
 * 所以这个脚本跟着部署走（`deploy-ecs.sh` 结尾会调它），也可以随时手动跑。
 *
 * ## 为什么排除 docs/APIs
 *
 * 那是 65 MB 的厂商 API PDF（火山方舟 / Kling 官方文档），**不是我们写的、随时能重新下载**。
 * 排除之后整包只有 ~0.3 MB，留 30 份也就 10 MB 左右。
 * 备份要装的是"丢了就再也没有"的东西。
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { saveArtifactFromFile } from "@/lib/storage/artifact-store";
import { mb, stamp, pruneBackups } from "./backup-common";

const PREFIX = "backups/";
const SUFFIX = ".files.tgz";

/** 要备份的目录（相对仓库根） */
const INCLUDE = ["docs", "deploy"];
/** 排除：厂商 PDF 体积大且可重新下载 */
const EXCLUDE = ["docs/APIs"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const KEEP = Math.max(1, Number(arg("--keep") ?? 30));
const DRY = process.argv.includes("--dry-run");

async function main() {
  const present = INCLUDE.filter((d) => fs.existsSync(d));
  if (present.length === 0) {
    console.log("没有可备份的目录（docs/ 与 deploy/ 都不存在），跳过");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aicomic-files-"));
  const archive = path.join(tmpDir, "files.tgz");
  try {
    execFileSync("tar", [
      "czf", archive,
      ...EXCLUDE.flatMap((e) => ["--exclude", e]),
      ...present,
    ]);
    const size = fs.statSync(archive).size;
    console.log(`打包 ${present.join(" + ")}（排除 ${EXCLUDE.join(", ")}）→ ${mb(size)}`);

    const key = `${PREFIX}files-${stamp()}${SUFFIX}`;
    if (DRY) {
      console.log(`[dry-run] 将写入 ${key}`);
    } else {
      console.log(`已写入 ${await saveArtifactFromFile(key, archive)}`);
    }

    await pruneBackups(PREFIX, SUFFIX, KEEP, DRY);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("文档备份失败：", err);
  process.exit(1);
});
