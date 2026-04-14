import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, promptVersions } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

// GET: List all versions for a prompt's templates
export async function GET(
  request: Request,
  { params }: { params: Promise<{ promptKey: string }> }
) {
  const { promptKey } = await params;
  const userId = getUserIdFromRequest(request);

  // Get user's template records for this promptKey
  const templates = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.promptKey, promptKey)
      )
    );

  if (templates.length === 0) {
    return NextResponse.json([]);
  }

  // For each template, query prompt_versions ordered by createdAt desc
  const allVersions: Array<{
    id: string;
    templateId: string;
    slotKey: string | null;
    scope: string;
    projectId: string | null;
    content: string;
    createdAt: Date | null;
  }> = [];

  for (const template of templates) {
    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.templateId, template.id))
      .orderBy(desc(promptVersions.createdAt));

    for (const version of versions) {
      allVersions.push({
        id: version.id,
        templateId: version.templateId,
        slotKey: template.slotKey,
        scope: template.scope,
        projectId: template.projectId,
        content: version.content,
        createdAt: version.createdAt,
      });
    }
  }

  // Sort by createdAt descending
  allVersions.sort(
    (a, b) =>
      (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
  );

  return NextResponse.json(allVersions);
}
