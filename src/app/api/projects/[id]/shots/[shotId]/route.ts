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
    anchorFirst: string | null;
    anchorLastAi: string | null;
    videoPrompt: string | null;
  }>;

  if (Object.keys(body).length > 0) {
    // 用户手动编辑 videoPrompt 时，将 videoPromptFrameFingerprint 设为哨兵值 "__manual__"。
    // shouldRefreshVideoPrompt 看到 "__manual__" 直接跳过自动刷新，无论帧文件此后是否变化。
    // 用户显式点「生成提示词」时会写入真实指纹，覆盖 "__manual__"，恢复自动刷新能力。
    if ("videoPrompt" in body && body.videoPrompt != null) {
      (body as Record<string, unknown>).videoPromptFrameFingerprint = "__manual__";
    }

    const [updated] = await db
      .update(shots)
      .set(body)
      .where(eq(shots.id, shotId))
      .returning();
    return NextResponse.json(updated);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { shotId } = await params;
  await db.delete(shots).where(eq(shots.id, shotId));
  return new NextResponse(null, { status: 204 });
}
