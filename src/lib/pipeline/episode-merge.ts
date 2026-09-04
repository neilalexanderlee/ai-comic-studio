import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { assembleVideo } from "@/lib/video/ffmpeg";
import type { ProgressReporter, Task } from "@/lib/task-queue/types";

/**
 * 把多集已导出的成片拼成一条。
 *
 * 与 `episode-render` 一样搬出请求处理函数：虽然这里是 concat 而不是重编码、
 * 通常只要几秒，但「ffmpeg 不跑在请求路径上」应该是一条没有例外的规则 ——
 * 留一个例外，下次有人就会照着它再写一个。
 */

interface MergePayload {
  projectId: string;
  episodeIds: string[];
}

export async function handleEpisodeMerge(task: Task, onProgress: ProgressReporter) {
  const payload = task.payload as MergePayload | null;
  if (!payload?.projectId || !Array.isArray(payload.episodeIds)) {
    throw new Error("episode_merge 任务缺少 projectId 或 episodeIds");
  }

  // 归属与可用性在 worker 里**重新校验一次**：任务从入队到执行之间可能过了很久，
  // 期间剧集可能被删、成片可能被重新导出。只信入队时的快照会拼出错误的片子。
  const selected = await db
    .select()
    .from(episodes)
    .where(
      and(eq(episodes.projectId, payload.projectId), inArray(episodes.id, payload.episodeIds))
    )
    .orderBy(asc(episodes.sequence));

  if (selected.length !== payload.episodeIds.length) {
    throw new Error("有剧集已不存在");
  }
  const missing = selected.find((e) => !e.finalVideoUrl);
  if (missing) throw new Error(`剧集「${missing.title}」还没有成片`);

  await onProgress({ stage: "concat", message: `拼接 ${selected.length} 集…` });

  const outputPath = await assembleVideo({
    videoPaths: selected.map((e) => e.finalVideoUrl!),
    subtitles: [],
    projectId: payload.projectId,
    shotDurations: [],
  });

  return { outputUrl: outputPath };
}
