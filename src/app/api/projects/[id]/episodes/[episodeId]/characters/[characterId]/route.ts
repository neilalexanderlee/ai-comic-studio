import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { episodeCharacters } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * DELETE /api/projects/:id/episodes/:episodeId/characters/:characterId
 * 将角色从本集解绑（删除 episode_characters 关联行），不删除角色本身。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string; characterId: string }> }
) {
  const { episodeId, characterId } = await params;
  await db
    .delete(episodeCharacters)
    .where(
      and(
        eq(episodeCharacters.episodeId, episodeId),
        eq(episodeCharacters.characterId, characterId)
      )
    );
  return new NextResponse(null, { status: 204 });
}

/**
 * POST /api/projects/:id/episodes/:episodeId/characters/:characterId
 * 将角色绑定到本集（插入 episode_characters 关联行，已存在则忽略）。
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string; characterId: string }> }
) {
  const { episodeId, characterId } = await params;
  // ignore duplicate key errors
  try {
    await db.insert(episodeCharacters).values({
      id: crypto.randomUUID(),
      episodeId,
      characterId,
    });
  } catch {
    // already linked — not an error
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
