/**
 * PATCH /api/admin/users/[userId] —— 停用/启用、升降管理员。
 *
 * Body: { status?: "active" | "disabled", role?: "user" | "admin" }
 *
 * **停用要同时自增 token_version**：只改状态的话，那个账号手里已经签发的 cookie
 * 在同步鉴权路径上仍然有效（`getAuthUserIdFromRequest` 不读库），
 * 而这一层存在的全部意义就是「立刻切断它继续消耗平台 Key」。
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/api-guard";
import { bumpUserTokenVersion } from "@/lib/auth";
import { getPlatformKeyOwnerId, invalidateAdminCaches, roleOf } from "@/lib/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { userId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    role?: string;
  };

  const nextStatus = body.status === "disabled" || body.status === "active" ? body.status : null;
  const nextRole =
    body.role === "owner" || body.role === "admin" || body.role === "user" ? body.role : null;

  const actorRole = await roleOf(guard.userId);

  // 只有 owner 能改角色。运营 admin 若能改，就能把自己提成 owner —— 那等于
  // 「不给你看 Key」这条限制可以被持有它的人自己解除，整个分级就没有意义了。
  if (nextRole && actorRole !== "owner") {
    return NextResponse.json(
      { error: "只有 owner 可以调整角色" },
      { status: 403 }
    );
  }
  if (!nextStatus && !nextRole) {
    return NextResponse.json({ error: "没有要修改的字段" }, { status: 400 });
  }

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  // 运营 admin 不能停用 owner —— 否则「拉人的人」可以把「管密钥的人」踢下线
  if (target.role === "owner" && actorRole !== "owner") {
    return NextResponse.json({ error: "只有 owner 可以操作 owner 账号" }, { status: 403 });
  }

  // 不能把自己停用或降级：管理员把自己锁在外面之后，恢复手段只剩改环境变量重启
  if (userId === guard.userId && (nextStatus === "disabled" || nextRole !== null)) {
    return NextResponse.json({ error: "不能停用或改变自己的角色" }, { status: 400 });
  }

  // 平台 Key 挂在谁名下，谁就不能被停用/降级 —— 那会让所有人的生成当场失效，
  // 而报错只会是「未配置 Key」，看不出是这一步造成的
  const ownerId = await getPlatformKeyOwnerId();
  if (userId === ownerId && (nextStatus === "disabled" || (nextRole && nextRole !== "owner"))) {
    return NextResponse.json(
      { error: "该账号是平台 Key 的归属人，停用/降级会让全站生成失效。请先把平台 Key 迁到别的管理员。" },
      { status: 400 }
    );
  }

  await db
    .update(users)
    .set({
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(nextRole ? { role: nextRole } : {}),
    })
    .where(eq(users.id, userId));

  if (nextStatus === "disabled") {
    // 让该账号手里所有 cookie 立即失效（异步强校验路径会当场掉线）
    await bumpUserTokenVersion(userId);
  }
  invalidateAdminCaches();

  return NextResponse.json({ ok: true });
}
