import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const ALLOWED_FIELDS = ["firstFrame", "lastFrame", "sceneRefFrame"] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { shotId } = await params;
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const field = formData.get("field") as string | null;

  if (!file || !field) {
    return NextResponse.json({ error: "Missing file or field" }, { status: 400 });
  }
  if (!(ALLOWED_FIELDS as readonly string[]).includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "png";
  const filename = `${ulid()}.${ext}`;
  const dir = path.join(uploadDir, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  const [updated] = await db
    .update(shots)
    .set({ [field as AllowedField]: filepath })
    .where(eq(shots.id, shotId))
    .returning();

  return NextResponse.json(updated);
}
