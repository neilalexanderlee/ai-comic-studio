"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Shield, LogOut, User, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface MeResponse {
  loggedIn: boolean;
  userId?: string;
  username?: string;
}

/** 读取浏览器中存储的旧匿名 ID */
function getAnonymousId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ai_comic_uid");
}

/** 登录/注册成功后：把旧匿名 ID 迁移到当前账号，再清除本地存储 */
async function migrateAndClearAnonymousId() {
  const anonId = getAnonymousId();
  if (!anonId) return;
  try {
    await fetch("/api/auth/migrate-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromUserId: anonId }),
    });
  } catch {
    // 静默失败：数据不丢失，用户可以手动恢复
  }
  localStorage.removeItem("ai_comic_uid");
}

export function AuthSection() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: MeResponse) => setMe(d))
      .catch(() => setMe({ loggedIn: false }))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    try {
      const endpoint = tab === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; username?: string };

      if (!res.ok) {
        toast.error(data.error ?? "操作失败");
        return;
      }

      // 无论登录还是注册，都尝试把浏览器里的旧匿名数据迁移过来
      await migrateAndClearAnonymousId();

      toast.success(tab === "login" ? `欢迎回来，${data.username}！` : `账号创建成功，欢迎 ${data.username}！`);
      router.refresh();
      const meRes = await fetch("/api/auth/me");
      setMe(await meRes.json());
      setUsername("");
      setPassword("");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setMe({ loggedIn: false });
      toast.success("已退出登录");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[--border-subtle] bg-white p-5 space-y-4">
      {/* Header */}
      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
        <Shield className="h-3.5 w-3.5" />
        账号
      </h3>

      {checking ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[--text-muted]" />
        </div>
      ) : me?.loggedIn ? (
        /* ── 已登录状态 ── */
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-[--surface] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[--text-primary]">{me.username}</div>
              <div className="text-xs text-[--text-muted]">已登录 · 数据存储在数据库，清除缓存不影响数据</div>
            </div>
          </div>

          <div className="flex justify-end border-t border-[--border-subtle] pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={loading}
              className="text-[--text-secondary] hover:text-destructive hover:border-destructive/40"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              退出登录
            </Button>
          </div>
        </div>
      ) : (
        /* ── 未登录状态 ── */
        <div className="space-y-4">
          <p className="text-xs text-[--text-muted]">
            创建账号后，数据直接存储在服务器数据库，清除浏览器缓存不会丢失任何数据。
          </p>

          {/* Tab 切换 */}
          <div className="flex rounded-lg border border-[--border-subtle] overflow-hidden text-xs">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 font-medium transition-colors ${
                  tab === t
                    ? "bg-primary text-white"
                    : "text-[--text-secondary] hover:bg-[--surface]"
                }`}
              >
                {t === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">用户名</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="至少 2 个字符"
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">密码</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === "register" ? "至少 6 个字符" : ""}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  disabled={loading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
                >
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {tab === "register" && getAnonymousId() && (
              <p className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] text-amber-700">
                检测到浏览器中有旧数据，注册后将自动迁移到新账号。
              </p>
            )}

            <div className="flex justify-end pt-1">
              <Button type="submit" size="sm" disabled={loading || !username.trim() || !password}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {tab === "login" ? "登录" : "创建账号"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
