import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackVideos } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

/**
 * GET /api/projects/:id/episodes/:episodeId/track-videos
 * 查询指定剧集下所有已生成的 Track 合并视频。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId, episodeId } = await params;

  const records = await db
    .select()
    .from(trackVideos)
    .where(and(eq(trackVideos.projectId, projectId), eq(trackVideos.episodeId, episodeId)))
    .orderBy(desc(trackVideos.createdAt));

  return NextResponse.json({ trackVideos: records });
}
