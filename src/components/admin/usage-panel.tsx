"use client";

/**
 * 平台 Key 用量面板。
 *
 * 从 admin-console 里抽出来，是为了能**单独渲染看一眼**：
 * 管理后台要登录才进得去，改完样式没法验证，结果 2026-09-10 那次
 * 选中态用了 `--surface-strong` / `--text-strong` 两个**根本不存在**的变量，
 * 切换 tab 毫无反应也没人发现。抽成纯展示组件后可以喂假数据直接渲染。
 */
import { Activity } from "lucide-react";

export interface UsageRow {
  userId: string;
  username: string | null;
  videoSeconds: number;
  imageCount: number;
  musicCount: number;
  estimatedYuan: number;
}

export type UsageWindow = "24h" | "30d";


export interface UsageSummary {
  windowHours: number;
  /** 长窗口下每人上限不适用（上限按 24 小时定义），前端据此隐藏分母 */
  limitsApply: boolean;
  limits: {
    dailyVideoSeconds: number;
    dailyImageCount: number;
    dailyMusicCount: number;
    maxInflight: number;
  };
  inflight: Array<{ protocol: string; count: number }>;
  rows: UsageRow[];
  totals: { videoSeconds: number; imageCount: number; musicCount: number; estimatedYuan: number };
}

export const USAGE_WINDOWS: Array<{ key: UsageWindow; label: string }> = [
  { key: "24h", label: "最近 24 小时" },
  { key: "30d", label: "最近 30 天" },
];

export function UsagePanel({
  usage,
  window,
  onWindowChange,
}: {
  usage: UsageSummary;
  window: UsageWindow;
  onWindowChange: (w: UsageWindow) => void;
}) {
  const windowLabel = USAGE_WINDOWS.find((w) => w.key === window)?.label ?? "";

  return (
            <div className="overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--elevated)">
              {/* 头部：标题 / 窗口切换 / 在飞状态 */}
              <div className="flex flex-wrap items-center gap-3 border-b border-(--border-subtle) px-5 py-3.5">
                <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-(--text-muted)">
                  <Activity className="h-3.5 w-3.5" />
                  模型用量
                </h3>

                {/* 分段控件：轨道用 --surface，选中项是浮起的白色药丸。
                    ⚠️ 必须放在 h3 外面 —— h3 上的 uppercase/tracking 会把中文标签拉散。 */}
                <div className="inline-flex rounded-lg bg-(--surface) p-0.5">
                  {USAGE_WINDOWS.map((w) => {
                    const active = window === w.key;
                    return (
                      <button
                        key={w.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onWindowChange(w.key)}
                        className={`rounded-md px-2.5 py-1 text-[11px] transition-all ${
                          active
                            // shadow-sm 在本项目的 v4 配置下算出来是透明的，用显式阴影保证药丸有浮起感
                                ? "bg-(--elevated) font-semibold text-(--text-primary) shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                            : "text-(--text-muted) hover:text-(--text-secondary)"
                        }`}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>

                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-(--surface) px-2.5 py-1 text-[11px] text-(--text-secondary)">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      usage.inflight.length > 0 ? "bg-(--primary)" : "bg-(--text-muted)/40"
                    }`}
                  />
                  在飞{" "}
                  {usage.inflight.length === 0
                    ? 0
                    : usage.inflight.map((i) => `${i.protocol} ${i.count}`).join(" / ")}
                  <span className="text-(--text-muted)">/ 上限 {usage.limits.maxInflight}</span>
                </span>
              </div>

              <div className="space-y-4 p-5">
                {/* 成本是这个面板存在的理由，给它主位 */}
                <div className="grid gap-3 sm:grid-cols-[1.1fr_2fr]">
                  <div className="rounded-xl border border-(--primary)/20 bg-(--primary)/5 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wider text-(--text-muted)">
                      估算成本
                    </div>
                    <div className="font-display text-2xl font-semibold text-(--primary)">
                      ≈ ¥{usage.totals.estimatedYuan.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-(--text-muted)">{windowLabel}</div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "视频", value: usage.totals.videoSeconds, unit: "秒" },
                      { label: "图片", value: usage.totals.imageCount, unit: "张" },
                      { label: "音乐", value: usage.totals.musicCount, unit: "条" },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl bg-(--surface) px-3 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-(--text-muted)">
                          {s.label}
                        </div>
                        <div className="font-display text-lg font-semibold text-(--text-primary)">
                          {s.value}
                          <span className="ml-1 text-[11px] font-normal text-(--text-muted)">
                            {s.unit}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {usage.rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-(--border-subtle) py-8 text-center">
                    <p className="text-sm text-(--text-secondary)">{windowLabel}没有走平台 Key 的生成</p>
                    <p className="mt-1 text-[11px] text-(--text-muted)">
                      没人消耗平台额度，或者大家用的都是自己的密钥
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {usage.rows.map((r) => {
                      // 上限是按 24 小时定义的；30 天窗口里拿它当分母会显示
                      // 「视频 640/120 秒（已达上限）」这种既不真也不可执行的数字
                      const showLimit = usage.limitsApply && usage.limits.dailyVideoSeconds > 0;
                      const over = showLimit && r.videoSeconds >= usage.limits.dailyVideoSeconds;
                      const pct = showLimit
                        ? Math.min(100, (r.videoSeconds / usage.limits.dailyVideoSeconds) * 100)
                        : 0;
                      return (
                        <div
                          key={r.userId}
                          className="rounded-xl px-3 py-2.5 transition-colors hover:bg-(--surface)"
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-medium text-(--text-primary)">
                              {r.username ?? r.userId.slice(0, 8)}
                            </span>
                            {over && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                已达上限
                              </span>
                            )}
                            <span className="ml-auto font-mono text-(--text-primary)">
                              ≈ ¥{r.estimatedYuan.toFixed(2)}
                            </span>
                          </div>

                          {/* 额度条：刹车有没有快到了，一眼看出来比读数字快 */}
                          {showLimit && (
                            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-(--surface-hover)">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  over ? "bg-amber-500" : "bg-(--primary)"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}

                          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-(--text-muted)">
                            <span>
                              视频 {r.videoSeconds}
                              {showLimit && `/${usage.limits.dailyVideoSeconds}`} 秒
                            </span>
                            <span>图 {r.imageCount} 张</span>
                            <span>乐 {r.musicCount} 条</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="border-t border-(--border-subtle) pt-3 text-[11px] leading-relaxed text-(--text-muted)">
                  金额按生成时的报价函数反推，是<strong>估算</strong>，真实账单以模型厂商控制台为准。
                  这里统计<strong>全站所有人</strong>走平台 Key 的生成；自带密钥的不计入 —— 那不花平台的钱。
                  <br />
                  ⚠️ 平台 Key 的<strong>持有者本人</strong>（owner）不会出现在这里：Key 挂在他名下，
                  他的请求走的是「自己的密钥」这条分支。也就是说本表看的是
                  <strong>别人花了你多少钱</strong>，不是这把 Key 的全部开销 —— 后者以厂商控制台为准。
                </p>
              </div>
            </div>
  );
}
