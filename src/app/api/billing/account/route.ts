import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-guard";
import { isBillingEnabled } from "@/lib/billing/gate";
import { getAccountOverview, listLedger } from "@/lib/billing/subscription";
import { listOrders } from "@/lib/billing/orders";

/** 账户总览：双余额、订阅周期、最近流水与订单。 */
export async function GET(request: Request) {
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;

  if (!isBillingEnabled()) {
    return NextResponse.json({ billingEnabled: false });
  }

  const [overview, ledger, orders] = await Promise.all([
    getAccountOverview(guard.userId),
    listLedger(guard.userId, 50),
    listOrders(guard.userId, 20),
  ]);

  return NextResponse.json({ billingEnabled: true, ...overview, ledger, orders });
}
