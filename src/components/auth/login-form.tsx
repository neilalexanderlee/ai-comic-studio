"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, EyeOff, LogIn } from "lucide-react";
import { toast } from "sonner";
import { migrateAndClearAnonymousId, getAnonymousId } from "@/lib/client/anon-session";

interface Props {
  /** 服务端读 `ALLOW_REGISTRATION` 后传入。为 false 时整个「注册」页签都不渲染 */
  allowRegistration: boolean;
  /** 登录成功后回到哪里。已由服务端校验过是站内相对路径 */
  next: string;
}

/**
 * `/login` 页的登录/注册表单。
 *
 * 与设置页里那个 `AuthSection` 的分工：那个是「已登录时看账号、顺手能登出」的面板，
 * 这个是**未登录时的入口**。两边共用 `lib/client/anon-session` 里的匿名数据迁移逻辑，
 * 不各抄一份。
 */
export function LoginForm({ allowRegistration, next }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // 只在注册页签下提示「会迁移旧数据」，登录时提这个只会让人困惑
  const anonId = typeof window !== "undefined" ? getAnonymousId() : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    try {
      const res = await fetch(tab === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; username?: string };

      if (!res.ok) {
        toast.error(data.error ?? "操作失败");
        return;
      }

      await migrateAndClearAnonymousId();
      toast.success(
        tab === "login" ? `欢迎回来，${data.username}！` : `账号创建成功，欢迎 ${data.username}！`
      );

      // replace 而不是 push：登录页不该留在后退历史里
      router.replace(next);
      // 首页是服务端组件，按 cookie 查项目；不 refresh 会拿到登录前那份空结果
      router.refresh();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {allowRegistration && (
        <div className="flex overflow-hidden rounded-lg border border-[--border-subtle] text-xs">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-2 font-medium transition-colors ${
                tab === t ? "bg-primary text-white" : "text-[--text-secondary] hover:bg-[--surface]"
              }`}
            >
              {t === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">用户名</Label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={tab === "register" ? "至少 2 个字符" : ""}
          autoComplete="username"
          autoFocus
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
            aria-label={showPw ? "隐藏密码" : "显示密码"}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
          >
            {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {tab === "register" && anonId && (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          检测到浏览器中有旧数据，注册后将自动迁移到新账号。
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={loading || !username.trim() || !password}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        {tab === "login" ? "登录" : "创建账号"}
      </Button>
    </form>
  );
}
