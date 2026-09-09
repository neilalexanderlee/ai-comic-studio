/**
 * GET /api/admin/usage —— 平台 Key 的实际开销（仅管理员）。
 *
 * 为什么这条接口必须有：支付没接、`BILLING_ENABLED` 关着，`credit_accounts` 全是 0，
 * **平台 Key 烧了多少钱在账面上完全看不出来**。刹车（约定 8p）有没有在起作用、
 * 是谁在消耗额度，只有这里能回答。
 *
 * `?window=24h|30d` 只切换**报表看多长时间**，不影响刹车 ——
 * `checkPlatformUsage` 永远只看最近 24 小时。认不出来的值回落到 24h
 * （与限额环境变量同一条原则：失效方式应当是「没看到想看的范围」，
 * 不是「整个面板报错打不开」）。
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-guard";
import { summarizePlatformUsage } from "@/lib/billing/platform-usage";

const HOUR = 60 * 60 * 1000;
/** 闭集：每多一档就多一种要在前端解释的窗口，也多一次全表扫描 */
const WINDOWS: Record<string, number> = {
  "24h": 24 * HOUR,
  "30d": 30 * 24 * HOUR,
};

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const requested = new URL(request.url).searchParams.get("window") ?? "24h";
  const windowMs = WINDOWS[requested] ?? WINDOWS["24h"];

  return NextResponse.json(await summarizePlatformUsage(windowMs));
}
