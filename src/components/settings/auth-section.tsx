"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Shield, LogOut, User, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { markLoggedOut, syncAuthFlag } from "@/lib/client/anon-session";

interface MeResponse {
  loggedIn: boolean;
  userId?: string;
  username?: string;
}

/**
 * 设置页的「账号」区块 —— **只负责看账号和退出登录**。
 *
 * 登录/注册表单已经搬到独立的 `/login` 和 `/register` 两页（普通网站的做法）。
 * 这里不再内嵌表单：同一个表单存在两处，改一处忘一处是必然的，
 * 而登录这条路径出问题的代价特别高 —— 用户直接进不来，且往往没有任何报错
 * （2026-09-05 的 Secure cookie 事故就是这样）。未登录时这里只给一个去 `/login` 的入口。
 */
export function AuthSection() {
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "zh";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

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
              <div className="text-sm font-semibold text-[--text-primary]">{me.username}</div>
              <div className="text-xs text-[--text-muted]">
                已登录 · 数据存储在数据库，清除缓存不影响数据
              </div>
            </div>
          </div>

          <div className="flex justify-end border-t border-[--border-subtle] pt-3">
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
          <Link href={`/${locale}/login`} className={buttonVariants({ size: "sm" })}>
            <LogIn className="h-3.5 w-3.5" />
            去登录
          </Link>
        </div>
      )}
    </div>
  );
}
