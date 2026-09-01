import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { extractDialoguesFromMotionScript } from "@/lib/storyboard/extract-dialogues-from-motion-script";
import { requireProjectOwner } from "@/lib/api-guard";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  const enriched = projectShots.map((shot) => ({
    ...shot,
    dialogues: extractDialoguesFromMotionScript(shot.motionScript ?? "").map((d) => ({
      id: `${shot.id}-${d.sequence}`,
      text: d.text,
      characterName: d.characterName,
      character: d.characterName,
      type: d.type,
      sequence: d.sequence,
    })),
  }));

  return NextResponse.json(enriched);
}
