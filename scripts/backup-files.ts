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
 * ## 排除哪些、为什么
 *
 * 见下面 `EXCLUDE` 的注释。一句话：**备份要装的是"丢了就再也没有"的东西** ——
 * 厂商 PDF 随时能重下、视频是渲染产物，两者都不属于这一类，
 * 而它们的体积会让这个每次部署都要跑的步骤变得不可靠。
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
/**
 * 排除项。判据只有一条：**丢了是不是就再也没有了**。
 *
 * · `docs/APIs` —— 65 MB 厂商 API PDF，随时能重新下载
 * · 视频 —— 渲染产物（例如 docs/ 里的使用教程 mp4），源工程还在
 *
 * ⚠️ 视频这条是 2026-09-11 加的。理由是**体积本身**：教程 mp4 让整包从 0.3 MB
 * 涨到 14.42 MB，留 30 份就是 432 MB，与"整包 0.3 MB、30 份 10 MB"的设计意图差两个量级。
 *
 * ⚠️ **不要把它和上传超时混为一谈**（我当时混了）：那几次 `ResponseTimeoutError`
 * 看起来像是"包太大传不完"，放宽超时到 10 分钟也确实没救回来 —— 但排除 mp4、
 * 包缩到 0.52 MB 之后**照样 60 秒超时**（= 9 KB/s，任何体积都传不完）。
 * 也就是说那是本机 VPN 的老问题（见 CLAUDE.md 陷阱表里"偶发 OSS 上传超时"那条），
 * 与体积无关。**同一个报错可以有两个完全独立的原因，修掉一个不代表另一个也没了。**
 *
 * ⚠️ **被排除的视频因此没有异地备份。** 要备份它就单独传一次，
 * 不要为了省事把它塞回 `docs/` —— 那会让每次部署的收尾步骤重新开始失败。
 */
const EXCLUDE = ["docs/APIs", "*.mp4", "*.mov"];

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
