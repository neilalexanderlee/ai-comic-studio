import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, characters, shots, dialogues, storyboardVersions } from "@/lib/db/schema";
import { eq, asc, and, desc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

async function resolveProject(id: string, userId: string) {
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
  const project = await resolveProject(id, userId);

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

  // Fetch related data
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, id));

  const projectShots = resolvedVersionId
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, id), eq(shots.versionId, resolvedVersionId)))
        .orderBy(asc(shots.sequence))
    : [];

  // Enrich each shot with its dialogues (including character name)
  const enrichedShots = await Promise.all(
    projectShots.map(async (shot) => {
      const shotDialogues = await db
        .select({
          id: dialogues.id,
          text: dialogues.text,
          characterId: dialogues.characterId,
          characterName: characters.name,
          sequence: dialogues.sequence,
        })
        .from(dialogues)
        .innerJoin(characters, eq(dialogues.characterId, characters.id))
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));
      return { ...shot, dialogues: shotDialogues };
    })
  );

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
  const project = await resolveProject(id, userId);

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
  }>;

  const { title, idea, script, status, generationMode, useProjectPrompts } = body;

  const [updated] = await db
    .update(projects)
    .set({
      ...(title !== undefined && { title }),
      ...(idea !== undefined && { idea }),
      ...(script !== undefined && { script }),
      ...(status !== undefined && { status }),
      ...(generationMode !== undefined && { generationMode }),
      ...(useProjectPrompts !== undefined && { useProjectPrompts }),
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
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(projects).where(eq(projects.id, id));
  return new NextResponse(null, { status: 204 });
}
