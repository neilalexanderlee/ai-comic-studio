import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireProjectOwner } from "@/lib/api-guard";
import { enqueueTask } from "@/lib/task-queue";

/**
 * 合并多集成片 —— **入队，不在这里跑 ffmpeg**（同 render 路由）。
 * 客户端拿 taskId 轮询 `GET /api/tasks/[id]`。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const guard = await requireProjectOwner(req, projectId);
  if (!guard.ok) return guard.response;

  const body = (await req.json()) as { episodeIds?: unknown };
  const episodeIds = body.episodeIds;

  if (!Array.isArray(episodeIds) || episodeIds.length < 2 || !episodeIds.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "At least 2 episodes required" }, { status: 400 });
  }

  // 入队前先做一次校验，让"选错了"这类错误立刻反馈，而不是排队几分钟后才失败。
  // worker 执行时还会再校验一次 —— 中间可能过了很久。
  const selected = await db
    .select({ id: episodes.id, title: episodes.title, finalVideoUrl: episodes.finalVideoUrl })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), inArray(episodes.id, episodeIds as string[])));

  if (selected.length !== episodeIds.length) {
    return NextResponse.json({ error: "Some episodes not found" }, { status: 400 });
  }
  const missingVideo = selected.find((e) => !e.finalVideoUrl);
  if (missingVideo) {
    return NextResponse.json({ error: `Episode "${missingVideo.title}" has no video` }, { status: 400 });
  }

  const task = await enqueueTask({
    type: "episode_merge",
    projectId,
    payload: { projectId, episodeIds },
    maxRetries: 1,
  });

  return NextResponse.json({ taskId: task.id });
}
