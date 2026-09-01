import "server-only";
import {
  reserveCredits,
  settleCredits,
  refundCredits,
  InsufficientCreditsError,
} from "@/lib/billing/credits";
import type { QuoteInput } from "@/lib/billing/pricing";

/**
 * 计费闸门 —— 生成入口处的薄封装。
 *
 * ## 默认关闭
 *
 * `BILLING_ENABLED` 未设为 "1" 时，本模块**全部退化为空操作**，
 * 生成链路的行为与接入计费前完全一致。
 *
 * 这是刻意的：本项目同时是可自部署的开源软件（用户自带 API Key，没有也不需要积分）
 * 和托管 SaaS（平台统一 Key，按积分计费）。如果闸门默认开启，自部署用户一装上就会
 * 因为余额为 0 而完全不能用。所以是「配置了才生效」，不是「配置了才关闭」。
 *
 * ## 为什么是三段式
 *
 * 视频生成是 5–10 分钟的异步长任务：
 *   - 先生成后扣费 → 余额不足时钱已花在上游，追不回
 *   - 直接扣余额  → 失败退款若不留流水，账对不上；并发下还有竞态
 * 所以 reserve（余额→冻结）→ settle（冻结→扣除）/ refund（冻结→余额）。
 *
 * 用法：
 * ```ts
 * const gate = await openBillingGate(userId, { kind: "video", ... }, ctx);
 * if (!gate.ok) return gate.response;      // 402，余额不足
 * try {
 *   const result = await provider.generateVideo(...);
 *   await gate.settle();
 *   return NextResponse.json({ ... });
 * } catch (err) {
 *   await gate.refund("生成失败");
 *   throw err;
 * }
 * ```
 */

import { NextResponse } from "next/server";

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "1";
}

export type BillingGate =
  | {
      ok: true;
      /** 本次预扣的积分（未启用计费时为 0） */
      credits: number;
      /** 计价说明，可回传前端展示 */
      explain: string;
      /** 成功后调用。actualCredits 可小于预扣值（按真实用量对账），差额自动退回 */
      settle: (opts?: { actualCredits?: number; upstreamUsage?: number }) => Promise<void>;
      /** 失败/超时调用，全额退回 */
      refund: (note?: string) => Promise<void>;
    }
  | { ok: false; response: NextResponse };

const NOOP_GATE: Extract<BillingGate, { ok: true }> = {
  ok: true,
  credits: 0,
  explain: "",
  settle: async () => {},
  refund: async () => {},
};

export async function openBillingGate(
  userId: string,
  input: QuoteInput,
  ctx?: { projectId?: string; shotId?: string; protocol?: string }
): Promise<BillingGate> {
  if (!isBillingEnabled()) return NOOP_GATE;

  try {
    const reservation = await reserveCredits(userId, input, ctx);
    return {
      ok: true,
      credits: reservation.credits,
      explain: reservation.explain,
      settle: (opts) => settleCredits(reservation.reservationId, opts),
      refund: (note) => refundCredits(reservation.reservationId, note),
    };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: "积分不足",
            required: err.required,
            available: err.available,
            code: "INSUFFICIENT_CREDITS",
          },
          { status: 402 }
        ),
      };
    }
    throw err;
  }
}
