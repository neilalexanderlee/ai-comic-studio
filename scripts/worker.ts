/**
 * 独立 worker 进程入口。
 *
 * 与 web 进程共享同一个数据库和 uploads 目录 —— 所以它必须跑在**同一台机器**上
 * （Docker Compose 两个 service 共享 volume 也算）。SQLite 的 WAL 支持同机多进程，
 * 但不支持跨网络文件系统；真要把 worker 挪到另一台机器，得先迁到 PostgreSQL。
 *
 * ⚠️ 必须带 `--conditions=react-server` 启动（`pnpm worker` 已经带上）。
 * 生成链路上大量模块 `import "server-only"`，那个包在 Next 打包器下会解析到一个空模块，
 * 但在**纯 Node** 下解析到默认入口 —— 而默认入口就是一句 `throw`。
 * 语义上我们本来就在服务端，所以走 react-server 条件才是对的解析结果。
 *
 * 用法：
 *   pnpm worker                     # 本地
 *   WORKER_IN_WEB=0 docker compose up  # web 只处理请求，ffmpeg 全在这边
 */
import { bootstrap } from "../src/lib/bootstrap";
import { startWorker, stopWorker } from "../src/lib/task-queue";

async function main() {
  // bootstrap 里已经包含迁移、provider 初始化、handler 注册。
  // 它自带 WORKER_IN_WEB 判断，所以这里显式再起一次 —— 独立进程无论如何都要跑 worker。
  process.env.WORKER_IN_WEB = "0";
  await bootstrap();
  startWorker();
  console.log("[Worker] 独立进程已就绪");

  // 收到停止信号时先停止认领新任务。手上正在跑的那条会自然结束；
  // 真被强杀了也没关系 —— 服务端的回收机制会把它捡回来重排。
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`[Worker] 收到 ${sig}，停止认领新任务`);
      stopWorker();
      setTimeout(() => process.exit(0), 1000);
    });
  }
}

main().catch((err) => {
  console.error("[Worker] 启动失败:", err);
  process.exit(1);
});
