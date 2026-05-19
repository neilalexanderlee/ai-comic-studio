import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots, dialogues, storyboardVersions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import fs from "fs";

function tryDeleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Non-fatal: log and continue
    console.warn(`[VersionDelete] Failed to delete file: ${filePath}`);
  }
}

/**
 * DELETE /api/projects/[id]/episodes/[episodeId]/versions/[versionId]
 *
 * Deletes a storyboard version, all its shots/dialogues, and the associated
 * image/video files on disk. Refuses to delete the last remaining version.
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

  // Fetch all shots with their file paths before deleting DB records
  const versionShots = await db
    .select({
      id: shots.id,
      firstFrame: shots.firstFrame,
      lastFrame: shots.lastFrame,
      videoUrl: shots.videoUrl,
      seedanceLastFrame: shots.seedanceLastFrame,
      sceneRefFrame: shots.sceneRefFrame,
      referenceVideoUrl: shots.referenceVideoUrl,
    })
    .from(shots)
    .where(eq(shots.versionId, versionId));

  // Delete DB records: dialogues → shots → version
  for (const shot of versionShots) {
    await db.delete(dialogues).where(eq(dialogues.shotId, shot.id));
  }
  await db.delete(shots).where(eq(shots.versionId, versionId));
  await db.delete(storyboardVersions).where(eq(storyboardVersions.id, versionId));

  // Clean up files on disk — use a Set to avoid double-deleting shared paths
  // (adjacent shots can share a file when lastFrame is reused as the next firstFrame)
  const filesToDelete = new Set<string>();
  for (const shot of versionShots) {
    if (shot.firstFrame) filesToDelete.add(shot.firstFrame);
    if (shot.lastFrame) filesToDelete.add(shot.lastFrame);
    if (shot.videoUrl) filesToDelete.add(shot.videoUrl);
    if (shot.seedanceLastFrame) filesToDelete.add(shot.seedanceLastFrame);
    if (shot.sceneRefFrame) filesToDelete.add(shot.sceneRefFrame);
    if (shot.referenceVideoUrl) filesToDelete.add(shot.referenceVideoUrl);
  }
  for (const filePath of filesToDelete) {
    tryDeleteFile(filePath);
  }

  return new NextResponse(null, { status: 204 });
}
