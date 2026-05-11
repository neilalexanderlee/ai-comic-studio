import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, episodeCharacters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { characterId } = await params;
  const body = (await request.json()) as Partial<{
    name: string;
    description: string;
    visualHint: string;
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
  _request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { characterId } = await params;
  await db.delete(characters).where(eq(characters.id, characterId));
  return new NextResponse(null, { status: 204 });
}
