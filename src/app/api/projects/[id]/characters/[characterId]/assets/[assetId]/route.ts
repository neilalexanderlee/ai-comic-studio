import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterAssets } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import fs from "node:fs";

/** Delete a file from disk, silently ignoring missing-file errors. */
function tryDeleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may already be gone — that's fine
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string; assetId: string }> }
) {
  const { characterId, assetId } = await params;
  const body = (await request.json()) as {
    tag?: string;
    isDefault?: boolean;
    imagePath?: string | null;
  };

  // When clearing the image (imagePath explicitly set to null), also delete the old file
  if (body.imagePath === null) {
    const [existing] = await db
      .select({ imagePath: characterAssets.imagePath })
      .from(characterAssets)
      .where(eq(characterAssets.id, assetId));
    tryDeleteFile(existing?.imagePath);
  }

  // When setting isDefault=true, clear isDefault on all other morph assets of same character
  // (排他性：同一角色只能有一张主定妆图)
  if (body.isDefault === true) {
    await db
      .update(characterAssets)
      .set({ isDefault: 0 })
      .where(
        and(
          eq(characterAssets.characterId, characterId),
          ne(characterAssets.id, assetId)
        )
      );
  }

  const updateData: Record<string, unknown> = {};
  if (body.tag !== undefined) updateData.tag = body.tag;
  if (body.isDefault !== undefined) updateData.isDefault = body.isDefault ? 1 : 0;
  if (body.imagePath !== undefined) updateData.imagePath = body.imagePath;

  const [updated] = await db
    .update(characterAssets)
    .set(updateData)
    .where(eq(characterAssets.id, assetId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; characterId: string; assetId: string }> }
) {
  const { assetId } = await params;

  // Fetch the record first so we can clean up the file on disk
  const [asset] = await db
    .select({ imagePath: characterAssets.imagePath })
    .from(characterAssets)
    .where(eq(characterAssets.id, assetId));

  await db.delete(characterAssets).where(eq(characterAssets.id, assetId));

  tryDeleteFile(asset?.imagePath);

  return new NextResponse(null, { status: 204 });
}
