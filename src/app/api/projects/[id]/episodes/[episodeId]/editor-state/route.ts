import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { bootstrap } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { episodes } from "@/lib/db/schema";
import { getUserIdFromRequest } from "@/lib/get-user-id";

type Params = { params: Promise<{ id: string; episodeId: string }> };

/**
 * GET /api/projects/[id]/episodes/[episodeId]/editor-state
 * 读取编辑器时间线快照（JSON 字符串）
 */
export async function GET(req: NextRequest, { params }: Params) {
  await bootstrap();
  const { id: projectId, episodeId } = await params;
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [ep] = await db
    .select({ editorState: episodes.editorState })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));

  if (!ep) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ editorState: ep.editorState ?? null });
}

/**
 * PUT /api/projects/[id]/episodes/[episodeId]/editor-state
 * 保存编辑器时间线快照
 * Body: { tracks: Track[] }  — 直接序列化 useEditorStore 的 tracks
 */
export async function PUT(req: NextRequest, { params }: Params) {
  await bootstrap();
  const { id: projectId, episodeId } = await params;
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { tracks?: unknown; globalSubtitleStyle?: unknown };
  if (!body.tracks) return NextResponse.json({ error: "tracks required" }, { status: 400 });

  await db
    .update(episodes)
    .set({ editorState: JSON.stringify({ tracks: body.tracks, globalSubtitleStyle: body.globalSubtitleStyle ?? null }) })
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));

  return NextResponse.json({ ok: true });
}
