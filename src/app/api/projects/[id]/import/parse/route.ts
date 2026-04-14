import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog, extractTextFromFile } from "@/lib/import-utils";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  await addImportLog(projectId, 1, "running", `开始解析文件: ${file.name}`);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractTextFromFile(buffer, file.name);

    if (!text.trim()) {
      await addImportLog(projectId, 1, "error", "文件内容为空");
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    await addImportLog(projectId, 1, "done", `解析完成，共 ${text.length} 字`, {
      charCount: text.length,
    });

    return NextResponse.json({ text, charCount: text.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse failed";
    await addImportLog(projectId, 1, "error", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
