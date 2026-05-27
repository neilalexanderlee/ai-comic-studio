import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";
import { resolvePreviousEpisodeTailFrame } from "@/lib/storyboard/shot-frame-link";

/**
 * POST — 将上一集最后一镜的视频尾帧（或 AI 尾帧）路径直拷为本镜 anchor_first（D2-B）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string; shotId: string }> }
) {
  const { id: projectId, episodeId, shotId } = await params;
  const userId = getUserIdFromRequest(request);
  const isAuthenticated = getAuthUserIdFromRequest(request) !== null;
  if (!isAuthenticated) await reclaimLocalProjectsForUser(userId);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  if (!episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  const [shot] = await db
    .select()
    .from(shots)
    .where(
      and(eq(shots.id, shotId), eq(shots.projectId, projectId), eq(shots.episodeId, episodeId))
    );

  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const tail = await resolvePreviousEpisodeTailFrame({
    projectId,
    episodeId,
    versionId: shot.versionId,
  });

  if (!tail.path || !tail.sourceShotId || !tail.sourceType) {
    return NextResponse.json(
      { error: "上一集没有可用的视频尾帧或 AI 尾帧，请先在上一集生成视频" },
      { status: 400 }
    );
  }

  await db
    .update(shots)
    .set({
      anchorFirst: tail.path,
      chainSourceShotId: tail.sourceShotId,
      chainSourceType: tail.sourceType,
    })
    .where(eq(shots.id, shotId));

  return NextResponse.json({
    ok: true,
    anchorFirst: tail.path,
    chainSourceShotId: tail.sourceShotId,
    chainSourceType: tail.sourceType,
  });
}
