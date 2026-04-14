import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { shotId } = await params;
  const body = (await request.json()) as Partial<{
    prompt: string;
    duration: number;
    sequence: number;
    startFrameDesc: string | null;
    endFrameDesc: string | null;
    motionScript: string | null;
    cameraDirection: string;
    firstFrame: string | null;
    lastFrame: string | null;
    sceneRefFrame: string | null;
    videoPrompt: string | null;
  }>;

  const [updated] = await db
    .update(shots)
    .set(body)
    .where(eq(shots.id, shotId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { shotId } = await params;
  await db.delete(shots).where(eq(shots.id, shotId));
  return new NextResponse(null, { status: 204 });
}
