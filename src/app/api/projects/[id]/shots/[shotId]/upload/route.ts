import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";
import { saveArtifactAt } from "@/lib/storage/artifact-store";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const ALLOWED_FIELDS = ["anchorFirst", "anchorLastAi"] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireShotInProject(shotId, projectId);
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

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "png";
    const filename = `${ulid()}.${ext}`;
    const filepath = await saveArtifactAt(path.join(uploadDir, "frames"), filename, buffer);

    const updateFields =
      field === "anchorFirst"
        ? {
            [field as AllowedField]: filepath,
            chainSourceShotId: null,
            chainSourceType: null,
            anchorFirstContinuityMode: null,
          }
        : { [field as AllowedField]: filepath };

    const [updated] = await db
      .update(shots)
      .set(updateFields)
      .where(eq(shots.id, shotId))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    // 上传失败必须报出原因：空白 500 会让「存储配置错了」和「磁盘满了」
    // 这类完全不同的故障长得一模一样
    console.error(`[ShotUpload] shot ${shotId} field ${field}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
