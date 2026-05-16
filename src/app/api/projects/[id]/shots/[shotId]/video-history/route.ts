/**
 * GET  /api/projects/[id]/shots/[shotId]/video-history
 *   → 返回该分镜的历史视频列表（最新在前）
 *
 * POST /api/projects/[id]/shots/[shotId]/video-history
 *   Body: { historyId: string }
 *   → 将指定历史版本恢复为当前视频（把当前视频先存入历史，再把目标历史版本写回 shot）
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, shotVideoHistory } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { saveVideoToHistory, getVideoHistory } from "@/lib/video/video-history";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;

  const [shot] = await db.select({ projectId: shots.projectId })
    .from(shots)
    .where(eq(shots.id, shotId));

  if (!shot || shot.projectId !== projectId) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const history = await getVideoHistory(shotId);
  return NextResponse.json({ history });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  const body = await req.json().catch(() => ({}));
  const { historyId } = body as { historyId?: string };

  if (!historyId) {
    return NextResponse.json({ error: "historyId is required" }, { status: 400 });
  }

  // 取出目标历史条目
  const [target] = await db
    .select()
    .from(shotVideoHistory)
    .where(eq(shotVideoHistory.id, historyId));

  if (!target || target.shotId !== shotId) {
    return NextResponse.json({ error: "History entry not found" }, { status: 404 });
  }

  // 取出当前 shot
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot || shot.projectId !== projectId) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  // 1. 把当前 videoUrl 存入历史（如果存在）
  await saveVideoToHistory(shotId, shot.videoUrl, shot.videoResolution, "回退前保存");

  // 2. 从历史表中删除目标条目（它将成为当前版本）
  await db.delete(shotVideoHistory).where(eq(shotVideoHistory.id, historyId));

  // 3. 写回 shot
  await db
    .update(shots)
    .set({
      videoUrl: target.videoUrl,
      videoResolution: target.resolution,
      status: "completed",
    })
    .where(eq(shots.id, shotId));

  return NextResponse.json({
    videoUrl: target.videoUrl,
    videoResolution: target.resolution,
  });
}
