import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, scenes } from "@/lib/db/schema";
import { eq, and, asc, isNull, or } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";

async function resolveProject(id: string, userId: string, isAuthenticated: boolean) {
  if (!isAuthenticated) await reclaimLocalProjectsForUser(userId);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return project ?? null;
}

/**
 * GET /api/projects/[id]/scenes
 * 返回项目下所有场景：
 *   - 项目级（episode_id IS NULL）
 *   - 指定剧集场景（?episodeId=xxx）
 * 若传了 episodeId，则同时返回项目级 + 该剧集级场景。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(
    projectId,
    userId,
    getAuthUserIdFromRequest(request) !== null
  );
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const episodeId = url.searchParams.get("episodeId");

  const allScenes = await db
    .select()
    .from(scenes)
    .where(
      and(
        eq(scenes.projectId, projectId),
        episodeId
          ? or(isNull(scenes.episodeId), eq(scenes.episodeId, episodeId))
          : isNull(scenes.episodeId)
      )
    )
    .orderBy(asc(scenes.createdAt));

  return NextResponse.json(allScenes);
}

/**
 * POST /api/projects/[id]/scenes
 * 创建场景。body: { name, description?, episodeId? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(
    projectId,
    userId,
    getAuthUserIdFromRequest(request) !== null
  );
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    episodeId?: string | null;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(scenes).values({
    id,
    projectId,
    episodeId: body.episodeId ?? null,
    name: body.name.trim(),
    description: body.description?.trim() ?? "",
  });

  const [created] = await db.select().from(scenes).where(eq(scenes.id, id));
  return NextResponse.json(created, { status: 201 });
}
