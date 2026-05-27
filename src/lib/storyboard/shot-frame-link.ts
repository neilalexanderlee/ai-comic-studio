import { db } from "@/lib/db";
import { episodes, shots } from "@/lib/db/schema";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";
import type { FrameReferenceType } from "@/lib/storyboard/frame-reference";
import {
  resolveChainFramePath,
  shotFrameFileOnDisk,
} from "@/lib/storyboard/frame-reference.server";
type ShotRow = typeof shots.$inferSelect;
type CharacterRow = { id: string; name: string; description?: string | null; visualHint?: string | null };

function buildShotCharacterText(shot: {
  prompt?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
  videoScript?: string | null;
}): string {
  return [
    shot.prompt,
    shot.startFrameDesc,
    shot.endFrameDesc,
    shot.motionScript,
    shot.videoScript,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isCrowdToCharacterCut(
  prevShot: ShotRow | null | undefined,
  nextShot: ShotRow,
  characters: CharacterRow[],
  contextText?: string
): boolean {
  if (!prevShot) return false;
  const prevChars = filterShotCharacters(buildShotCharacterText(prevShot), characters, {
    contextText,
  });
  const nextChars = filterShotCharacters(buildShotCharacterText(nextShot), characters, {
    contextText,
  });
  return prevChars.length === 0 && nextChars.length > 0;
}

async function findNextShotInEpisode(current: ShotRow): Promise<ShotRow | undefined> {
  const conditions = [
    eq(shots.projectId, current.projectId),
    gt(shots.sequence, current.sequence),
  ];
  if (current.versionId) conditions.push(eq(shots.versionId, current.versionId));
  if (current.episodeId) conditions.push(eq(shots.episodeId, current.episodeId));

  const [next] = await db
    .select()
    .from(shots)
    .where(and(...conditions))
    .orderBy(asc(shots.sequence))
    .limit(1);
  return next;
}

/** D3: 路径直拷 — 将 source 的 cut_point 写入 target.anchor_first */
export async function linkNextShotAnchorFromCutPoint(params: {
  sourceShot: ShotRow;
  characters: CharacterRow[];
  characterContextText?: string;
}): Promise<{ linked: boolean; nextShotId?: string; nextSequence?: number; reason?: string }> {
  const cutPath = resolveChainFramePath(params.sourceShot);
  if (!cutPath || !shotFrameFileOnDisk(cutPath)) {
    return { linked: false, reason: "no_valid_cut_point" };
  }

  const nextShot = await findNextShotInEpisode(params.sourceShot);
  if (!nextShot) {
    return { linked: false, reason: "no_next_shot" };
  }

  if (
    isCrowdToCharacterCut(
      params.sourceShot,
      nextShot,
      params.characters,
      params.characterContextText
    )
  ) {
    return { linked: false, reason: "crowd_to_character_cut" };
  }

  await db
    .update(shots)
    .set({
      anchorFirst: cutPath,
      chainSourceShotId: params.sourceShot.id,
      chainSourceType: "cut_point" satisfies FrameReferenceType,
    })
    .where(eq(shots.id, nextShot.id));

  console.log(
    `[ShotFrameLink] Shot ${params.sourceShot.sequence} cut_point → shot ${nextShot.sequence} anchor_first`
  );
  return { linked: true, nextShotId: nextShot.id, nextSequence: nextShot.sequence };
}

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
  if (!path || !shotFrameFileOnDisk(path)) return {};

  const sourceType: FrameReferenceType = lastShot.cutPoint && shotFrameFileOnDisk(lastShot.cutPoint)
    ? "cut_point"
    : "anchor_last_ai";

  return { path, sourceShotId: lastShot.id, sourceType };
}
