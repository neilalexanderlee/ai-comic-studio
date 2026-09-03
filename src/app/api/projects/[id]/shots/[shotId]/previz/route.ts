import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shotPreviz, shots } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";

/** 列出该分镜的全部白模预演 take（新的在前）+ 当前选中的那条 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireShotInProject(shotId, projectId);
  if (!scope.ok) return scope.response;

  const [takes, [shot]] = await Promise.all([
    db
      .select()
      .from(shotPreviz)
      .where(eq(shotPreviz.shotId, shotId))
      .orderBy(desc(shotPreviz.createdAt)),
    db.select({ previzSelectedId: shots.previzSelectedId }).from(shots).where(eq(shots.id, shotId)),
  ]);

  return NextResponse.json({ takes, selectedId: shot?.previzSelectedId ?? null });
}

/** 选用某条预演（previzId 传 null 表示取消选用，本次生成就不带参考视频了） */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireShotInProject(shotId, projectId);
  if (!scope.ok) return scope.response;

  const body = (await request.json()) as { previzId: string | null };

  if (body.previzId) {
    // 二级校验：这条 previz 必须属于本分镜，否则等于允许跨分镜（乃至跨项目）挂参考视频
    const [row] = await db
      .select({ id: shotPreviz.id })
      .from(shotPreviz)
      .where(and(eq(shotPreviz.id, body.previzId), eq(shotPreviz.shotId, shotId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Previz not found" }, { status: 404 });
  }

  await db
    .update(shots)
    .set({ previzSelectedId: body.previzId })
    .where(eq(shots.id, shotId));

  return NextResponse.json({ selectedId: body.previzId });
}
