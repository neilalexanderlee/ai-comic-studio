"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { migrateAndClearAnonymousId, getAnonymousId } from "@/lib/client/anon-session";

export type AuthMode = "login" | "register";

interface Props {
  mode: AuthMode;
  /** 成功后回到哪里。已由服务端的 safeNext 校验过是站内相对路径 */
  next: string;
}

/**
 * 登录 / 注册表单。**一个模式一个页面**，不再用页签切换。
 *
 * 之前登录页内嵌了「登录/注册」两个页签。改成两个独立路由是因为：
 *  - `/register` 需要能被直接链接、直接分享，页签做不到；
 *  - 关闭自助注册时（`ALLOW_REGISTRATION=0`）整条路由都该给出明确说明，
 *    而不是在登录页里少渲染一个页签、让人不知道注册去哪了。
 *
 * 匿名数据迁移走 `lib/client/anon-session`，与设置页共用一份实现。
 */
export function AuthForm({ mode, next }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";
  const [anonId, setAnonId] = useState<string | null>(null);

  // ⚠️ **必须在 effect 里读，不能在 render 里读。**
  // localStorage 只有浏览器有：直接在 render 中调用，服务端渲染出 null、
  // 客户端渲染出真实值，两份 HTML 不一致 → hydration mismatch。
  // 只在注册时提示「会迁移旧数据」，登录时提这个只会让人困惑。
  useEffect(() => {
    if (isRegister) setAnonId(getAnonymousId());
  }, [isRegister]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    try {
      const res = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
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
        isRegister ? `账号创建成功，欢迎 ${data.username}！` : `欢迎回来，${data.username}！`
      );

      // replace 而不是 push：登录/注册页不该留在后退历史里
      router.replace(next);
      // 首页是服务端组件、按 cookie 查项目；不 refresh 会拿到登录前那份空结果
      router.refresh();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">用户名</Label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={isRegister ? "至少 2 个字符" : ""}
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
            placeholder={isRegister ? "至少 6 个字符" : ""}
            autoComplete={isRegister ? "new-password" : "current-password"}
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

      {anonId && (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          检测到浏览器中有旧数据，注册后将自动迁移到新账号。
        </p>
      )}

      {/*
        提交按钮**刻意不放图标**。lucide 的 `LogIn` 与 `LogOut` 是一对镜像箭头
        （`→]` / `[→`），并排出现时几乎分辨不出来 —— 用户反馈过「登录和退出用的是同一个图标」。
        主 CTA 的文字本身已经足够明确，全站因此只保留 `LogOut` 一个箭头类图标，
        不会再出现两个相似图标同时存在的情况。
      */}
      <Button type="submit" className="w-full" disabled={loading || !username.trim() || !password}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {isRegister ? "创建账号" : "登录"}
      </Button>
    </form>
  );
}
