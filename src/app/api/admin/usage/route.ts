/**
 * GET /api/admin/usage —— 过去 24 小时平台 Key 的实际开销（仅管理员）。
 *
 * 为什么这条接口必须有：支付没接、`BILLING_ENABLED` 关着，`credit_accounts` 全是 0，
 * **平台 Key 烧了多少钱在账面上完全看不出来**。刹车（约定 8p）有没有在起作用、
 * 是谁在消耗额度，只有这里能回答。
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-guard";
import { summarizePlatformUsage } from "@/lib/billing/platform-usage";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  return NextResponse.json(await summarizePlatformUsage());
}
