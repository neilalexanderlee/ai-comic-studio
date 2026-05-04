import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters, characterAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const projectChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const result = await Promise.all(
    projectChars.map(async (char) => {
      const assets = await db
        .select()
        .from(characterAssets)
        .where(eq(characterAssets.characterId, char.id));
      return { ...char, assets };
    })
  );

  return NextResponse.json(result);
}
