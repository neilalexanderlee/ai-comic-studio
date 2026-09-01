import "server-only";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { characterAssets, characters, projects, shots, tasks } from "@/lib/db/schema";
import { getUserIdFromRequest } from "@/lib/get-user-id";

/**
 * API 路由的统一租户校验。
 *
 * 背景：只有 `projects` 表有 `user_id`，其余 17 张表全靠 `project_id` 级联。
 * 这意味着任何「按 projectId / shotId 直接查询而不回溯 projects 归属」的路由都是 IDOR ——
 * 知道一个 project ULID 就能读写别人的分镜、角色、上传文件、整包下载。
 * 上线公网前，所有带 projectId 的路由都必须先过 `requireProjectOwner`。
 *
 * 用法（两行，且刻意保持可 grep）：
 * ```ts
 * const guard = await requireProjectOwner(request, projectId);
 * if (!guard.ok) return guard.response;
 * // 之后用 guard.userId
 * ```
 *
 * 注意这里比对的是 `getUserIdFromRequest` 的结果，它包含「已登录用户」和「匿名指纹用户」
 * 两种身份。这是有意的：本地匿名使用方式不受影响，被挡住的只有跨租户访问。
 */
export type Guard =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function deny(status: number, error: string): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/** 仅要求「有身份」（登录用户或匿名指纹），不校验具体资源归属。 */
export function requireUser(request: Request): Guard {
  const userId = getUserIdFromRequest(request);
  if (!userId) return deny(401, "Missing user id");
  return { ok: true, userId };
}

/**
 * 要求当前请求者是该项目的所有者。
 *
 * 找不到项目和不属于当前用户都返回 **404**（而不是 403）—— 不泄漏「这个 id 是否存在」，
 * 避免被用来枚举他人的 project id。
 */
export async function requireProjectOwner(request: Request, projectId: string): Promise<Guard> {
  const userId = getUserIdFromRequest(request);
  if (!userId) return deny(401, "Missing user id");
  if (!projectId) return deny(400, "Missing project id");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) return deny(404, "Project not found");
  return { ok: true, userId };
}

/**
 * 子资源归属：确认 characterId 确实属于该 project。
 *
 * 为什么单有 `requireProjectOwner` 不够：过了项目校验之后，路由里的查询往往仍是
 * `where(eq(characters.id, characterId))` —— 拿自己项目的 id 配上**别人项目的 characterId**
 * 依然能改到别人的数据。ULID 不可枚举让这个洞比原来的弱得多，但属于同一类问题，一并堵上。
 */
export async function requireCharacterInProject(
  characterId: string,
  projectId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const [row] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.projectId, projectId)))
    .limit(1);
  if (!row) return deny(404, "Character not found");
  return { ok: true };
}

/** 子资源归属：确认 shotId 确实属于该 project。理由同 requireCharacterInProject。 */
export async function requireShotInProject(
  shotId: string,
  projectId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const [row] = await db
    .select({ id: shots.id })
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)))
    .limit(1);
  if (!row) return deny(404, "Shot not found");
  return { ok: true };
}

/**
 * 子资源归属：确认 character_assets 记录经由其 character 挂在该 project 下。
 * `character_assets` 表本身没有 project_id，必须 join 回 characters。
 */
export async function requireCharacterAssetInProject(
  assetId: string,
  projectId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const [row] = await db
    .select({ id: characterAssets.id })
    .from(characterAssets)
    .innerJoin(characters, eq(characterAssets.characterId, characters.id))
    .where(and(eq(characterAssets.id, assetId), eq(characters.projectId, projectId)))
    .limit(1);
  if (!row) return deny(404, "Asset not found");
  return { ok: true };
}

/** 任务归属：task → projectId → projects.userId。同样用 404 而非 403。 */
export async function requireTaskOwner(request: Request, taskId: string): Promise<Guard> {
  const userId = getUserIdFromRequest(request);
  if (!userId) return deny(401, "Missing user id");
  if (!taskId) return deny(400, "Missing task id");

  const [row] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  // tasks.project_id 允许为空（历史数据/非项目级任务）；没有归属就无法证明有权访问
  if (!row?.projectId) return deny(404, "Task not found");
  return requireProjectOwner(request, row.projectId);
}
