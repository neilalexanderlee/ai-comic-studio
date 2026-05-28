import { runMigrations } from "@/lib/db";
import { pruneStalePromptOverrides } from "@/lib/ai/prompts/prune-stale-prompt-overrides";
import { initializeProviders } from "@/lib/ai/setup";
import { registerPipelineHandlers } from "@/lib/pipeline";
import { startWorker } from "@/lib/task-queue";
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

  console.log("[Bootstrap] Starting task worker...");
  startWorker();

  console.log("[Bootstrap] Ready.");
}
