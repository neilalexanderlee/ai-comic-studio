import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { ulid } from "ulid";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";

/**
 * POST /api/projects/[id]/shots/[shotId]/split
 *
 * Splits a shot whose duration exceeds the video model's max into N sub-shots.
 * Each sub-shot inherits prompt / motionScript from the original.
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
  // 这里原本只写了一句 `getUserIdFromRequest(request); // auth check (throws if missing)` ——
  // 那个注释是错的，该函数从不抛异常、只返回空串，返回值又被丢弃。
  // 结果是：知道 projectId + shotId 就能把**别人的**分镜拆掉（约定 8b 的两级校验一级都没做）。
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const shotGuard = await requireShotInProject(shotId, projectId);
  if (!shotGuard.ok) return shotGuard.response;

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
  // 先将 totalDuration 取整（Seedance 只接受整数秒）
  const totalDurationInt = Math.ceil(totalDuration);
  const n = Math.ceil(totalDurationInt / maxDuration);
  // Distribute evenly; last shot gets the remainder
  const baseDuration = Math.floor(totalDurationInt / n);
  const remainder = totalDurationInt - baseDuration * n;

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
        cameraDirection: original.cameraDirection ?? "static",
        duration: subDuration,
        status: "pending",
      })
      .returning();
    created.push(newShot);
  }

  return NextResponse.json({ splits: n, created: created.length }, { status: 201 });
}
