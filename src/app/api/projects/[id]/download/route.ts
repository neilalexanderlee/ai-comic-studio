import { db } from "@/lib/db";
import { projects, shots } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import archiver from "archiver";
import path from "node:path";
import fs from "node:fs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return new Response("No shots to download", { status: 400 });
  }

  const archive = archiver("zip", { zlib: { level: 5 } });
  const chunks: Uint8Array[] = [];

  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  for (const shot of allShots) {
    const prefix = `shot-${String(shot.sequence).padStart(2, "0")}`;

    if (shot.firstFrame) {
      const abs = path.resolve(shot.firstFrame);
      if (fs.existsSync(abs)) {
        const ext = path.extname(abs) || ".png";
        archive.file(abs, { name: `${prefix}/first-frame${ext}` });
      }
    }
    if (shot.lastFrame) {
      const abs = path.resolve(shot.lastFrame);
      if (fs.existsSync(abs)) {
        const ext = path.extname(abs) || ".png";
        archive.file(abs, { name: `${prefix}/last-frame${ext}` });
      }
    }
    if (shot.videoUrl) {
      const abs = path.resolve(shot.videoUrl);
      if (fs.existsSync(abs)) {
        const ext = path.extname(abs) || ".mp4";
        archive.file(abs, { name: `${prefix}/video${ext}` });
      }
    }
  }

  await archive.finalize();

  const buffer = Buffer.concat(chunks);
  const safeName = (project.title || "project").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}-storyboard.zip"`,
    },
  });
}
