import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";
import { AUTH_COOKIE, parseCookieValue } from "@/lib/auth";
import { isAuthRequired } from "@/lib/get-user-id";
import { safeNext } from "@/lib/auth-next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";

/**
 * `/[locale]/login` —— 未登录时的入口。
 *
 * 为什么需要单独一页：`REQUIRE_AUTH=1` 之下，未登录访客看到的是一个**数据全空的首页**，
 * 而登录表单原本藏在设置页里，界面上没有任何「去登录」的入口 ——
 * 用户只会以为「我的项目丢了」。2026-09-05 真实发生过（管理员自己也是摸进设置页才登上的）。
 */
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
  // 已登录就不该再看登录页，直接送回目的地
  if (authRaw && parseCookieValue(authRaw)) redirect(next);

  const allowRegistration = process.env.ALLOW_REGISTRATION !== "0";
  const authRequired = isAuthRequired();
  const registerHref = `/${locale}/register${
    rawNext ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  return (
    <AuthShell
      subtitle={authRequired ? "本站需要登录后使用" : "登录后数据存在服务器，换设备也在"}
      footer={
        <>
          {allowRegistration ? (
            <p>
              还没有账号？
              <Link
                href={registerHref}
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                注册一个
              </Link>
            </p>
          ) : (
            <p className="flex items-start justify-center gap-1.5 px-2 leading-relaxed">
              <Shield className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>本站已关闭自助注册，账号请联系管理员开通。</span>
            </p>
          )}
          {!authRequired && (
            // 匿名可用的部署（自部署单机）不该把人堵在登录页上
            <p>
              <Link href={home} className="underline underline-offset-2 hover:text-[--text-primary]">
                先不登录，直接使用
              </Link>
            </p>
          )}
        </>
      }
    >
      <AuthForm mode="login" next={next} />
    </AuthShell>
  );
}
