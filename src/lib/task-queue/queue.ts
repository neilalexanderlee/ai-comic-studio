import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { TaskType } from "./types";

/**
 * 任务队列。表就是队列，没有 Redis / MQ ——
 * 这个项目的吞吐是「一个人点一次导出」，为它引一套中间件是负债不是资产。
 *
 * ## 三条不能省的规则
 *
 * 1. **认领必须是一条语句。** `UPDATE ... WHERE id = (SELECT ... LIMIT 1)` 让
 *    「挑一条」和「标记为 running」在同一个语句里完成。分两步做，两个 worker
 *    会认领同一条任务并各跑一遍 ffmpeg。
 * 2. **失败要退避。** 上游 429 / OSS 抖动是最常见的失败原因，立即重排会把它们
 *    打成紧密重试循环 —— 既跑不成功又把额度烧光。
 * 3. **卡住的任务要能回收。** 进程崩在认领与完成之间，任务会永远停在 running。
 *    这与 `usage_records` 里那些永远 `reserved` 的残骸是同一个形状的问题：
 *    没有回收机制的话，一次崩溃就永久损失一个任务。
 */

/** 认领后多久没有完成就认为 worker 已经死了。ffmpeg 导出一集实测几分钟，留足余量。 */
const STALE_RUNNING_MS = 30 * 60 * 1000;

/** 重试退避（毫秒）。按已重试次数取，超出则用最后一档。 */
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000];

/**
 * Date → 数据库时间戳（**秒**）。
 *
 * ⚠️ Drizzle 的 `mode:"timestamp"` 存的是秒。本文件里有裸 `sql` 片段
 * （认领语句必须是单条 SQL），那里面必须自己换算。
 * 这里原先写的是 `now.getTime()`（毫秒），于是 `scheduled_at <= <毫秒>` 恒为真 ——
 * 延迟执行**静默失效**，任何被排到未来的任务都会立刻被认领。
 * 当时没人传 `scheduledAt` 所以没暴露；下面的重试退避一加上去它就是致命的。
 * 与 CLAUDE.md 约定 8i 记的是同一类坑。
 */
function toDbSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

export async function enqueueTask(params: {
  type: NonNullable<TaskType>;
  projectId?: string;
  payload?: unknown;
  maxRetries?: number;
  scheduledAt?: Date;
  episodeId?: string;
}) {
  const id = ulid();
  const [task] = await db
    .insert(tasks)
    .values({
      id,
      type: params.type,
      projectId: params.projectId,
      payload: params.payload,
      maxRetries: params.maxRetries ?? 3,
      scheduledAt: params.scheduledAt,
      episodeId: params.episodeId ?? null,
    })
    .returning();
  return task;
}

export async function dequeueTask(): Promise<typeof tasks.$inferSelect | null> {
  const now = new Date();

  // 原子认领：挑选与标记在同一条语句里完成，两个 worker 不会抢到同一条。
  const [task] = await db
    .update(tasks)
    .set({ status: "running", startedAt: now })
    .where(
      eq(
        tasks.id,
        sql`(SELECT id FROM ${tasks}
             WHERE ${tasks.status} = 'pending'
               AND (${tasks.scheduledAt} IS NULL OR ${tasks.scheduledAt} <= ${toDbSeconds(now)})
             ORDER BY ${tasks.createdAt} ASC LIMIT 1)`
      )
    )
    .returning();

  return task || null;
}

/**
 * 回收「认领了但迟迟没有下文」的任务。
 *
 * 走的是与普通失败完全相同的路径（`failTask`），所以重试次数、退避、
 * 超过上限转 failed 这些语义自动一致 —— 不需要为崩溃单独写一套规则。
 */
export async function reclaimStaleTasks(now = new Date()): Promise<number> {
  const cutoff = toDbSeconds(new Date(now.getTime() - STALE_RUNNING_MS));
  const stuck = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      sql`${tasks.status} = 'running'
          AND ${tasks.startedAt} IS NOT NULL
          AND ${tasks.startedAt} <= ${cutoff}`
    );

  for (const t of stuck) {
    await failTask(t.id, `任务超过 ${Math.round(STALE_RUNNING_MS / 60000)} 分钟没有完成，判定执行进程已退出`);
  }
  return stuck.length;
}

/** 写入进行中的阶段说明。worker 在别的进程里，进度只能经数据库回传给客户端。 */
export async function updateTaskProgress(id: string, progress: unknown) {
  await db.update(tasks).set({ progress }).where(eq(tasks.id, id));
}

export async function completeTask(id: string, result: unknown) {
  await db
    .update(tasks)
    .set({
      status: "completed",
      result: result as Record<string, unknown>,
    })
    .where(eq(tasks.id, id));
}

export async function failTask(id: string, error: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));

  if (!task) return;

  const newRetries = (task.retries ?? 0) + 1;
  const maxRetries = task.maxRetries ?? 3;

  if (newRetries < maxRetries) {
    // 退避后再排队。依赖 dequeueTask 正确比较 scheduled_at —— 见 toDbSeconds 的注释。
    const backoff = RETRY_BACKOFF_MS[Math.min(newRetries - 1, RETRY_BACKOFF_MS.length - 1)];
    await db
      .update(tasks)
      .set({
        status: "pending",
        retries: newRetries,
        error,
        scheduledAt: new Date(Date.now() + backoff),
        startedAt: null,
      })
      .where(eq(tasks.id, id));
  } else {
    await db
      .update(tasks)
      .set({
        status: "failed",
        retries: newRetries,
        error,
      })
      .where(eq(tasks.id, id));
  }
}

export async function getTasksByProject(projectId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.createdAt));
}
