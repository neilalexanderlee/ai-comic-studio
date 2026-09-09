"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity, ArrowLeft, Copy, Loader2, Plus, ShieldUser, Ticket, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-fetch";

interface InviteCode {
  id: string;
  code: string;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface UsageRow {
  userId: string;
  username: string | null;
  videoSeconds: number;
  imageCount: number;
  musicCount: number;
  estimatedYuan: number;
}

interface UsageSummary {
  windowHours: number;
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

interface AdminUser {
  id: string;
  username: string;
  role: string;
  status: string;
  createdAt: string;
}

/**
 * 管理后台：邀请码 + 用户。
 *
 * 刻意只做这两件事。当前规模是几个内部人，管理端做重了没人用；
 * 而这两件正是「准入」与「撤销」两层防线的操作面 —— 缺了它们，
 * 邀请制就只能靠改数据库，停用一个泄露的账号也没有手段。
 */
export function AdminConsole() {
  const router = useRouter();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [mode, setMode] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>("user");
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("30");

  const load = useCallback(async () => {
    try {
      const [codesRes, usersRes, usageRes] = await Promise.all([
        apiFetch("/api/admin/invite-codes"),
        apiFetch("/api/admin/users"),
        apiFetch("/api/admin/usage"),
      ]);
      const codesData = (await codesRes.json()) as { codes?: InviteCode[]; mode?: string };
      const usersData = (await usersRes.json()) as {
        users?: AdminUser[];
        platformKeyOwnerId?: string | null;
        currentUserId?: string;
        currentUserRole?: string;
      };
      setUsage((await usageRes.json()) as UsageSummary);
      setCodes(codesData.codes ?? []);
      setMode(codesData.mode ?? "");
      setUsers(usersData.users ?? []);
      setOwnerId(usersData.platformKeyOwnerId ?? null);
      setMeId(usersData.currentUserId ?? null);
      setMyRole(usersData.currentUserRole ?? "user");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await apiFetch("/api/admin/invite-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim() || undefined,
          maxUses: Number(maxUses) || 1,
          expiresInDays: Number(expiresInDays) || null,
        }),
      });
      const data = (await res.json()) as { code?: InviteCode };
      if (data.code) toast.success(`邀请码已生成：${data.code.code}`);
      setNote("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await apiFetch(`/api/admin/invite-codes/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "作废失败");
    }
  }

  async function patchUser(id: string, body: Record<string, string>) {
    try {
      const res = await apiFetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "操作失败");
        return;
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  /** 只有 owner 能调整角色（服务端 PATCH 那边才是真正的准入，这里只管显示） */
  const canManageRoles = myRole === "owner";

  function statusOf(c: InviteCode): { text: string; tone: string } {
    if (c.revokedAt) return { text: "已作废", tone: "text-[--text-muted] line-through" };
    if (c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now())
      return { text: "已过期", tone: "text-[--text-muted]" };
    if (c.usedCount >= c.maxUses) return { text: "已用完", tone: "text-[--text-muted]" };
    return { text: `可用 ${c.maxUses - c.usedCount}/${c.maxUses}`, tone: "text-emerald-600" };
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-[--border-subtle] bg-white/80 px-4 backdrop-blur-xl lg:px-6">
        <button
          onClick={() => router.back()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
            <ShieldUser className="h-3.5 w-3.5" />
          </div>
          <span className="font-display text-sm font-semibold">管理后台</span>
        </div>
      </header>

      <main className="flex-1 bg-[--surface] p-4 lg:p-6">
        <div className="mx-auto max-w-4xl animate-page-in space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[--text-muted]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* 模型开销 —— 计费没开时，这是唯一能看出钱花在哪的地方 */}
              {usage && (
                <div className="space-y-3 rounded-2xl border border-[--border-subtle] bg-white p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
                      <Activity className="h-3.5 w-3.5" />
                      模型用量 · 最近 {usage.windowHours} 小时
                    </h3>
                    <span className="text-xs text-[--text-muted]">
                      在飞{" "}
                      {usage.inflight.length === 0
                        ? "0"
                        : usage.inflight.map((i) => `${i.protocol} ${i.count}`).join(" / ")}
                      <span className="mx-1">·</span>上限 {usage.limits.maxInflight}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "视频", value: `${usage.totals.videoSeconds} 秒` },
                      { label: "图片", value: `${usage.totals.imageCount} 张` },
                      { label: "音乐", value: `${usage.totals.musicCount} 条` },
                      { label: "估算成本", value: `≈ ¥${usage.totals.estimatedYuan.toFixed(2)}` },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl bg-[--surface] px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-[--text-muted]">
                          {s.label}
                        </div>
                        <div className="font-display text-sm font-semibold">{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {usage.rows.length === 0 ? (
                    <p className="py-4 text-center text-sm text-[--text-muted]">
                      最近 {usage.windowHours} 小时没有走平台 Key 的生成
                    </p>
                  ) : (
                    <div className="divide-y divide-[--border-subtle]">
                      {usage.rows.map((r) => {
                        const over =
                          usage.limits.dailyVideoSeconds > 0 &&
                          r.videoSeconds >= usage.limits.dailyVideoSeconds;
                        return (
                          <div key={r.userId} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                            <span className="font-medium">{r.username ?? r.userId.slice(0, 8)}</span>
                            <span className={over ? "text-amber-600" : "text-[--text-muted]"}>
                              视频 {r.videoSeconds}
                              {usage.limits.dailyVideoSeconds > 0 && `/${usage.limits.dailyVideoSeconds}`} 秒
                              {over && "（已达上限）"}
                            </span>
                            <span className="text-[--text-muted]">图 {r.imageCount}</span>
                            <span className="text-[--text-muted]">乐 {r.musicCount}</span>
                            <span className="ml-auto font-mono">≈ ¥{r.estimatedYuan.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-[11px] text-[--text-muted]">
                    金额按生成时的报价函数反推，是<strong>估算</strong>，真实账单以模型厂商控制台为准。
                    自带密钥的生成不计入这里 —— 那不花平台的钱。
                  </p>
                </div>
              )}

              {/* 邀请码 */}
              <div className="space-y-4 rounded-2xl border border-[--border-subtle] bg-white p-5">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
                    <Ticket className="h-3.5 w-3.5" />
                    邀请码
                  </h3>
                  <span className="text-xs text-[--text-muted]">
                    当前注册模式：<span className="font-mono">{mode}</span>
                  </span>
                </div>

                {mode !== "invite" && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                    当前不是邀请制，这些码不会被校验。要启用请设
                    <code className="mx-1 font-mono">REGISTRATION_MODE=invite</code>
                    并确保 <code className="mx-1 font-mono">ALLOW_REGISTRATION</code> 不是 0。
                  </p>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px_120px_auto]">
                  <div className="space-y-1.5">
                    <Label className="text-xs">备注（发给谁）</Label>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="张三" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">可用次数</Label>
                    <Input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">有效期（天）</Label>
                    <Input
                      value={expiresInDays}
                      onChange={(e) => setExpiresInDays(e.target.value)}
                      inputMode="numeric"
                      placeholder="留空=永久"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleCreate} disabled={creating}>
                      {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      生成
                    </Button>
                  </div>
                </div>

                {codes.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[--text-muted]">还没有邀请码</p>
                ) : (
                  <div className="divide-y divide-[--border-subtle]">
                    {codes.map((c) => {
                      const st = statusOf(c);
                      return (
                        <div key={c.id} className="flex items-center gap-3 py-2.5">
                          <code className={`font-mono text-sm tracking-wider ${st.tone}`}>{c.code}</code>
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(c.code);
                              toast.success("已复制");
                            }}
                            className="text-[--text-muted] hover:text-[--text-primary]"
                            aria-label="复制邀请码"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-xs text-[--text-muted]">{c.note ?? "—"}</span>
                          <span className={`ml-auto text-xs ${st.tone}`}>{st.text}</span>
                          {!c.revokedAt && (
                            <Button size="sm" variant="outline" onClick={() => handleRevoke(c.id)}>
                              作废
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 用户 */}
              <div className="space-y-3 rounded-2xl border border-[--border-subtle] bg-white p-5">
                <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
                  <Users className="h-3.5 w-3.5" />
                  用户
                </h3>
                <div className="divide-y divide-[--border-subtle]">
                  {users.map((u) => {
                    const isOwner = u.id === ownerId;
                    const isSelf = u.id === meId;
                    const disabled = u.status === "disabled";
                    return (
                      <div key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
                        <span className={`text-sm ${disabled ? "text-[--text-muted] line-through" : ""}`}>
                          {u.username}
                        </span>
                        {u.role === "owner" && (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
                            owner · 可配置模型密钥
                          </span>
                        )}
                        {u.role === "admin" && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                            运营管理员
                          </span>
                        )}
                        {isOwner && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                            平台 Key
                          </span>
                        )}
                        {disabled && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">
                            已停用
                          </span>
                        )}
                        <div className="ml-auto flex gap-2">
                          {/* 只有 owner 能改角色 —— 否则运营管理员可以把自己提成 owner，
                              「不给你看 Key」这条限制就能被它约束的人自己解除 */}
                          {canManageRoles && !isSelf && !isOwner && u.role !== "owner" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                patchUser(u.id, { role: u.role === "admin" ? "user" : "admin" })
                              }
                            >
                              {u.role === "admin" ? "取消运营权限" : "设为运营管理员"}
                            </Button>
                          )}
                          {!isSelf && !isOwner && !(u.role === "owner" && !canManageRoles) && (
                            <Button
                              size="sm"
                              variant={disabled ? "outline" : "destructive"}
                              onClick={() =>
                                patchUser(u.id, { status: disabled ? "active" : "disabled" })
                              }
                            >
                              {disabled ? "恢复" : "停用"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[--text-muted]">
                  停用会同时让该账号已签发的登录态失效，最长 30 秒后全站生效 ——
                  凭据泄露时这就是切断它继续消耗平台 Key 的开关。
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
