import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-guard";
import { isBillingEnabled } from "@/lib/billing/gate";
import { createOrder, OrderError } from "@/lib/billing/orders";

/** 下单。只落 pending 记录，不动余额 —— 入账发生在支付回调里。 */
export async function POST(request: Request) {
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;

  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "本实例未启用计费" }, { status: 400 });
  }

  const body = (await request.json()) as { kind?: string; code?: string; channel?: string };
  if (body.kind !== "subscription" && body.kind !== "topup") {
    return NextResponse.json({ error: "kind 必须是 subscription 或 topup" }, { status: 400 });
  }
  if (!body.code) return NextResponse.json({ error: "缺少 code" }, { status: 400 });

  // 真实支付渠道待商户号到位；目前只放行 mock，避免下出一笔永远付不掉的单
  const channel = body.channel ?? "mock";
  if (channel !== "mock") {
    return NextResponse.json({ error: `支付渠道 ${channel} 尚未接入` }, { status: 400 });
  }

  try {
    const order = await createOrder({ userId: guard.userId, kind: body.kind, code: body.code, channel });
    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
