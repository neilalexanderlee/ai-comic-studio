import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { characterId } = await params;
  const body = (await request.json()) as {
    imagePath?: string | null;
    tag?: string;
    assetType?: "morph" | "blueprint";
    isDefault?: boolean;
  };

  const newAsset = await db
    .insert(characterAssets)
    .values({
      id: ulid(),
      characterId,
      // 新建形态可先无图；DB 列为 NOT NULL，用空串表示「尚未上传」
      imagePath: body.imagePath ?? "",
      tag: body.tag || "日常",
      assetType: body.assetType || "morph",
      isDefault: body.isDefault ? 1 : 0,
    })
    .returning();

  return NextResponse.json(newAsset[0]);
}
