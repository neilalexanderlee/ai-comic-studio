import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptPresets } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

// DELETE: Remove a user preset
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ presetId: string }> }
) {
  const { presetId } = await params;
  const userId = getUserIdFromRequest(request);

  // Verify the preset belongs to this user (userId matches)
  const [existing] = await db
    .select()
    .from(promptPresets)
    .where(
      and(eq(promptPresets.id, presetId), eq(promptPresets.userId, userId))
    );

  if (!existing) {
    return NextResponse.json(
      { error: "Preset not found or not owned by user" },
      { status: 404 }
    );
  }

  await db
    .delete(promptPresets)
    .where(
      and(eq(promptPresets.id, presetId), eq(promptPresets.userId, userId))
    );

  return new NextResponse(null, { status: 204 });
}
