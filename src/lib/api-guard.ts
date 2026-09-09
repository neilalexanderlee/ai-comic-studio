import "server-only";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { characterAssets, characters, projects, shots, tasks } from "@/lib/db/schema";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { isPlatformStaff, isUserDisabled } from "@/lib/admin";

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

/**
 * 身份 + 停用状态。三个 require* 的公共前半段。
 *
 * ⚠️ **停用检查必须覆盖所有受保护路由，不能只挑几条**。只挡一部分就是
 * 「两道闸只开了一道却以为全开了」那类故障：管理员点了停用，界面显示已停用，
 * 而那个账号仍在某几条路由上继续消耗平台 Key。
 *
 * 代价由 `isUserDisabled` 的 30 秒 TTL 缓存吸收（见 lib/admin.ts），
 * 稳态下不产生额外查库。
 */
async function identify(request: Request): Promise<Guard> {
  const userId = getUserIdFromRequest(request);
  if (!userId) return deny(401, "Missing user id");
  if (await isUserDisabled(userId)) {
    return deny(403, "该账号已被停用");
  }
  return { ok: true, userId };
}

/**
 * 仅要求「有身份」（登录用户或匿名指纹）且未被停用，不校验具体资源归属。
 *
 * ⚠️ 这是 async 的（原来是同步）—— 加停用检查必须读一次状态。调用方写
 * `const guard = await requireUser(request);`，漏掉 await 会让 `guard.ok`
 * 恒为 undefined（falsy），路由整体失效而不是放行，属于会立刻暴露的错法。
 */
export async function requireUser(request: Request): Promise<Guard> {
  return identify(request);
}

/**
 * 要求当前请求者是该项目的所有者。
 *
 * 找不到项目和不属于当前用户都返回 **404**（而不是 403）—— 不泄漏「这个 id 是否存在」，
 * 避免被用来枚举他人的 project id。
 */
export async function requireProjectOwner(request: Request, projectId: string): Promise<Guard> {
  const id = await identify(request);
  if (!id.ok) return id;
  const userId = id.userId;
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
  const id = await identify(request);
  if (!id.ok) return id;
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

/**
 * 要求当前请求者能进管理后台（owner 或运营 admin）。
 *
 * 管理端接口（邀请码、用户停用、用量看板）全部经这里。
 * ⚠️ **这不代表能碰模型 Key** —— 那一类要另外过 `isKeyOwner`（见 lib/admin.ts）。
 * **非管理员一律 403 而不是 404**：这里不涉及「某个资源 id 是否存在」，
 * 没有可枚举的信息；说清楚「你不是管理员」才是对的（与套餐限制同理，见约定 8i）。
 */
export async function requireAdmin(request: Request): Promise<Guard> {
  const id = await identify(request);
  if (!id.ok) return id;
  if (!(await isPlatformStaff(id.userId))) {
    return deny(403, "需要管理员权限");
  }
  return id;
}
