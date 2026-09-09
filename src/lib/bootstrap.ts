import { runMigrations } from "@/lib/db";
import { pruneStalePromptOverrides } from "@/lib/ai/prompts/prune-stale-prompt-overrides";
import { initializeProviders } from "@/lib/ai/setup";
import { registerPipelineHandlers } from "@/lib/pipeline";
import { startWorker, shouldRunWorkerInWeb } from "@/lib/task-queue";
import { setupProxy } from "@/lib/proxy-setup";
import { ensureBootstrapAdmins } from "@/lib/admin";
import {
  registrationConflictHint,
  registrationModeIsUnrecognized,
  resolveRegistrationMode,
} from "@/lib/registration";

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

  // ADMIN_USERNAMES 里的人幂等提升为管理员。放在迁移之后（要 users.role 这一列），
  // 失败不阻断启动 —— 管理员权限没授予只是少了个管理端，不该让整个服务起不来。
  try {
    await ensureBootstrapAdmins();
  } catch (err) {
    console.warn("[Bootstrap] ensureBootstrapAdmins 失败:", err);
  }

  // 注册准入模式：两个开关打架时必须显式说出来，否则「设了 REGISTRATION_MODE=invite
  // 却还是注册不了」会毫无线索（见 lib/registration.ts 的 fail closed 说明）。
  if (registrationModeIsUnrecognized()) {
    console.warn(
      `[Bootstrap] REGISTRATION_MODE 的值无法识别（只接受 open / invite / closed），` +
        `已按旧开关 ALLOW_REGISTRATION 处理。`
    );
  }
  const conflict = registrationConflictHint();
  if (conflict) console.warn(`[Bootstrap] ${conflict}`);
  console.log(`[Bootstrap] 注册准入模式：${resolveRegistrationMode()}`);

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
