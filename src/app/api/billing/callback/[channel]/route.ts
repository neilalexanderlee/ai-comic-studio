import { NextResponse } from "next/server";
import { isBillingEnabled } from "@/lib/billing/gate";
import { markOrderPaid, OrderError } from "@/lib/billing/orders";

/**
 * 支付渠道异步回调。
 *
 * ⚠️ **本路由没有用户会话，这是刻意的** —— 回调来自支付渠道的服务器，不是浏览器。
 * 身份由**渠道签名**证明，不是 cookie。已在 `route-auth-guard.test.ts` 的
 * NO_AUTH_ALLOWLIST 里登记。
 *
 * 目前只实现 mock 通道；真实渠道（支付宝/微信）需要商户号，等资质到位后
 * 在 verifySignature 里补上对方的验签算法即可 —— 入账逻辑完全复用。
 */
async function verifySignature(channel: string, body: unknown): Promise<boolean> {
  if (channel === "mock") {
    // mock 通道只在未打开真实渠道前用于本地联调；它要求显式带一个约定的密钥，
    // 免得这个端点在公网上变成"谁都能给自己充值"的洞
    const secret = process.env.BILLING_MOCK_CALLBACK_SECRET;
    if (!secret) return false;
    return (body as { secret?: string })?.secret === secret;
  }
  return false;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "本实例未启用计费" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { outTradeNo?: string; channelTradeNo?: string; secret?: string }
    | null;
  if (!body?.outTradeNo || !body?.channelTradeNo) {
    return NextResponse.json({ error: "回调缺少 outTradeNo / channelTradeNo" }, { status: 400 });
  }

  if (!(await verifySignature(channel, body))) {
    return NextResponse.json({ error: "签名校验失败" }, { status: 403 });
  }

  try {
    const result = await markOrderPaid({
      outTradeNo: body.outTradeNo,
      channelTradeNo: body.channelTradeNo,
      rawCallback: body,
    });
    // 渠道要求返回明确的成功标记，否则会一直重推 —— 而重推是安全的（入账幂等）
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
