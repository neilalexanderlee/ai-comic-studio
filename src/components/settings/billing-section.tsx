"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { Loader2, Wallet, Check, Clock } from "lucide-react";
import type { CreditPack, Plan } from "@/lib/billing/plans";

/**
 * 账户与套餐。
 *
 * ⚠️ **未启用计费时整块不渲染**。自部署用户带自己的 API Key，没有积分概念 ——
 * 给他们看一排买不了也不需要买的套餐卡片是纯粹的噪音。
 * 判断依据是后端返回的 `billingEnabled`，不在前端猜环境变量。
 */

interface LedgerRow {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  createdAt: string | number;
}
interface OrderRow {
  id: string;
  planCode: string;
  amountCents: number;
  creditsGranted: number;
  status: string;
  channel: string;
  createdAt: string | number;
}
interface AccountData {
  billingEnabled: boolean;
  subscriptionBalance?: number;
  subscriptionExpiresAt?: string | number | null;
  permanentBalance?: number;
  frozen?: number;
  total?: number;
  subscription?: { planCode: string; periodEnd: string | number; autoRenew: boolean };
  ledger?: LedgerRow[];
  orders?: OrderRow[];
}
interface PlansData {
  billingEnabled: boolean;
  plans: Plan[];
  packs: CreditPack[];
  current: { planCode: string } | null;
}

const LEDGER_LABEL: Record<string, string> = {
  grant: "赠送",
  purchase: "充值",
  reserve: "预扣",
  settle: "结算",
  refund: "退回",
  expire: "过期作废",
};

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
function day(v: string | number | null | undefined): string {
  if (!v) return "—";
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("zh-CN");
}

export function BillingSection() {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [plansData, setPlansData] = useState<PlansData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([
      apiFetch("/api/billing/account").then((r) => r.json() as Promise<AccountData>),
      apiFetch("/api/billing/plans").then((r) => r.json() as Promise<PlansData>),
    ]);
    setAccount(a);
    setPlansData(p);
  }, []);

  useEffect(() => {
    load().catch(() => setAccount({ billingEnabled: false }));
  }, [load]);

  /**
   * 下单 → 立刻用 mock 通道付掉。
   *
   * 真实渠道接进来之后，这里会变成「下单 → 跳转支付页 → 等异步回调」，
   * 但入账那一步（markOrderPaid）完全不用改 —— mock 走的就是同一个函数。
   */
  async function purchase(kind: "subscription" | "topup", code: string, label: string) {
    setBusy(code);
    try {
      const res = await apiFetch("/api/billing/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, code, channel: "mock" }),
      });
      const order = (await res.json()) as { orderId?: string; error?: string };
      if (!res.ok || !order.orderId) throw new Error(order.error || "下单失败");

      const pay = await apiFetch(`/api/billing/orders/${order.orderId}/mock-pay`, { method: "POST" });
      const result = (await pay.json()) as { error?: string; creditsGranted?: number };
      if (!pay.ok) throw new Error(result.error || "支付失败");

      toast.success(`${label} 已入账 ${result.creditsGranted} 积分`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "购买失败");
    } finally {
      setBusy(null);
    }
  }

  // 未启用计费：整块不渲染
  if (!account || !account.billingEnabled || !plansData?.billingEnabled) return null;

  const currentCode = plansData.current?.planCode;

  return (
    <div className="rounded-2xl border border-[--border-subtle] bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
        <Wallet className="h-3.5 w-3.5" />
        账户与套餐
      </h3>

      {/* 余额 —— 两种积分必须分开显示，因为寿命不同 */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-[--surface] p-3">
          <p className="text-[10px] text-[--text-muted]">本周期赠送</p>
          <p className="text-lg font-semibold tabular-nums text-[--text-primary]">
            {account.subscriptionBalance ?? 0}
          </p>
          <p className="text-[10px] text-amber-600">
            {day(account.subscriptionExpiresAt)} 到期作废
          </p>
        </div>
        <div className="rounded-xl bg-[--surface] p-3">
          <p className="text-[10px] text-[--text-muted]">充值积分</p>
          <p className="text-lg font-semibold tabular-nums text-[--text-primary]">
            {account.permanentBalance ?? 0}
          </p>
          <p className="text-[10px] text-emerald-700">永不过期</p>
        </div>
        <div className="rounded-xl bg-[--surface] p-3">
          <p className="text-[10px] text-[--text-muted]">生成中冻结</p>
          <p className="text-lg font-semibold tabular-nums text-[--text-primary]">
            {account.frozen ?? 0}
          </p>
          <p className="text-[10px] text-[--text-muted]">失败会退回</p>
        </div>
      </div>
      <p className="mb-5 text-[11px] text-[--text-muted]">
        消费时**先花会过期的**，充值积分留到最后 —— 免得赠送的积分白白到期。
      </p>

      {/* 套餐 */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">套餐</p>
      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {plansData.plans.map((plan) => {
          const isCurrent = plan.code === currentCode;
          return (
            <div
              key={plan.code}
              className={`rounded-xl border p-3 ${
                isCurrent ? "border-primary bg-primary/5" : "border-[--border-subtle]"
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-sm font-medium text-[--text-primary]">{plan.name}</span>
                {isCurrent && (
                  <span className="flex items-center gap-0.5 text-[10px] text-primary">
                    <Check className="h-3 w-3" />当前
                  </span>
                )}
              </div>
              <p className="text-lg font-semibold text-[--text-primary]">
                {plan.priceCents === 0 ? "免费" : yuan(plan.priceCents)}
                {plan.priceCents > 0 && <span className="text-[11px] font-normal text-[--text-muted]">/月</span>}
              </p>
              <p className="text-[11px] tabular-nums text-[--text-secondary]">
                {plan.creditsPerPeriod.toLocaleString()} 积分 / 月
              </p>
              <p className="mt-1 text-[10px] leading-snug text-[--text-muted]">{plan.tagline}</p>
              {/* 功能位要在**撞上之前**看得见 —— 否则用户只会在生成时收到一条
                  "当前套餐最高支持 480p"的报错，却不知道该升到哪一档 */}
              <p className="mt-1 text-[10px] leading-snug text-[--text-secondary]">
                最高 {plan.features.maxResolution} · 同时 {plan.features.maxConcurrentJobs} 个任务 ·{" "}
                {plan.features.maxProjects === null ? "项目不限" : `${plan.features.maxProjects} 个项目`}
                {plan.features.allowedVideoFamilies.length > 0 && " · 仅入门档模型"}
              </p>
              {plan.priceCents > 0 && !isCurrent && (
                <Button
                  size="xs"
                  className="mt-2 w-full"
                  disabled={busy !== null}
                  onClick={() => purchase("subscription", plan.code, plan.name)}
                >
                  {busy === plan.code ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  订阅
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* 加油包 */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
        加油包 · 永不过期
      </p>
      <div className="mb-5 flex flex-wrap gap-2">
        {plansData.packs.map((pack) => (
          <div key={pack.code} className="flex items-center gap-3 rounded-xl border border-[--border-subtle] px-3 py-2">
            <div>
              <p className="text-sm font-medium text-[--text-primary]">
                {yuan(pack.priceCents)} · {pack.credits.toLocaleString()} 积分
              </p>
              <p className="text-[10px] text-[--text-muted]">{pack.tagline}</p>
            </div>
            <Button
              size="xs"
              variant="outline"
              disabled={busy !== null}
              onClick={() => purchase("topup", pack.code, pack.name)}
            >
              {busy === pack.code ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              购买
            </Button>
          </div>
        ))}
      </div>
      <p className="mb-5 flex items-center gap-1 text-[11px] text-amber-600">
        <Clock className="h-3 w-3" />
        当前是 mock 支付通道（点「购买」直接入账，不产生真实扣款）。真实渠道需要商户号。
      </p>

      {/* 流水 */}
      {account.ledger && account.ledger.length > 0 && (
        <>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">积分流水</p>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-[--border-subtle]">
            {account.ledger.slice().reverse().map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-2 border-b border-[--border-subtle] px-3 py-1.5 text-[11px] last:border-b-0"
              >
                <span className="w-16 flex-shrink-0 text-[--text-muted]">
                  {LEDGER_LABEL[row.type] ?? row.type}
                </span>
                <span
                  className={`w-16 flex-shrink-0 tabular-nums font-medium ${
                    row.amount >= 0 ? "text-emerald-700" : "text-[--text-primary]"
                  }`}
                >
                  {row.amount >= 0 ? "+" : ""}
                  {row.amount}
                </span>
                <span className="flex-1 truncate text-[--text-muted]">{row.note ?? ""}</span>
                <span className="flex-shrink-0 text-[--text-muted]">{day(row.createdAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
