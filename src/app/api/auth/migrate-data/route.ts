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
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getAuthUserIdFromRequest } from "@/lib/auth";

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

  let migrated = 0;

  for (const table of MIGRATABLE_TABLES) {
    try {
      const result = await db.run(
        sql.raw(
          `UPDATE "${table}" SET user_id = '${toUserId}' WHERE user_id = '${fromUserId}'`
        )
      );
      migrated += (result as { changes?: number }).changes ?? 0;
    } catch {
      // 表不存在或字段名不同时静默跳过
    }
  }

  return NextResponse.json({ ok: true, migrated });
}
