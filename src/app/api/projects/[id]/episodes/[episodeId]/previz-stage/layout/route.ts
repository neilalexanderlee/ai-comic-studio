import { NextResponse } from "next/server";
import path from "node:path";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";
import { deleteArtifact, saveArtifactAt } from "@/lib/storage/artifact-store";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
/** 构图图是 720p 级别的 PNG，正常 200~600KB。留足余量但挡住明显异常的上传。 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * 保存 3D 导演台渲染出的相机视图，作为本镜的**构图参考图**。
 *
 * 刻意写进独立的 `previz_layout_url` 而不是 `anchor_first`：
 * anchorFirst 是真正要送去生成视频的首帧，被一张灰盒渲染图覆盖是不可逆的。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;

  const shotId = new URL(request.url).searchParams.get("shotId");
  if (!shotId) return NextResponse.json({ error: "Missing shotId" }, { status: 400 });
  const scope = await requireShotInProject(shotId, projectId);
  if (!scope.ok) return scope.response;

  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "文件过大" }, { status: 413 });

  try {
    const [existing] = await db
      .select({ previzLayoutUrl: shots.previzLayoutUrl })
      .from(shots)
      .where(eq(shots.id, shotId));

    const buffer = Buffer.from(await file.arrayBuffer());
    const filepath = await saveArtifactAt(
      path.join(uploadDir, "previz"),
      `${ulid()}.png`,
      buffer
    );
    await db.update(shots).set({ previzLayoutUrl: filepath }).where(eq(shots.id, shotId));

    // 旧图在新图落库之后再删：反过来的话，删成功但写库失败就会留下一个指向空的引用
    if (existing?.previzLayoutUrl && existing.previzLayoutUrl !== filepath) {
      try {
        await deleteArtifact(existing.previzLayoutUrl);
      } catch (err) {
        console.warn(`[PrevizLayout] 旧构图图删除失败（不影响本次保存）:`, err);
      }
    }

    return NextResponse.json({ previzLayoutUrl: filepath });
  } catch (err) {
    // 空白 500 会让「存储没配好」和「磁盘满了」长得一模一样
    console.error(`[PrevizLayout] shot ${shotId}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
