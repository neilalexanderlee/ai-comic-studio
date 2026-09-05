import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";
import { AUTH_COOKIE, parseCookieValue } from "@/lib/auth";
import { isAuthRequired } from "@/lib/get-user-id";
import { LogoIcon } from "@/components/logo";
import { LoginForm } from "@/components/auth/login-form";

/**
 * `/[locale]/login` —— 未登录时的入口。
 *
 * 为什么需要单独一页：`REQUIRE_AUTH=1` 之下，未登录访客看到的是一个**数据全空的首页**，
 * 而登录表单藏在设置页里，界面上没有任何「去登录」的引导 ——
 * 用户只会以为「我的项目没了」。2026-09-05 真实发生过（管理员自己也是摸进设置页才登上的）。
 */

/**
 * 只允许跳回**站内相对路径**。
 *
 * `?next=` 直接拿来 redirect 就是开放重定向：攻击者发一个
 * `/zh/login?next=https://evil.com` 的链接，用户在**我们的域名**下登录完，
 * 被送到钓鱼站，而地址栏一路看着都是可信的。
 *
 * `//evil.com` 也要挡 —— 那是协议相对 URL，浏览器会当成跨站地址。
 * `/\evil.com` 同理（部分浏览器把反斜杠规范化成斜杠）。
 */
export function safeNext(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next: rawNext } = await searchParams;
  const home = `/${locale}`;
  const next = safeNext(rawNext, home);

  const authRaw = (await cookies()).get(AUTH_COOKIE)?.value;
  // 已登录就不要再看登录页了，直接送回目的地
  if (authRaw && parseCookieValue(authRaw)) redirect(next);

  const allowRegistration = process.env.ALLOW_REGISTRATION !== "0";
  const authRequired = isAuthRequired();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[--surface] p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LogoIcon size={22} />
          </div>
          <h1 className="font-display text-lg font-bold tracking-tight text-[--text-primary]">
            AI 漫剧工坊
          </h1>
          <p className="text-xs text-[--text-muted]">
            {authRequired ? "本站需要登录后使用" : "登录后数据存在服务器，换设备也在"}
          </p>
        </div>

        <div className="rounded-2xl border border-[--border-subtle] bg-white p-6 shadow-sm">
          <LoginForm allowRegistration={allowRegistration} next={next} />
        </div>

        {!allowRegistration && (
          <p className="flex items-start justify-center gap-1.5 px-2 text-center text-[11px] leading-relaxed text-[--text-muted]">
            <Shield className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>本站已关闭自助注册，账号请联系管理员开通。</span>
          </p>
        )}

        {!authRequired && (
          // 匿名可用的部署（自部署单机）不该把人堵在登录页上
          <p className="text-center text-[11px] text-[--text-muted]">
            <Link href={home} className="underline underline-offset-2 hover:text-[--text-primary]">
              先不登录，直接使用
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
