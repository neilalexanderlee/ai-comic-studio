import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-guard";
import { CREDIT_PACKS, PLANS } from "@/lib/billing/plans";
import { isBillingEnabled } from "@/lib/billing/gate";
import { ensureSubscriptionPeriod } from "@/lib/billing/subscription";

/** 套餐与加油包列表 + 当前订阅。套餐定义是代码常量（见 plans.ts），这里只是转出去。 */
export async function GET(request: Request) {
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;

  // 未启用计费：自部署场景，没有套餐概念。返回空列表让前端整块不渲染，
  // 而不是渲染一堆买不了也不需要买的卡片。
  if (!isBillingEnabled()) {
    return NextResponse.json({ billingEnabled: false, plans: [], packs: [], current: null });
  }

  const current = await ensureSubscriptionPeriod(guard.userId);
  return NextResponse.json({
    billingEnabled: true,
    plans: PLANS,
    packs: CREDIT_PACKS,
    current: {
      planCode: current.planCode,
      status: current.status,
      periodEnd: current.periodEnd,
      autoRenew: current.autoRenew,
    },
  });
}
