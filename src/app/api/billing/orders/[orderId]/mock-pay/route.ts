import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-guard";
import { isBillingEnabled } from "@/lib/billing/gate";
import { getOrderForUser, markOrderPaid, OrderError } from "@/lib/billing/orders";

/**
 * mock 通道的"我付好了"。
 *
 * 走的是与真实回调**完全相同**的入账函数（`markOrderPaid`），
 * 所以状态机、幂等、事务边界都被真实地测到了 —— 接真渠道时只需要把签名验证
 * 换成对方的算法，入账逻辑一行不用改。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "本实例未启用计费" }, { status: 400 });
  }

  const { orderId } = await params;
  // 二级校验：订单必须属于当前用户。找不到和不属于都返回 404，不泄漏订单是否存在
  const order = await getOrderForUser(guard.userId, orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.channel !== "mock") {
    return NextResponse.json({ error: "该订单不是 mock 通道" }, { status: 400 });
  }

  try {
    const result = await markOrderPaid({
      outTradeNo: order.outTradeNo,
      channelTradeNo: `mock_${order.outTradeNo}`,
      rawCallback: { channel: "mock", by: guard.userId },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
