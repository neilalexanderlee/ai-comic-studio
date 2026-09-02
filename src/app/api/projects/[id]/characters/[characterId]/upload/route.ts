import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { requireProjectOwner, requireCharacterInProject } from "@/lib/api-guard";
import { saveArtifactAt } from "@/lib/storage/artifact-store";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const ALLOWED_FIELDS = ["referenceImage", "beautyImage", "combatImage"] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireCharacterInProject(characterId, projectId);
  if (!scope.ok) return scope.response;
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
  const filepath = await saveArtifactAt(path.join(uploadDir, "characters"), filename, buffer);

  const [updated] = await db
    .update(characters)
    .set({ [field as AllowedField]: filepath })
    .where(eq(characters.id, characterId))
    .returning();

  return NextResponse.json(updated);
}
