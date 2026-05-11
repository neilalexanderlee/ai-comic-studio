import { db } from "@/lib/db";
import {
  characters,
  dialogues,
  episodeCharacters,
  shots,
  storyboardVersions,
} from "@/lib/db/schema";
import { normalizeCharacterName } from "./normalize-character-name";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";

type CharacterRow = typeof characters.$inferSelect;

export interface PersistableShot {
  sequence: number;
  prompt: string;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
  videoScript?: string | null;
  cameraDirection?: string | null;
  duration?: number | null;
  dialogues: Array<{ character: string; text: string; sequence?: number }>;
  warnings?: string[];
}

export async function getShotCharacters(
  projectId: string,
  episodeId?: string | null
): Promise<CharacterRow[]> {
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    if (linkedIds.length > 0) {
      return db
        .select()
        .from(characters)
        .where(inArray(characters.id, linkedIds.map((r) => r.characterId)));
    }
    // Fallback: no episode-character links (structural import path sets characters:[])
    // Use all project characters so dialogue matching still works
  }

  return db.select().from(characters).where(eq(characters.projectId, projectId));
}

function buildVersionLabel(versionNum: number): string {
  const today = new Date();
  const dateStr =
    today.getUTCFullYear().toString() +
    String(today.getUTCMonth() + 1).padStart(2, "0") +
    String(today.getUTCDate()).padStart(2, "0");
  return `${dateStr}-V${versionNum}`;
}

export async function persistStoryboardVersion(params: {
  projectId: string;
  episodeId?: string | null;
  shotCharacters: CharacterRow[];
  shots: PersistableShot[];
}): Promise<{ versionId: string; shotCount: number }> {
  const { projectId, episodeId, shotCharacters } = params;
  const versionWhereClause = episodeId
    ? and(
        eq(storyboardVersions.projectId, projectId),
        eq(storyboardVersions.episodeId, episodeId)
      )
    : eq(storyboardVersions.projectId, projectId);

  const [maxVersionRow] = await db
    .select({ maxNum: storyboardVersions.versionNum })
    .from(storyboardVersions)
    .where(versionWhereClause)
    .orderBy(desc(storyboardVersions.versionNum))
    .limit(1);
  const nextVersionNum = (maxVersionRow?.maxNum ?? 0) + 1;
  const versionId = ulid();

  await db.insert(storyboardVersions).values({
    id: versionId,
    projectId,
    label: buildVersionLabel(nextVersionNum),
    versionNum: nextVersionNum,
    createdAt: new Date(),
    episodeId: episodeId ?? null,
  });

  const charByName = new Map(
    shotCharacters.map((character) => [
      normalizeCharacterName(character.name),
      character,
    ])
  );

  // Collect character IDs that appear in matched dialogues — used below to
  // auto-update episodeCharacters so the associations reflect actual content.
  const matchedCharacterIds = new Set<string>();

  for (const shot of params.shots) {
    const shotId = ulid();
    await db.insert(shots).values({
      id: shotId,
      projectId,
      versionId,
      sequence: shot.sequence,
      prompt: shot.prompt,
      startFrameDesc: shot.startFrameDesc ?? null,
      endFrameDesc: shot.endFrameDesc ?? null,
      motionScript: shot.motionScript ?? null,
      videoScript: shot.videoScript ?? null,
      cameraDirection: shot.cameraDirection || "static",
      duration: shot.duration ?? 10,
      episodeId: episodeId ?? null,
      warnings: shot.warnings?.join("; ") || null,
    });

    for (let i = 0; i < shot.dialogues.length; i += 1) {
      const dialogue = shot.dialogues[i];
      const matchedChar = charByName.get(
        normalizeCharacterName(dialogue.character)
      );
      if (!matchedChar) continue;

      matchedCharacterIds.add(matchedChar.id);

      await db.insert(dialogues).values({
        id: ulid(),
        shotId,
        characterId: matchedChar.id,
        text: dialogue.text,
        sequence: dialogue.sequence ?? i,
      });
    }
  }

  // Auto-update episodeCharacters based on who actually spoke in this episode.
  // This replaces the unreliable text-match associations from the import step:
  // - Guest characters with dialogue → linked to this episode
  // - Main characters always appear in all episodes (no need to track per-episode)
  // We only update when episodeId is set and at least one dialogue was matched,
  // so a storyboard with no dialogue (e.g. pure action) doesn't wipe existing links.
  // Auto-update episodeCharacters for ALL characters with matched dialogue.
  // scope (main/guest) is now a pure UI label, so we track every character that
  // actually speaks in this episode regardless of their label.
  if (episodeId && matchedCharacterIds.size > 0) {
    const matchedIds = [...matchedCharacterIds];

    // Delete existing links for these characters in this episode, then re-insert
    await db
      .delete(episodeCharacters)
      .where(
        and(
          eq(episodeCharacters.episodeId, episodeId),
          inArray(episodeCharacters.characterId, matchedIds)
        )
      );
    await db.insert(episodeCharacters).values(
      matchedIds.map((charId) => ({
        id: ulid(),
        episodeId,
        characterId: charId,
      }))
    );
  }

  return { versionId, shotCount: params.shots.length };
}
