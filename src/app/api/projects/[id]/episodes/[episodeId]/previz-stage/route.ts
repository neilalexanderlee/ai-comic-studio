import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { episodes, shots } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";

/**
 * 3D 导演台的读写。
 *
 * 场景挂在剧集上（一集一份，跨镜共用），走位与机位挂在分镜上 ——
 * 对应「景是搭好的，变的是机位和走位」。
 */

async function requireEpisodeInProject(episodeId: string, projectId: string) {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)))
    .limit(1);
  // 与项目内其他路由一致：找不到和不属于都返回 404，不泄漏「这个 id 存在」
  return row ? null : NextResponse.json({ error: "Episode not found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId, episodeId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const notFound = await requireEpisodeInProject(episodeId, projectId);
  if (notFound) return notFound;

  const shotId = new URL(request.url).searchParams.get("shotId");
  if (!shotId) return NextResponse.json({ error: "Missing shotId" }, { status: 400 });
  const scope = await requireShotInProject(shotId, projectId);
  if (!scope.ok) return scope.response;

  const [[episode], [shot]] = await Promise.all([
    db.select({ previzScene: episodes.previzScene }).from(episodes).where(eq(episodes.id, episodeId)),
    db.select({ previzBlocking: shots.previzBlocking }).from(shots).where(eq(shots.id, shotId)),
  ]);

  return NextResponse.json({
    scene: episode?.previzScene ?? null,
    blocking: shot?.previzBlocking ?? null,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId, episodeId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const notFound = await requireEpisodeInProject(episodeId, projectId);
  if (notFound) return notFound;

  const body = (await request.json()) as {
    shotId?: string;
    scene?: unknown;
    blocking?: unknown;
  };
  if (!body.shotId) return NextResponse.json({ error: "Missing shotId" }, { status: 400 });
  const scope = await requireShotInProject(body.shotId, projectId);
  if (!scope.ok) return scope.response;

  // 两段 JSON 都只该包含数字与短字符串。这里挡一道大小，避免有人把整段素材塞进来 ——
  // 这两列会被完整读进内存，也会进数据库备份。
  const sceneJson = body.scene === undefined ? undefined : JSON.stringify(body.scene);
  const blockingJson = body.blocking === undefined ? undefined : JSON.stringify(body.blocking);
  for (const [name, json] of [["scene", sceneJson], ["blocking", blockingJson]] as const) {
    if (json && json.length > 512 * 1024) {
      return NextResponse.json({ error: `${name} 过大` }, { status: 413 });
    }
  }

  await Promise.all([
    sceneJson === undefined
      ? Promise.resolve()
      : db.update(episodes).set({ previzScene: sceneJson }).where(eq(episodes.id, episodeId)),
    blockingJson === undefined
      ? Promise.resolve()
      : db.update(shots).set({ previzBlocking: blockingJson }).where(eq(shots.id, body.shotId)),
  ]);

  return NextResponse.json({ ok: true });
}
