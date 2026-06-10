import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, scenes, sceneVariants } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";

async function resolveScene(
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
  if (!project) return null;
  const [scene] = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, projectId)));
  return scene ?? null;
}

/**
 * GET /api/projects/[id]/scenes/[sceneId]/variants
 * 返回该场景的所有角度变体列表
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id: projectId, sceneId } = await params;
  const userId = getUserIdFromRequest(request);
  const scene = await resolveScene(
    projectId,
    sceneId,
    userId,
    getAuthUserIdFromRequest(request) !== null
  );
  if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const variants = await db
    .select()
    .from(sceneVariants)
    .where(eq(sceneVariants.sceneId, sceneId))
    .orderBy(asc(sceneVariants.createdAt));

  return NextResponse.json(variants);
}
