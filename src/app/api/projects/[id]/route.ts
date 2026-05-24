import { NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { projects, episodes, characters, characterAssets, shots, dialogues, storyboardVersions, shotVideoHistory } from "@/lib/db/schema";
import { eq, asc, and, desc, inArray } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";

function tryDeleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore — file may already be gone
  }
}

async function resolveProject(id: string, userId: string, isAuthenticated: boolean) {
  if (!isAuthenticated) {
    await reclaimLocalProjectsForUser(userId);
  }
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return project ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId, getAuthUserIdFromRequest(request) !== null);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const versionId = url.searchParams.get("versionId") ?? undefined;

  // Fetch all versions for this project (newest first)
  const allVersions = await db
    .select()
    .from(storyboardVersions)
    .where(eq(storyboardVersions.projectId, id))
    .orderBy(desc(storyboardVersions.versionNum));

  // Resolve which version to show shots for
  const resolvedVersionId = versionId ?? allVersions[0]?.id;

  // Fetch related data — batch queries to avoid N+1
  const projectCharactersRaw = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, id));

  // Batch fetch all assets for all characters in one query
  const charIds = projectCharactersRaw.map((c) => c.id);
  const allAssets = charIds.length > 0
    ? await db.select().from(characterAssets).where(inArray(characterAssets.characterId, charIds))
    : [];
  const assetsByCharId = new Map<string, typeof allAssets>();
  for (const asset of allAssets) {
    const list = assetsByCharId.get(asset.characterId) ?? [];
    list.push(asset);
    assetsByCharId.set(asset.characterId, list);
  }
  const projectCharacters = projectCharactersRaw.map((char) => ({
    ...char,
    assets: assetsByCharId.get(char.id) ?? [],
  }));

  const projectShots = resolvedVersionId
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, id), eq(shots.versionId, resolvedVersionId)))
        .orderBy(asc(shots.sequence))
    : [];

  // Batch fetch all dialogues for all shots in one query
  const shotIds = projectShots.map((s) => s.id);
  const allDialogues = shotIds.length > 0
    ? await db
        .select({
          id: dialogues.id,
          shotId: dialogues.shotId,
          text: dialogues.text,
          characterId: dialogues.characterId,
          characterName: characters.name,
          sequence: dialogues.sequence,
        })
        .from(dialogues)
        .innerJoin(characters, eq(dialogues.characterId, characters.id))
        .where(inArray(dialogues.shotId, shotIds))
        .orderBy(asc(dialogues.sequence))
    : [];
  const dialoguesByShotId = new Map<string, typeof allDialogues>();
  for (const d of allDialogues) {
    const list = dialoguesByShotId.get(d.shotId) ?? [];
    list.push(d);
    dialoguesByShotId.set(d.shotId, list);
  }
  const enrichedShots = projectShots.map((shot) => ({
    ...shot,
    dialogues: dialoguesByShotId.get(shot.id) ?? [],
  }));

  // Fetch episodes for this project
  const projectEpisodes = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  return NextResponse.json({
    ...project,
    episodes: projectEpisodes,
    characters: projectCharacters,
    shots: enrichedShots,
    versions: allVersions.map((v) => ({
      id: v.id,
      label: v.label,
      versionNum: v.versionNum,
      createdAt: v.createdAt instanceof Date ? Math.floor(v.createdAt.getTime() / 1000) : v.createdAt,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId, getAuthUserIdFromRequest(request) !== null);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    title: string;
    idea: string;
    script: string;
    status: "draft" | "processing" | "completed";
    generationMode: "keyframe" | "reference";
    useProjectPrompts: number;
    enhancePrompts: number;
    visualStyle: string;
    styleReferenceImage: string | null;
  }>;

  const { title, idea, script, status, generationMode, useProjectPrompts, enhancePrompts, visualStyle, styleReferenceImage } = body;

  const [updated] = await db
    .update(projects)
    .set({
      ...(title !== undefined && { title }),
      ...(idea !== undefined && { idea }),
      ...(script !== undefined && { script }),
      ...(status !== undefined && { status }),
      ...(generationMode !== undefined && { generationMode }),
      ...(useProjectPrompts !== undefined && { useProjectPrompts }),
      ...(enhancePrompts !== undefined && { enhancePrompts }),
      ...(visualStyle !== undefined && { visualStyle }),
      ...(styleReferenceImage !== undefined && { styleReferenceImage }),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId, getAuthUserIdFromRequest(request) !== null);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 1. Collect all file paths before deleting DB records

  // Project final video
  tryDeleteFile(project.finalVideoUrl);

  // Character images (referenceImage / beautyImage / combatImage)
  const projectCharacters = await db
    .select({ referenceImage: characters.referenceImage, beautyImage: characters.beautyImage, combatImage: characters.combatImage, id: characters.id })
    .from(characters)
    .where(eq(characters.projectId, id));

  for (const char of projectCharacters) {
    tryDeleteFile(char.referenceImage);
    tryDeleteFile(char.beautyImage);
    tryDeleteFile(char.combatImage);

    // characterAssets (morph / blueprint images)
    const assets = await db
      .select({ imagePath: characterAssets.imagePath })
      .from(characterAssets)
      .where(eq(characterAssets.characterId, char.id));
    for (const asset of assets) {
      tryDeleteFile(asset.imagePath);
    }
  }

  // Shot frames, videos, and history videos
  const projectShots = await db
    .select({ id: shots.id, firstFrame: shots.firstFrame, lastFrame: shots.lastFrame, sceneRefFrame: shots.sceneRefFrame, videoUrl: shots.videoUrl, referenceVideoUrl: shots.referenceVideoUrl })
    .from(shots)
    .where(eq(shots.projectId, id));

  for (const shot of projectShots) {
    tryDeleteFile(shot.firstFrame);
    tryDeleteFile(shot.lastFrame);
    tryDeleteFile(shot.sceneRefFrame);
    tryDeleteFile(shot.videoUrl);
    tryDeleteFile(shot.referenceVideoUrl);

    // 清理历史视频文件（DB 记录因 CASCADE 自动删，但文件需要手动清理）
    const historyEntries = await db
      .select({ videoUrl: shotVideoHistory.videoUrl })
      .from(shotVideoHistory)
      .where(eq(shotVideoHistory.shotId, shot.id));
    for (const entry of historyEntries) {
      tryDeleteFile(entry.videoUrl);
    }
  }

  // 2. Delete DB record — cascade handles all child tables
  await db.delete(projects).where(eq(projects.id, id));
  return new NextResponse(null, { status: 204 });
}
