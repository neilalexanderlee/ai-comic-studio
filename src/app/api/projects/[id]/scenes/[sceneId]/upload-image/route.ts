import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scenes, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id: projectId, sceneId } = await params;
  const userId = getUserIdFromRequest(request);
  const isAuthenticated = getAuthUserIdFromRequest(request) !== null;

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project && isAuthenticated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [scene] = await db
    .select({ id: scenes.id, imagePath: scenes.imagePath })
    .from(scenes)
    .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, projectId)));
  if (!scene) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // Save to project-specific scenes directory
  const sceneDir = path.join(uploadDir, "projects", projectId, "scenes");
  fs.mkdirSync(sceneDir, { recursive: true });

  const ext = path.extname(file.name) || ".png";
  const fileName = `${ulid()}${ext}`;
  const filePath = path.join(sceneDir, fileName);
  const relativePath = path.join("uploads", "projects", projectId, "scenes", fileName);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  // Delete old file if exists
  if (scene.imagePath) {
    try { fs.unlinkSync(scene.imagePath); } catch { /* already gone */ }
  }

  await db.update(scenes).set({ imagePath: relativePath }).where(eq(scenes.id, sceneId));

  return NextResponse.json({ imagePath: relativePath });
}
