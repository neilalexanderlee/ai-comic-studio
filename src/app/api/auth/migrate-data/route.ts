/**
 * POST /api/auth/migrate-data
 *
 * 将旧匿名 userId 下的所有数据迁移到当前登录用户。
 * 用于：
 *   1. 登录 / 注册成功后自动调用（迁移浏览器中残留的匿名数据）
 *   2. 用户手动输入旧 Session ID 恢复数据
 *
 * Body: { fromUserId: string }
 * Response: { ok: true, migrated: number }  — migrated = 受影响行数合计
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { runParameterizedUpdate } from "@/lib/db";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { ensureProviderSecretsTable } from "@/lib/provider-secrets";

const MIGRATABLE_TABLES = [
  "projects",
  "provider_secrets",
  "prompt_templates",
  "prompt_presets",
  "user_client_prefs",
] as const;

export async function POST(req: NextRequest) {
  const toUserId = getAuthUserIdFromRequest(req);
  if (!toUserId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await req.json()) as { fromUserId?: string };
  const fromUserId = body.fromUserId?.trim();

  if (!fromUserId) {
    return NextResponse.json({ error: "fromUserId 不能为空" }, { status: 400 });
  }
  if (fromUserId === toUserId) {
    return NextResponse.json({ ok: true, migrated: 0 });
  }

  // 拒绝迁移另一个认证账号的数据（fromUserId 必须是匿名 ID，不能是 users 表中的账号）
  const [authAccount] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, fromUserId))
    .limit(1);
  if (authAccount) {
    return NextResponse.json(
      { error: "不能迁移认证账号的数据" },
      { status: 400 }
    );
  }

  // 确保 provider_secrets 表在迁移前已存在
  // （该表由懒加载创建，migration SQL 里没有对应建表语句）
  await ensureProviderSecretsTable();

  let migrated = 0;

  for (const table of MIGRATABLE_TABLES) {
    // runParameterizedUpdate 使用 better-sqlite3 prepared statement：
    // - 参数绑定，无 SQL 注入风险
    // - 返回真实 .changes 行数（不依赖 drizzle Proxy 的类型推断）
    // - 表不存在时返回 -1（而不是抛异常吞掉）
    const changes = runParameterizedUpdate(
      table,
      { user_id: toUserId },
      { user_id: fromUserId }
    );
    if (changes > 0) {
      console.log(`[migrate-data] ${table}: ${changes} rows → ${toUserId.slice(0, 8)}...`);
      migrated += changes;
    } else if (changes === -1) {
      console.warn(`[migrate-data] Table "${table}" not found or error, skipped`);
    }
  }

  console.log(`[migrate-data] Total migrated: ${migrated} rows`);
  return NextResponse.json({ ok: true, migrated });
}
