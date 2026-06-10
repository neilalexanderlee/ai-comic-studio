import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, scenes, sceneVariants } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";

async function resolveVariant(
  projectId: string,
  sceneId: string,
  variantId: string,
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
  if (!scene) return null;
  const [variant] = await db
    .select()
    .from(sceneVariants)
    .where(and(eq(sceneVariants.id, variantId), eq(sceneVariants.sceneId, sceneId)));
  return variant ?? null;
}

/**
 * DELETE /api/projects/[id]/scenes/[sceneId]/variants/[variantId]
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string; variantId: string }> }
) {
  const { id: projectId, sceneId, variantId } = await params;
  const userId = getUserIdFromRequest(request);
  const variant = await resolveVariant(
    projectId,
    sceneId,
    variantId,
    userId,
    getAuthUserIdFromRequest(request) !== null
  );
  if (!variant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(sceneVariants).where(eq(sceneVariants.id, variantId));
  return NextResponse.json({ ok: true });
}
