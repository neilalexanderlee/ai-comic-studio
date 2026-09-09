"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Shield, LogOut, User, Loader2, ArrowRight, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { markLoggedOut, syncAuthFlag } from "@/lib/client/anon-session";

interface MeResponse {
  loggedIn: boolean;
  userId?: string;
  username?: string;
  role?: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "owner · 可配置模型密钥",
  admin: "运营管理员",
};

/**
 * 设置页的「账号」区块 —— 看账号、改密码、退出登录。
 *
 * 登录/注册表单已经搬到独立的 `/login` 和 `/register` 两页（普通网站的做法）。
 * 这里不再内嵌表单：同一个表单存在两处，改一处忘一处是必然的，
 * 而登录这条路径出问题的代价特别高 —— 用户直接进不来，且往往没有任何报错
 * （2026-09-05 的 Secure cookie 事故就是这样）。
 *
 * 下面那条「未登录 → 去登录」的分支，在 `REQUIRE_AUTH=1` 时**基本走不到** ——
 * `settings/layout.tsx` 已经把未登录的人挡在门外了（常规网站的做法：设置页在登录之后）。
 * 它服务的是两种情况：
 *   1. 未开 `REQUIRE_AUTH` 的自部署单机 —— 匿名可用，这里是「升级成账号」的入口；
 *   2. SSR 通过之后 cookie 才过期的那一小段竞态 —— 此时提示去登录正是对的。
 */
export function AuthSection() {
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "zh";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // 改密表单
  const [pwOpen, setPwOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: MeResponse) => {
        setMe(d);
        // 兼容「旧会话已登录但本地标志缺失」的情况
        syncAuthFlag(d.loggedIn);
      })
      .catch(() => setMe({ loggedIn: false }))
      .finally(() => setChecking(false));
  }, []);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      markLoggedOut();
      setMe({ loggedIn: false });
      toast.success("已退出登录");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    if (next !== confirm) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "修改失败");
        return;
      }
      toast.success("密码已修改，其他设备上的登录已失效");
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwOpen(false);
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[--border-subtle] bg-white p-5">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
        <Shield className="h-3.5 w-3.5" />
        账号
      </h3>

      {checking ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[--text-muted]" />
        </div>
      ) : me?.loggedIn ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-[--surface] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[--text-primary]">{me.username}</span>
                {me.role && ROLE_LABEL[me.role] && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
                    {ROLE_LABEL[me.role]}
                  </span>
                )}
              </div>
              <div className="text-xs text-[--text-muted]">
                已登录 · 数据存储在数据库，清除缓存不影响数据
              </div>
            </div>
          </div>

          {/* 修改密码 */}
          {pwOpen ? (
            <div className="space-y-3 rounded-xl border border-[--border-subtle] p-4">
              <div className="space-y-1.5">
                <Label className="text-xs">当前密码</Label>
                <Input
                  type="password"
                  value={current}
                  autoComplete="current-password"
                  onChange={(e) => setCurrent(e.target.value)}
                  disabled={pwSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">新密码</Label>
                <Input
                  type="password"
                  value={next}
                  placeholder="至少 6 个字符"
                  autoComplete="new-password"
                  onChange={(e) => setNext(e.target.value)}
                  disabled={pwSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">确认新密码</Label>
                <Input
                  type="password"
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={pwSaving}
                />
              </div>
              <p className="text-[11px] text-[--text-muted]">
                修改后，你在<b>其他设备</b>上的登录会立即失效，需要用新密码重新登录。
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pwSaving}
                  onClick={() => {
                    setPwOpen(false);
                    setCurrent("");
                    setNext("");
                    setConfirm("");
                  }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={handleChangePassword}
                  disabled={pwSaving || !current || next.length < 6 || !confirm}
                >
                  {pwSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  确认修改
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex justify-between border-t border-[--border-subtle] pt-3">
            {!pwOpen && (
              <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
                <KeyRound className="h-3.5 w-3.5" />
                修改密码
              </Button>
            )}
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={loading}
              className="text-[--text-secondary] hover:border-destructive/40 hover:text-destructive"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              退出登录
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[--text-muted]">
            当前未登录。登录后数据直接存在服务器数据库，清除浏览器缓存也不会丢失。
          </p>
          {/* 用 ArrowRight 而不是 LogIn：后者与上面「退出登录」的 LogOut 是镜像箭头，容易混 */}
          <Link href={`/${locale}/login`} className={buttonVariants({ size: "sm" })}>
            去登录
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
