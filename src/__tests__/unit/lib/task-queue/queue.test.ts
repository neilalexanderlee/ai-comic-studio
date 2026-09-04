/**
 * 任务队列 —— 跑在**真实的内存 SQLite** 上。
 *
 * 全局 setup 把 `@/lib/db` mock 成了假对象，那对本模块没有意义：认领是一条
 * `UPDATE ... WHERE id = (SELECT ... LIMIT 1)` 的裸 SQL，正确性全在 SQL 里。
 * 所以按 `credits-subscription.test.ts` 的同款做法覆盖掉那个 mock，换成真库。
 *
 * 锁住的不变量：
 *  · `scheduled_at` 的比较用**秒**（写成毫秒会让延迟执行静默失效）
 *  · 失败要退避后再排队，不是立刻重排
 *  · 卡在 running 的任务能被回收，且走的是与普通失败相同的路径
 *  · 两次认领不会拿到同一条任务
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const DDL = `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  result TEXT,
  error TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at INTEGER NOT NULL,
  scheduled_at INTEGER,
  progress TEXT,
  started_at INTEGER,
  episode_id TEXT
);
`;

const holder: { sqlite?: import("better-sqlite3").Database } = {};

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

async function q() {
  return import("@/lib/task-queue/queue");
}

/** 直接读库，绕开被测代码 —— 断言要看的是磁盘上的事实 */
function row(id: string) {
  return holder.sqlite!.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as {
    status: string;
    retries: number;
    scheduled_at: number | null;
    started_at: number | null;
    progress: string | null;
    error: string | null;
  };
}

const SEC = 1000;

beforeEach(async () => {
  await q();
  holder.sqlite!.prepare(`DELETE FROM tasks`).run();
  vi.useRealTimers();
});

describe("认领", () => {
  it("按 created_at 先进先出，且同一条不会被认领两次", async () => {
    const { enqueueTask, dequeueTask } = await q();
    const a = await enqueueTask({ type: "episode_render" });
    await new Promise((r) => setTimeout(r, 1100)); // created_at 精度是秒，必须拉开
    const b = await enqueueTask({ type: "episode_merge" });

    const first = await dequeueTask();
    const second = await dequeueTask();
    expect(first?.id).toBe(a.id);
    expect(second?.id).toBe(b.id);
    expect(await dequeueTask()).toBeNull();
  });

  it("认领时记下 started_at —— 没有它就无法回收崩溃遗留的任务", async () => {
    const { enqueueTask, dequeueTask } = await q();
    const t = await enqueueTask({ type: "episode_render" });
    await dequeueTask();
    expect(row(t.id).status).toBe("running");
    expect(row(t.id).started_at).toBeTypeOf("number");
  });

  /**
   * 这条是这次改动的核心。`scheduled_at` 是 `mode:"timestamp"`（秒），
   * 而原实现拿 `now.getTime()`（毫秒）去比 —— 于是 `scheduled_at <= <毫秒>` 恒为真，
   * **延迟执行静默失效**。当时没人传 scheduledAt 所以没暴露，重试退避一加上去就是致命的。
   */
  it("排到未来的任务不会被提前认领（秒 vs 毫秒）", async () => {
    const { enqueueTask, dequeueTask } = await q();
    await enqueueTask({ type: "episode_render", scheduledAt: new Date(Date.now() + 60 * SEC) });
    expect(await dequeueTask()).toBeNull();
  });

  it("到点之后才认领得到", async () => {
    const { enqueueTask, dequeueTask } = await q();
    const t = await enqueueTask({ type: "episode_render", scheduledAt: new Date(Date.now() - 5 * SEC) });
    expect((await dequeueTask())?.id).toBe(t.id);
  });
});

describe("失败与重试", () => {
  it("未超上限时退避后再排队，而不是立刻重排", async () => {
    const { enqueueTask, dequeueTask, failTask } = await q();
    const t = await enqueueTask({ type: "episode_render", maxRetries: 3 });
    await dequeueTask();
    await failTask(t.id, "上游 429");

    const r = row(t.id);
    expect(r.status).toBe("pending");
    expect(r.retries).toBe(1);
    expect(r.started_at).toBeNull();
    // 退避生效：立刻再认领应该拿不到
    expect(r.scheduled_at! * 1000).toBeGreaterThan(Date.now());
    expect(await dequeueTask()).toBeNull();
  });

  it("退避时间随重试次数变长", async () => {
    const { enqueueTask, failTask } = await q();
    const t = await enqueueTask({ type: "episode_render", maxRetries: 5 });
    await failTask(t.id, "x");
    const first = row(t.id).scheduled_at!;
    await failTask(t.id, "x");
    const second = row(t.id).scheduled_at!;
    expect(second).toBeGreaterThan(first);
  });

  it("达到 maxRetries 后转 failed，不再排队", async () => {
    const { enqueueTask, dequeueTask, failTask } = await q();
    const t = await enqueueTask({ type: "episode_render", maxRetries: 1 });
    await dequeueTask();
    await failTask(t.id, "素材缺失");
    expect(row(t.id).status).toBe("failed");
    expect(row(t.id).error).toBe("素材缺失");
    expect(await dequeueTask()).toBeNull();
  });
});

describe("回收卡死的任务", () => {
  it("超时的 running 任务被捡回来重排", async () => {
    const { enqueueTask, dequeueTask, reclaimStaleTasks } = await q();
    const t = await enqueueTask({ type: "episode_render", maxRetries: 3 });
    await dequeueTask();

    // 假装它是 40 分钟前认领的（进程随后崩了）
    holder.sqlite!
      .prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`)
      .run(Math.floor((Date.now() - 40 * 60 * 1000) / 1000), t.id);

    expect(await reclaimStaleTasks()).toBe(1);
    const r = row(t.id);
    expect(r.status).toBe("pending");
    // 走的是与普通失败相同的路径，所以重试次数照常累加
    expect(r.retries).toBe(1);
    expect(r.error).toContain("执行进程已退出");
  });

  it("刚认领的任务不会被误回收", async () => {
    const { enqueueTask, dequeueTask, reclaimStaleTasks } = await q();
    const t = await enqueueTask({ type: "episode_render" });
    await dequeueTask();
    expect(await reclaimStaleTasks()).toBe(0);
    expect(row(t.id).status).toBe("running");
  });

  it("回收同样受 maxRetries 约束 —— 反复崩溃的任务最终转 failed", async () => {
    const { enqueueTask, dequeueTask, reclaimStaleTasks } = await q();
    const t = await enqueueTask({ type: "episode_render", maxRetries: 1 });
    await dequeueTask();
    holder.sqlite!
      .prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`)
      .run(Math.floor((Date.now() - 40 * 60 * 1000) / 1000), t.id);
    await reclaimStaleTasks();
    expect(row(t.id).status).toBe("failed");
  });
});

describe("进度回报", () => {
  it("progress 落库，客户端才看得到跨进程的进展", async () => {
    const { enqueueTask, updateTaskProgress } = await q();
    const t = await enqueueTask({ type: "episode_render" });
    await updateTaskProgress(t.id, { stage: "concat", message: "合并 12 个视频片段…" });
    expect(JSON.parse(row(t.id).progress!)).toEqual({
      stage: "concat",
      message: "合并 12 个视频片段…",
    });
  });
});
