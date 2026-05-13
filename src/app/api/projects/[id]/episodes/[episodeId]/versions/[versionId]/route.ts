import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots, dialogues, storyboardVersions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

/**
 * DELETE /api/projects/[id]/episodes/[episodeId]/versions/[versionId]
 *
 * Deletes a storyboard version and all its shots/dialogues.
 * Refuses to delete the last remaining version for an episode.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string; versionId: string }> }
) {
  const { id: projectId, episodeId, versionId } = await params;
  const userId = getUserIdFromRequest(request);

  // Auth check
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [episode] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  if (!episode) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify version belongs to this episode
  const [version] = await db
    .select()
    .from(storyboardVersions)
    .where(
      and(
        eq(storyboardVersions.id, versionId),
        eq(storyboardVersions.episodeId, episodeId),
        eq(storyboardVersions.projectId, projectId)
      )
    );
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  // Refuse to delete the last version
  const allVersions = await db
    .select({ id: storyboardVersions.id })
    .from(storyboardVersions)
    .where(
      and(
        eq(storyboardVersions.episodeId, episodeId),
        eq(storyboardVersions.projectId, projectId)
      )
    );
  if (allVersions.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last version" },
      { status: 400 }
    );
  }

  // Delete dialogues belonging to shots in this version, then shots, then version
  const versionShots = await db
    .select({ id: shots.id })
    .from(shots)
    .where(eq(shots.versionId, versionId));

  for (const shot of versionShots) {
    await db.delete(dialogues).where(eq(dialogues.shotId, shot.id));
  }
  await db.delete(shots).where(eq(shots.versionId, versionId));
  await db.delete(storyboardVersions).where(eq(storyboardVersions.id, versionId));

  return new NextResponse(null, { status: 204 });
}
