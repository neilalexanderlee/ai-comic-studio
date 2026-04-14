import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, promptVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";

// POST: Restore a specific version
export async function POST(
  request: Request,
  { params }: { params: Promise<{ promptKey: string; vid: string }> }
) {
  const { vid } = await params;
  const userId = getUserIdFromRequest(request);

  // Find the version record
  const [version] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.id, vid));

  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  // Find its parent template
  const [template] = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.id, version.templateId));

  if (!template) {
    return NextResponse.json(
      { error: "Parent template not found" },
      { status: 404 }
    );
  }

  // Verify ownership
  if (template.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Save current content as a new version (for undo)
  await db.insert(promptVersions).values({
    id: ulid(),
    templateId: template.id,
    content: template.content,
  });

  // Update template content with the version's content
  const [updated] = await db
    .update(promptTemplates)
    .set({ content: version.content, updatedAt: new Date() })
    .where(eq(promptTemplates.id, template.id))
    .returning();

  return NextResponse.json({ success: true, template: updated });
}
