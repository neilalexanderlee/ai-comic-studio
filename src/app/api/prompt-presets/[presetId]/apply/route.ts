import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, promptVersions, promptPresets } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { BUILT_IN_PRESETS, type BuiltInPreset } from "@/lib/ai/prompts/presets";

// POST: Apply a preset's slots as overrides
export async function POST(
  request: Request,
  { params }: { params: Promise<{ presetId: string }> }
) {
  const { presetId } = await params;
  const userId = getUserIdFromRequest(request);
  const body = (await request.json()) as {
    scope?: "global" | "project";
    projectId?: string;
  };

  const scope = body.scope ?? "global";
  const projectId = body.projectId ?? null;

  // Find the preset (from BUILT_IN_PRESETS or DB)
  let presetPromptKey: string;
  let presetSlots: Record<string, string>;

  const builtIn: BuiltInPreset | undefined = BUILT_IN_PRESETS.find(
    (p) => p.id === presetId
  );

  if (builtIn) {
    presetPromptKey = builtIn.promptKey;
    presetSlots = builtIn.slots;
  } else {
    const [dbPreset] = await db
      .select()
      .from(promptPresets)
      .where(eq(promptPresets.id, presetId));

    if (!dbPreset) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }

    // Verify ownership for user presets
    if (dbPreset.userId && dbPreset.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    presetPromptKey = dbPreset.promptKey;
    presetSlots = dbPreset.slots as Record<string, string>;
  }

  // For each slot in preset.slots, upsert into prompt_templates
  const results: Record<string, unknown> = {};

  for (const [slotKey, content] of Object.entries(presetSlots)) {
    // Build the where condition based on scope
    const conditions =
      scope === "project" && projectId
        ? and(
            eq(promptTemplates.userId, userId),
            eq(promptTemplates.promptKey, presetPromptKey),
            eq(promptTemplates.slotKey, slotKey),
            eq(promptTemplates.scope, "project"),
            eq(promptTemplates.projectId, projectId)
          )
        : and(
            eq(promptTemplates.userId, userId),
            eq(promptTemplates.promptKey, presetPromptKey),
            eq(promptTemplates.slotKey, slotKey),
            eq(promptTemplates.scope, "global"),
            isNull(promptTemplates.projectId)
          );

    const [existing] = await db
      .select()
      .from(promptTemplates)
      .where(conditions);

    if (existing) {
      // Save version history before update
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
          promptKey: presetPromptKey,
          slotKey,
          scope,
          projectId: scope === "project" ? projectId : null,
          content,
        })
        .returning();

      results[slotKey] = inserted;
    }
  }

  return NextResponse.json({ success: true, results });
}
