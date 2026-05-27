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

  // Verify version belongs to this project.
  // Note: we intentionally do NOT filter by episodeId here — versions created
  // when the episode store hadn't hydrated yet may have episodeId = null but
  // still belong to this project and should be deletable.
  const [version] = await db
    .select()
    .from(storyboardVersions)
    .where(
      and(
        eq(storyboardVersions.id, versionId),
        eq(storyboardVersions.projectId, projectId)
      )
    );
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  // Refuse to delete the last episode-specific version.
  // We count only versions tied to this episode (episodeId matches) since
  // orphaned null-episodeId versions don't appear in the episode UI anyway.
  const allVersions = await db
    .select({ id: storyboardVersions.id })
    .from(storyboardVersions)
    .where(
      and(
        eq(storyboardVersions.episodeId, episodeId),
        eq(storyboardVersions.projectId, projectId)
      )
    );
  // If the version being deleted has a null episodeId (orphan), skip the guard
  // since it's not counted in the episode list.
  const isEpisodeVersion = version.episodeId === episodeId;
  if (isEpisodeVersion && allVersions.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last version" },
      { status: 400 }
    );
  }

  // Fetch all shots with their file paths before deleting DB records
  const versionShots = await db
    .select({
      id: shots.id,
      anchorFirst: shots.anchorFirst,
      anchorLastAi: shots.anchorLastAi,
      videoUrl: shots.videoUrl,
      cutPoint: shots.cutPoint,
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
  // (adjacent shots can share a file when anchorLastAi is reused as the next anchorFirst)
  const filesToDelete = new Set<string>();
  for (const shot of versionShots) {
    if (shot.anchorFirst) filesToDelete.add(shot.anchorFirst);
    if (shot.anchorLastAi) filesToDelete.add(shot.anchorLastAi);
    if (shot.videoUrl) filesToDelete.add(shot.videoUrl);
    if (shot.cutPoint) filesToDelete.add(shot.cutPoint);
  }
  for (const filePath of filesToDelete) {
    tryDeleteFile(filePath);
  }

  return new NextResponse(null, { status: 204 });
}
