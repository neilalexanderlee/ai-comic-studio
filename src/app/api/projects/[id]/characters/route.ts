import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, characterAssets, episodeCharacters } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const projectChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const charIds = projectChars.map((c) => c.id);
  const links =
    charIds.length === 0
      ? []
      : await db
          .select({
            characterId: episodeCharacters.characterId,
            episodeId: episodeCharacters.episodeId,
          })
          .from(episodeCharacters)
          .where(inArray(episodeCharacters.characterId, charIds));

  const episodeIdsByChar = new Map<string, string[]>();
  for (const row of links) {
    const list = episodeIdsByChar.get(row.characterId) ?? [];
    list.push(row.episodeId);
    episodeIdsByChar.set(row.characterId, list);
  }

  const result = await Promise.all(
    projectChars.map(async (char) => {
      const assets = await db
        .select()
        .from(characterAssets)
        .where(eq(characterAssets.characterId, char.id));
      return {
        ...char,
        assets,
        episodeIds: episodeIdsByChar.get(char.id) ?? [],
      };
    })
  );

  return NextResponse.json(result);
}
