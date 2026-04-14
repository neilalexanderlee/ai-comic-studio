import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

// GET: list all project-level overrides for user and project
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const templates = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.scope, "project"),
        eq(promptTemplates.projectId, id)
      )
    );

  return NextResponse.json(templates);
}
