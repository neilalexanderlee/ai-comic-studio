import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";

/**
 * POST /api/projects/[id]/shots/[shotId]/split
 *
 * Splits a shot whose duration exceeds the video model's max into N sub-shots.
 * Each sub-shot inherits prompt / videoScript / motionScript from the original.
 * Sub-shots are inserted right after the original's sequence position; all
 * subsequent shots in the same episode/version are shifted up.
 *
 * Body: { maxDuration: number }   (the model's max, e.g. 15)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  getUserIdFromRequest(request); // auth check (throws if missing)

  const body = (await request.json()) as { maxDuration?: number };
  const maxDuration = Math.max(5, body.maxDuration ?? 15);

  // 1. Load the original shot
  const [original] = await db
    .select()
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));

  if (!original) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const totalDuration = original.duration ?? 10;

  if (totalDuration <= maxDuration) {
    return NextResponse.json({ error: "Shot duration is already within limit" }, { status: 400 });
  }

  // 2. Calculate split: how many sub-shots, and each duration
  const n = Math.ceil(totalDuration / maxDuration);
  // Distribute evenly; last shot gets the remainder
  const baseDuration = Math.floor(totalDuration / n);
  const remainder = totalDuration - baseDuration * n;

  // 3. Shift all later shots' sequence up by (n - 1) to make room
  const slotsNeeded = n - 1; // we replace 1 shot with n shots
  if (slotsNeeded > 0) {
    await db
      .update(shots)
      .set({ sequence: shots.sequence } as never) // placeholder — use raw SQL via loop
      .where(eq(shots.id, "NOOP")); // avoid unused import warning

    // Shift shots that come after the original
    const laterShots = await db
      .select({ id: shots.id, sequence: shots.sequence })
      .from(shots)
      .where(
        and(
          eq(shots.projectId, projectId),
          eq(shots.episodeId, original.episodeId!),
          original.versionId
            ? eq(shots.versionId, original.versionId)
            : eq(shots.versionId, null as never),
          gte(shots.sequence, original.sequence + 1)
        )
      );

    // Update in reverse order to avoid unique constraint collisions
    const sorted = laterShots.sort((a, b) => b.sequence - a.sequence);
    for (const s of sorted) {
      await db
        .update(shots)
        .set({ sequence: s.sequence + slotsNeeded })
        .where(eq(shots.id, s.id));
    }
  }

  // 4. Update original shot to have duration of first sub-shot
  const firstDuration = baseDuration + (0 < remainder ? 1 : 0);
  await db
    .update(shots)
    .set({
      duration: firstDuration,
      status: "pending",
      anchorFirst: null,
      anchorLastAi: null,
      videoUrl: null,
      cutPoint: null,
      lastFrameUrl: null,
      videoPrompt: null,
    })
    .where(eq(shots.id, shotId));

  // 5. Insert the remaining (n-1) sub-shots
  const created = [];
  for (let i = 1; i < n; i++) {
    const subDuration = baseDuration + (i < remainder ? 1 : 0);
    const [newShot] = await db
      .insert(shots)
      .values({
        id: ulid(),
        projectId,
        episodeId: original.episodeId,
        versionId: original.versionId,
        sequence: original.sequence + i,
        prompt: original.prompt ?? "",
        startFrameDesc: null,   // sub-shots need new frames
        endFrameDesc: null,
        motionScript: original.motionScript,
        videoScript: original.videoScript,
        cameraDirection: original.cameraDirection ?? "static",
        duration: subDuration,
        status: "pending",
      })
      .returning();
    created.push(newShot);
  }

  return NextResponse.json({ splits: n, created: created.length }, { status: 201 });
}
