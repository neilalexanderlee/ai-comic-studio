import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string; assetId: string }> }
) {
  const { assetId } = await params;
  const body = (await request.json()) as {
    tag?: string;
    isDefault?: boolean;
    imagePath?: string;
  };

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
  await db.delete(characterAssets).where(eq(characterAssets.id, assetId));
  return new NextResponse(null, { status: 204 });
}
