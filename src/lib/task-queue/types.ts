import type { tasks } from "@/lib/db/schema";
import type { InferSelectModel } from "drizzle-orm";

export type Task = InferSelectModel<typeof tasks>;

export type TaskType = Task["type"];

/** handler 用它回报阶段进度。跨进程时这是客户端唯一能看到进展的途径。 */
export type ProgressReporter = (progress: { stage: string; message: string }) => Promise<void>;

export type TaskHandler = (task: Task, onProgress: ProgressReporter) => Promise<unknown>;

export type TaskHandlerMap = Partial<Record<NonNullable<TaskType>, TaskHandler>>;
