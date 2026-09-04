import { dequeueTask, completeTask, failTask, reclaimStaleTasks, updateTaskProgress } from "./queue";
import type { TaskHandlerMap, Task } from "./types";

const POLL_INTERVAL_MS = 2000;
/** 多久扫一次卡死的任务。比 STALE_RUNNING_MS 小一个数量级即可，不需要频繁。 */
const RECLAIM_INTERVAL_MS = 60_000;

let isRunning = false;
let handlers: TaskHandlerMap = {};
let lastReclaimAt = 0;

export function registerHandlers(newHandlers: TaskHandlerMap) {
  handlers = { ...handlers, ...newHandlers };
}

async function processTask(task: Task) {
  const handler = task.type ? handlers[task.type] : undefined;
  if (!handler) {
    await failTask(task.id, `No handler registered for task type: ${task.type}`);
    return;
  }

  try {
    const result = await handler(task, (progress) => updateTaskProgress(task.id, progress));
    await completeTask(task.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failTask(task.id, message);
  }
}

async function poll() {
  if (!isRunning) return;

  try {
    // 回收先于认领：崩掉的任务重新变回 pending 之后，本轮就能顺带捡起来
    if (Date.now() - lastReclaimAt > RECLAIM_INTERVAL_MS) {
      lastReclaimAt = Date.now();
      const n = await reclaimStaleTasks();
      if (n > 0) console.warn(`[TaskWorker] 回收了 ${n} 条卡在 running 的任务`);
    }

    const task = await dequeueTask();
    if (task) {
      await processTask(task);
    }
  } catch (err) {
    console.error("[TaskWorker] Poll error:", err);
  }

  if (isRunning) {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
}

/**
 * web 进程里要不要顺带跑 worker。
 *
 * ⚠️ **默认开**。自部署用户 `docker run` 一个容器就该能用全部功能 ——
 * 默认关掉的话，他们装上会发现「点了导出，永远停在排队中」，而且毫无线索。
 * 这与 `BILLING_ENABLED` 的默认关闭是同一条原则的两面：**默认值要让单机装机即用**。
 *
 * 托管部署把 web 这一侧设成 "0"，由 compose 里独立的 worker service 承担 ——
 * 那样一次 ffmpeg 才不会和请求处理抢同一份 CPU。
 */
export function shouldRunWorkerInWeb(): boolean {
  return process.env.WORKER_IN_WEB !== "0";
}

export function startWorker() {
  if (isRunning) return;
  isRunning = true;
  console.log("[TaskWorker] Started polling every", POLL_INTERVAL_MS, "ms");
  poll();
}

export function stopWorker() {
  isRunning = false;
  console.log("[TaskWorker] Stopped");
}
