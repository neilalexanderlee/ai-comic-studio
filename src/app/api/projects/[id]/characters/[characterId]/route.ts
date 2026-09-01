import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, episodeCharacters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { requireProjectOwner, requireCharacterInProject } from "@/lib/api-guard";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireCharacterInProject(characterId, projectId);
  if (!scope.ok) return scope.response;
  const body = (await request.json()) as Partial<{
    name: string;
    description: string;
    visualHint: string;
    voiceHint: string;
    scope: string;
    episodeId: string | null;
    /** Replace all episode associations for this character */
    episodeIds: string[];
  }>;

  // Update episode_characters table when episodeIds is provided
  if (body.episodeIds !== undefined) {
    await db
      .delete(episodeCharacters)
      .where(eq(episodeCharacters.characterId, characterId));

    if (body.episodeIds.length > 0) {
      await db.insert(episodeCharacters).values(
        body.episodeIds.map((epId) => ({
          id: ulid(),
          episodeId: epId,
          characterId,
        }))
      );
    }
  }

  // Update character fields
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.visualHint !== undefined) updateData.visualHint = body.visualHint;
  if (body.voiceHint !== undefined) updateData.voiceHint = body.voiceHint;
  if (body.scope !== undefined) {
    updateData.scope = body.scope;
    if (body.scope === "main") {
      updateData.episodeId = null;
    }
  }
  if (body.episodeId !== undefined && body.scope !== "main") {
    updateData.episodeId = body.episodeId;
  }

  const [updated] = await db
    .update(characters)
    .set(updateData)
    .where(eq(characters.id, characterId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireCharacterInProject(characterId, projectId);
  if (!scope.ok) return scope.response;
  await db.delete(characters).where(eq(characters.id, characterId));
  return new NextResponse(null, { status: 204 });
}
