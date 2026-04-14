import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots, characters, episodeCharacters } from "@/lib/db/schema";
import { eq, asc, and, max, isNotNull, inArray } from "drizzle-orm";
import { ulid } from "ulid";
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

  const allEpisodes = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  // Enrich each episode with preview images for cards
  const enriched = await Promise.all(
    allEpisodes.map(async (ep) => {
      if (ep.finalVideoUrl) return { ...ep, previewImages: [] };

      // 1) Collect frame images from shots, deduplicated
      const epShots = await db
        .select({
          firstFrame: shots.firstFrame,
          lastFrame: shots.lastFrame,
          sceneRefFrame: shots.sceneRefFrame,
        })
        .from(shots)
        .where(eq(shots.episodeId, ep.id));

      const frameSet = new Set<string>();
      const isReference = ep.generationMode === "reference";
      for (const s of epShots) {
        if (isReference) {
          if (s.sceneRefFrame) frameSet.add(s.sceneRefFrame);
        } else {
          if (s.firstFrame) frameSet.add(s.firstFrame);
          if (s.lastFrame) frameSet.add(s.lastFrame);
        }
      }

      if (frameSet.size > 0) {
        return { ...ep, previewImages: [...frameSet] };
      }

      // 2) Fall back to character reference images linked to this episode
      const linkedCharIds = await db
        .select({ characterId: episodeCharacters.characterId })
        .from(episodeCharacters)
        .where(eq(episodeCharacters.episodeId, ep.id));

      let charUrls: string[] = [];
      if (linkedCharIds.length > 0) {
        const charImages = await db
          .select({ referenceImage: characters.referenceImage })
          .from(characters)
          .where(
            and(
              inArray(characters.id, linkedCharIds.map((r) => r.characterId)),
              isNotNull(characters.referenceImage)
            )
          );
        charUrls = charImages.map((c) => c.referenceImage!).filter(Boolean);
      }

      return { ...ep, previewImages: charUrls };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as { title: string; description?: string; keywords?: string };

  // Get the max sequence number for this project
  const [result] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, id));

  const nextSequence = (result?.maxSeq ?? 0) + 1;

  const [episode] = await db
    .insert(episodes)
    .values({
      id: ulid(),
      projectId: id,
      title: body.title,
      description: body.description || "",
      keywords: body.keywords || "",
      sequence: nextSequence,
    })
    .returning();

  return NextResponse.json(episode, { status: 201 });
}
