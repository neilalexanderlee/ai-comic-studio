import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectOwner } from "@/lib/api-guard";
import { enqueueTask } from "@/lib/task-queue";
import type { TimelinePayload } from "@/lib/pipeline/episode-render";

/**
 * 剧集导出 —— **入队，不在这里跑 ffmpeg**。
 *
 * 渲染逻辑住在 `src/lib/pipeline/episode-render.ts`，由 worker 执行。
 * 这里只负责鉴权、校验、落一条任务，然后立刻返回 taskId；
 * 客户端拿 taskId 轮询 `GET /api/tasks/[id]` 看进度。
 *
 * 原先是 SSE 边渲染边推进度，一次导出把 HTTP 连接挂几分钟 ——
 * 过任何反向代理都会撞空闲超时，部署重启一次正在跑的导出全丢。
 */

/**
 * 时间线体积上限。一集几十个 clip 的 JSON 通常几十 KB；
 * 这条限制是防止有人把 base64 素材塞进来 —— payload 会整段进数据库也进备份。
 */
const MAX_TIMELINE_BYTES = 2 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId, episodeId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;

  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  // 与项目内其他路由一致：找不到和不属于都返回 404
  if (!episode) return NextResponse.json({ error: "Episode not found" }, { status: 404 });

  const body = (await request.json()) as { timeline?: TimelinePayload };
  const timeline = body.timeline;
  if (!timeline?.tracks?.length) {
    return NextResponse.json({ error: "Empty timeline" }, { status: 400 });
  }

  const serialized = JSON.stringify(timeline);
  if (serialized.length > MAX_TIMELINE_BYTES) {
    return NextResponse.json({ error: "时间线数据过大" }, { status: 413 });
  }

  const hasVideo = timeline.tracks.some(
    (t) => t.type === "video" && t.clips.some((c) => c.type === "video" && !!(c as { url?: string }).url)
  );
  if (!hasVideo) {
    return NextResponse.json({ error: "时间线里没有视频片段" }, { status: 400 });
  }

  const task = await enqueueTask({
    type: "episode_render",
    projectId,
    episodeId,
    payload: { projectId, episodeId, timeline },
    // 导出失败几乎都是素材或参数问题，重试同样的输入不会有不同结果 ——
    // 自动重跑只会白烧一遍 CPU 和 OSS 流量。留给用户改完再点。
    maxRetries: 1,
  });

  return NextResponse.json({ taskId: task.id });
}
