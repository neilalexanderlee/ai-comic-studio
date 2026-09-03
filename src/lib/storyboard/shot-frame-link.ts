import { db } from "@/lib/db";
import { episodes, shots } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { FrameReferenceType } from "@/lib/storyboard/frame-reference";
import {
  resolveChainFramePath,
  shotFrameUsable,
} from "@/lib/storyboard/frame-reference.server";

/** D2: 上一集最后一镜的 cut_point（或 AI 尾帧）路径 */
export async function resolvePreviousEpisodeTailFrame(params: {
  projectId: string;
  episodeId: string;
  versionId?: string | null;
}): Promise<{ path?: string; sourceShotId?: string; sourceType?: FrameReferenceType }> {
  const [currentEp] = await db
    .select({ sequence: episodes.sequence })
    .from(episodes)
    .where(and(eq(episodes.id, params.episodeId), eq(episodes.projectId, params.projectId)));

  if (!currentEp || currentEp.sequence <= 1) {
    return {};
  }

  const [prevEp] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.projectId, params.projectId),
        eq(episodes.sequence, currentEp.sequence - 1)
      )
    );

  if (!prevEp) return {};

  const lastShotConditions = [
    eq(shots.projectId, params.projectId),
    eq(shots.episodeId, prevEp.id),
  ];
  if (params.versionId) lastShotConditions.push(eq(shots.versionId, params.versionId));

  const [lastShot] = await db
    .select()
    .from(shots)
    .where(and(...lastShotConditions))
    .orderBy(desc(shots.sequence))
    .limit(1);

  if (!lastShot) return {};

  const path = resolveChainFramePath(lastShot);
  if (!path || !shotFrameUsable(path)) return {};

  const sourceType: FrameReferenceType = lastShot.cutPoint && shotFrameUsable(lastShot.cutPoint)
    ? "cut_point"
    : "anchor_last_ai";

  return { path, sourceShotId: lastShot.id, sourceType };
}
