import type { tasks } from "@/lib/db/schema";
import type { InferSelectModel } from "drizzle-orm";

export type Task = InferSelectModel<typeof tasks>;

export type TaskType = Task["type"];

export type TaskHandler = (task: Task) => Promise<unknown>;

export type TaskHandlerMap = Partial<Record<NonNullable<TaskType>, TaskHandler>>;
