import { db } from "@/lib/db";
import {
  characters,
  episodeCharacters,
  shots,
  storyboardVersions,
} from "@/lib/db/schema";
import { extractDialoguesFromMotionScript } from "./extract-dialogues-from-motion-script";
import { normalizeCharacterName, normalizeCharacterNameWithAge } from "./normalize-character-name";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import fs from "fs";

function tryDeleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    console.warn(`[PersistStoryboard] Failed to delete file: ${filePath}`);
  }
}

type CharacterRow = typeof characters.$inferSelect;

export interface PersistableShot {
  sequence: number;
  prompt: string;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
  cameraDirection?: string | null;
  duration?: number | null;
  /** 背景音乐注记（仅后期参考，不注入视频 prompt） */
  bgmNote?: string | null;
  /** 场景级音效提示（注入视频 prompt 供 Seedance/Kling 生成原生 SFX） */
  soundEffectNote?: string | null;
  warnings?: string[];
}

export async function getShotCharacters(
  projectId: string,
  // episodeId is kept for API compatibility but no longer used for filtering:
  // always return ALL project characters so dialogue matching never silently drops
  // a character who hasn't been linked to the episode yet.
  // episodeCharacters links are updated automatically after a successful match.
  _episodeId?: string | null
): Promise<CharacterRow[]> {
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
  /**
   * 如果传入，则清空该版本的 shots 并复用它，而不是新建版本。
   * 用于「解析分镜」时复用用户已选的空版本，避免多建一个 v3。
   */
  existingVersionId?: string | null;
}): Promise<{ versionId: string; shotCount: number }> {
  const { projectId, episodeId, shotCharacters } = params;

  let versionId: string;

  if (params.existingVersionId) {
    // 覆盖已有版本：先收集文件路径，再清空 dialogues → shots，最后删磁盘文件
    versionId = params.existingVersionId;
    const existingShots = await db
      .select({
        id: shots.id,
        anchorFirst: shots.anchorFirst,
        anchorLastAi: shots.anchorLastAi,
        videoUrl: shots.videoUrl,
        cutPoint: shots.cutPoint,
      })
      .from(shots)
      .where(eq(shots.versionId, versionId));

    await db.delete(shots).where(eq(shots.versionId, versionId));

    // 删磁盘文件（用 Set 避免相邻镜头共享文件被重复删除）
    const filesToDelete = new Set<string>();
    for (const s of existingShots) {
      if (s.anchorFirst) filesToDelete.add(s.anchorFirst);
      if (s.anchorLastAi) filesToDelete.add(s.anchorLastAi);
      if (s.videoUrl) filesToDelete.add(s.videoUrl);
      if (s.cutPoint) filesToDelete.add(s.cutPoint);
    }
    for (const filePath of filesToDelete) tryDeleteFile(filePath);

    console.log(`[PersistStoryboard] Overwrote version ${versionId}: cleared ${existingShots.length} shots, deleted ${filesToDelete.size} files`);
  } else {
    // 新建版本
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
    versionId = ulid();

    await db.insert(storyboardVersions).values({
      id: versionId,
      projectId,
      label: buildVersionLabel(nextVersionNum),
      versionNum: nextVersionNum,
      createdAt: new Date(),
      episodeId: episodeId ?? null,
    });
  }

  // Two-step character lookup maps:
  //
  // Pass 1 — exact match WITH age qualifier preserved:
  //   "角色甲（10岁）" → key "角色甲(10岁)"  matches 10-year-old variant
  //   "角色甲"         → key "角色甲"         matches adult variant
  // This prevents cross-episode contamination when both "角色甲" and "角色甲（10岁）"
  // exist in the project and the LLM output includes the age qualifier for Ep1
  // but omits it for Ep2.
  //
  // Pass 2 — base-name fallback (strips age/emotion, current behavior):
  //   Used only when Pass 1 finds no match (e.g. LLM writes "角色甲" but the project
  //   only has "角色甲（10岁）" — pick the only available variant).
  const charByExactName = new Map(
    shotCharacters.map((character) => [
      normalizeCharacterNameWithAge(character.name),
      character,
    ])
  );
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
      cameraDirection: shot.cameraDirection || "static",
      duration: shot.duration ?? 10,
      bgmNote: shot.bgmNote ?? null,
      soundEffectNote: shot.soundEffectNote ?? null,
      episodeId: episodeId ?? null,
      warnings: shot.warnings?.join("; ") || null,
    });

    // Track which characters appear in this shot's dialogue (for episodeCharacters auto-linking)
    // Dialogue data lives in motionScript brackets; no separate table insert needed.
    for (const d of extractDialoguesFromMotionScript(shot.motionScript ?? "")) {
      const matchedChar =
        charByExactName.get(normalizeCharacterNameWithAge(d.characterName)) ??
        charByName.get(normalizeCharacterName(d.characterName));
      if (matchedChar) matchedCharacterIds.add(matchedChar.id);
    }
  }

  // Rebuild episodeCharacters for this episode based on who actually spoke.
  // Full replace: first wipe ALL existing links for this episode, then insert
  // only the characters matched in this parse. This prevents stale links from
  // a previous (possibly incorrect) parse from persisting across re-parses.
  // Note: this intentionally overwrites manually-added episode links — storyboard
  // parsing is a full reset of the episode's character roster.
  if (episodeId) {
    await db
      .delete(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));

    if (matchedCharacterIds.size > 0) {
      await db.insert(episodeCharacters).values(
        [...matchedCharacterIds].map((charId) => ({
          id: ulid(),
          episodeId,
          characterId: charId,
        }))
      );
    }
  }

  return { versionId, shotCount: params.shots.length };
}
