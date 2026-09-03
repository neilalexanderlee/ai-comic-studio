import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shotPreviz, shots } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";
import { deleteArtifact } from "@/lib/storage/artifact-store";

/** 删除一条预演 take（连同它的视频与封面产物） */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string; previzId: string }> }
) {
  const { id: projectId, shotId, previzId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireShotInProject(shotId, projectId);
  if (!scope.ok) return scope.response;

  // 二级校验：previz 必须属于本分镜
  const [row] = await db
    .select()
    .from(shotPreviz)
    .where(and(eq(shotPreviz.id, previzId), eq(shotPreviz.shotId, shotId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Previz not found" }, { status: 404 });

  // 先摘掉选中关系再删记录：反过来的话，中途失败会留下指向不存在记录的选中 id
  await db
    .update(shots)
    .set({ previzSelectedId: null })
    .where(and(eq(shots.id, shotId), eq(shots.previzSelectedId, previzId)));
  await db.delete(shotPreviz).where(eq(shotPreviz.id, previzId));

  // 产物删除放最后且不阻断：DB 记录没了就已经不可见，残留文件由 prune 脚本兜底
  for (const ref of [row.videoUrl, row.posterUrl]) {
    try {
      await deleteArtifact(ref);
    } catch (err) {
      console.warn(`[Previz] 删除产物失败（不影响记录删除）：${ref}`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
