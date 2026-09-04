import { runMigrations } from "@/lib/db";
import { pruneStalePromptOverrides } from "@/lib/ai/prompts/prune-stale-prompt-overrides";
import { initializeProviders } from "@/lib/ai/setup";
import { registerPipelineHandlers } from "@/lib/pipeline";
import { startWorker, shouldRunWorkerInWeb } from "@/lib/task-queue";
import { setupProxy } from "@/lib/proxy-setup";

let bootstrapped = false;

export async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  // ① Proxy must be configured FIRST so every subsequent fetch() inherits it
  await setupProxy();

  console.log("[Bootstrap] Running database migrations...");
  runMigrations();

  try {
    const pruned = await pruneStalePromptOverrides();
    if (pruned.deleted > 0) {
      console.log(
        `[Bootstrap] Pruned ${pruned.deleted} stale prompt_templates row(s)`
      );
    }
  } catch (err) {
    console.warn("[Bootstrap] prompt_templates prune skipped:", err);
  }

  console.log("[Bootstrap] Initializing AI providers...");
  initializeProviders();

  console.log("[Bootstrap] Registering pipeline handlers...");
  registerPipelineHandlers();

  // ⚠️ **默认在 web 进程里也跑 worker**：自部署用户 `docker run` 一个容器就该能用
  // 全部功能，默认关掉的话他们点了导出会永远停在「排队中」且毫无线索。
  // 托管部署把 web 侧设成 WORKER_IN_WEB=0，由独立的 worker 容器承担 ffmpeg，
  // 这样一次导出才不会和请求处理抢同一份 CPU。
  if (shouldRunWorkerInWeb()) {
    console.log("[Bootstrap] Starting task worker (in web process)...");
    startWorker();
  } else {
    console.log("[Bootstrap] WORKER_IN_WEB=0 —— 任务交给独立的 worker 进程");
  }

  console.log("[Bootstrap] Ready.");
}
