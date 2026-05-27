import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots, dialogues, storyboardVersions } from "@/lib/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { ulid } from "ulid";

function buildVersionLabel(versionNum: number): string {
  const today = new Date();
  const dateStr =
    today.getUTCFullYear().toString() +
    String(today.getUTCMonth() + 1).padStart(2, "0") +
    String(today.getUTCDate()).padStart(2, "0");
  return `${dateStr}-V${versionNum}`;
}

/**
 * POST /api/projects/[id]/episodes/[episodeId]/versions
 *
 * Body:
 *   label?          – custom label (defaults to date-VN)
 *   sourceVersionId – if present, clone shots from that version
 *   copyText        – copy prompt / motionScript / startFrameDesc / endFrameDesc / cameraDirection / duration
 *   copyFrames      – copy anchorFirst / anchorLastAi / cutPoint
 *   copyVideoPrompts– copy videoPrompt / videoScript
 *   copyVideos      – copy videoUrl
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId, episodeId } = await params;
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

  const body = (await request.json()) as {
    label?: string;
    sourceVersionId?: string | null;
    copyText?: boolean;
    copyFrames?: boolean;
    copyVideoPrompts?: boolean;
    copyVideos?: boolean;
  };

  // Determine next version number
  const [maxRow] = await db
    .select({ maxNum: storyboardVersions.versionNum })
    .from(storyboardVersions)
    .where(and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId)))
    .orderBy(desc(storyboardVersions.versionNum))
    .limit(1);
  const nextNum = (maxRow?.maxNum ?? 0) + 1;

  const versionId = ulid();
  const label = body.label?.trim() || buildVersionLabel(nextNum);

  await db.insert(storyboardVersions).values({
    id: versionId,
    projectId,
    episodeId,
    label,
    versionNum: nextNum,
    createdAt: new Date(),
  });

  // If cloning from a source version, copy shots
  if (body.sourceVersionId) {
    const sourceShots = await db
      .select()
      .from(shots)
      .where(and(eq(shots.versionId, body.sourceVersionId), eq(shots.episodeId, episodeId)))
      .orderBy(asc(shots.sequence));

    for (const s of sourceShots) {
      const newShotId = ulid();
      await db.insert(shots).values({
        id: newShotId,
        projectId,
        episodeId,
        versionId,
        sequence: s.sequence,
        // text fields
        prompt: body.copyText ? (s.prompt ?? "") : "",
        startFrameDesc: body.copyText ? s.startFrameDesc : null,
        endFrameDesc: body.copyText ? s.endFrameDesc : null,
        motionScript: body.copyText ? s.motionScript : null,
        videoScript: body.copyVideoPrompts ? s.videoScript : null,
        cameraDirection: body.copyText ? (s.cameraDirection ?? "static") : "static",
        duration: body.copyText ? (s.duration ?? 10) : 10,
        // frame fields
        anchorFirst: body.copyFrames ? s.anchorFirst : null,
        anchorLastAi: body.copyFrames ? s.anchorLastAi : null,
        // video prompt
        videoPrompt: body.copyVideoPrompts ? s.videoPrompt : null,
        // video
        videoUrl: body.copyVideos ? s.videoUrl : null,
        status: "pending",
        warnings: null,
      });

      // Copy dialogues if copying text
      if (body.copyText) {
        const srcDialogues = await db
          .select()
          .from(dialogues)
          .where(eq(dialogues.shotId, s.id));
        for (const d of srcDialogues) {
          await db.insert(dialogues).values({
            id: ulid(),
            shotId: newShotId,
            characterId: d.characterId,
            text: d.text,
            sequence: d.sequence,
          });
        }
      }
    }
  }

  return NextResponse.json({ versionId, label, versionNum: nextNum }, { status: 201 });
}
