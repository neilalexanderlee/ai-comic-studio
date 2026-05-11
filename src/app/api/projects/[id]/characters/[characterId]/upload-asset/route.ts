import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

function tryDeleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { searchParams } = new URL(request.url);
  const assetId = searchParams.get("assetId");

  if (!assetId) {
    return NextResponse.json({ error: "Missing assetId" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // Fetch existing record to clean up old file when replacing
  const [existing] = await db
    .select({ imagePath: characterAssets.imagePath })
    .from(characterAssets)
    .where(eq(characterAssets.id, assetId));

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "png";
  const filename = `${ulid()}.${ext}`;
  const dir = path.join(uploadDir, "characters");
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  const [updated] = await db
    .update(characterAssets)
    .set({ imagePath: filepath })
    .where(eq(characterAssets.id, assetId))
    .returning();

  // Delete old file AFTER successful DB update so we don't lose data on error
  tryDeleteFile(existing?.imagePath);

  return NextResponse.json(updated);
}
