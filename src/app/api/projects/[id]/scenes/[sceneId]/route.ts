import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, scenes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";

async function resolveProjectAndScene(
  projectId: string,
  sceneId: string,
  userId: string,
  isAuthenticated: boolean
) {
  if (!isAuthenticated) await reclaimLocalProjectsForUser(userId);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) return { project: null, scene: null };

  const [scene] = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, projectId)));
  return { project, scene: scene ?? null };
}

/**
 * GET /api/projects/[id]/scenes/[sceneId]
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id: projectId, sceneId } = await params;
  const userId = getUserIdFromRequest(request);
  const { scene } = await resolveProjectAndScene(
    projectId,
    sceneId,
    userId,
    getAuthUserIdFromRequest(request) !== null
  );
  if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(scene);
}

/**
 * PATCH /api/projects/[id]/scenes/[sceneId]
 * 更新场景字段。body: { name?, description?, imagePath? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id: projectId, sceneId } = await params;
  const userId = getUserIdFromRequest(request);
  const { scene } = await resolveProjectAndScene(
    projectId,
    sceneId,
    userId,
    getAuthUserIdFromRequest(request) !== null
  );
  if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    imagePath?: string | null;
  };

  const updates: Partial<typeof scene> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description.trim();
  if (body.imagePath !== undefined) updates.imagePath = body.imagePath;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(scene);
  }

  await db.update(scenes).set(updates).where(eq(scenes.id, sceneId));
  const [updated] = await db.select().from(scenes).where(eq(scenes.id, sceneId));
  return NextResponse.json(updated);
}

/**
 * DELETE /api/projects/[id]/scenes/[sceneId]
 * 删除场景。shots.scene_id 通过 ON DELETE SET NULL 自动置空。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id: projectId, sceneId } = await params;
  const userId = getUserIdFromRequest(request);
  const { scene } = await resolveProjectAndScene(
    projectId,
    sceneId,
    userId,
    getAuthUserIdFromRequest(request) !== null
  );
  if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(scenes).where(eq(scenes.id, sceneId));
  return NextResponse.json({ ok: true });
}
