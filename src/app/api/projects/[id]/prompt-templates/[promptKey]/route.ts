import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, promptVersions, projects } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";

// PUT: save project-level override (slots mode or full mode)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; promptKey: string }> }
) {
  const { id, promptKey } = await params;
  const userId = getUserIdFromRequest(request);

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    mode: "slots" | "full";
    slots?: Record<string, string>;
    content?: string;
  };

  if (body.mode === "slots") {
    if (!body.slots || typeof body.slots !== "object") {
      return NextResponse.json(
        { error: "slots is required in slots mode" },
        { status: 400 }
      );
    }

    const results: Record<string, unknown> = {};

    for (const [slotKey, content] of Object.entries(body.slots)) {
      // Check if record exists
      const [existing] = await db
        .select()
        .from(promptTemplates)
        .where(
          and(
            eq(promptTemplates.userId, userId),
            eq(promptTemplates.promptKey, promptKey),
            eq(promptTemplates.slotKey, slotKey),
            eq(promptTemplates.scope, "project"),
            eq(promptTemplates.projectId, id)
          )
        );

      if (existing) {
        // Save current content as a version before updating
        await db.insert(promptVersions).values({
          id: ulid(),
          templateId: existing.id,
          content: existing.content,
        });

        // Update the existing record
        const [updated] = await db
          .update(promptTemplates)
          .set({ content, updatedAt: new Date() })
          .where(eq(promptTemplates.id, existing.id))
          .returning();
        results[slotKey] = updated;
      } else {
        // Insert a new record
        const [inserted] = await db
          .insert(promptTemplates)
          .values({
            id: ulid(),
            userId,
            promptKey,
            slotKey,
            scope: "project",
            projectId: id,
            content,
          })
          .returning();
        results[slotKey] = inserted;
      }
    }

    return NextResponse.json(results);
  }

  if (body.mode === "full") {
    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "content is required in full mode" },
        { status: 400 }
      );
    }

    // Check if a full-prompt record exists (slotKey = null)
    const [existing] = await db
      .select()
      .from(promptTemplates)
      .where(
        and(
          eq(promptTemplates.userId, userId),
          eq(promptTemplates.promptKey, promptKey),
          isNull(promptTemplates.slotKey),
          eq(promptTemplates.scope, "project"),
          eq(promptTemplates.projectId, id)
        )
      );

    if (existing) {
      // Save current content as a version before updating
      await db.insert(promptVersions).values({
        id: ulid(),
        templateId: existing.id,
        content: existing.content,
      });

      const [updated] = await db
        .update(promptTemplates)
        .set({ content: body.content, updatedAt: new Date() })
        .where(eq(promptTemplates.id, existing.id))
        .returning();

      return NextResponse.json(updated);
    } else {
      const [inserted] = await db
        .insert(promptTemplates)
        .values({
          id: ulid(),
          userId,
          promptKey,
          slotKey: null,
          scope: "project",
          projectId: id,
          content: body.content,
        })
        .returning();

      return NextResponse.json(inserted, { status: 201 });
    }
  }

  return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
}

// DELETE: remove all project-level templates for this promptKey + userId + projectId
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; promptKey: string }> }
) {
  const { id, promptKey } = await params;
  const userId = getUserIdFromRequest(request);

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.promptKey, promptKey),
        eq(promptTemplates.scope, "project"),
        eq(promptTemplates.projectId, id)
      )
    );

  return new NextResponse(null, { status: 204 });
}
