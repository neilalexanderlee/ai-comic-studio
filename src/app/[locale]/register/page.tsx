import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";
import { AUTH_COOKIE, parseCookieValue } from "@/lib/auth";
import { safeNext } from "@/lib/auth-next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { buttonVariants } from "@/components/ui/button-variants";

/**
 * `/[locale]/register` —— 独立的注册页。
 *
 * ⚠️ **关闭自助注册时不 redirect，而是明确说明。**
 * 悄悄跳回登录页的话，用户点了「注册」却回到登录页，只会以为是网站坏了。
 * 何况这条路由本来就只有手动输网址才会到（关闭注册时登录页不给链接），
 * 到这儿的人正需要一句解释。
 *
 * 真正的准入控制在 `POST /api/auth/register` 里（`ALLOW_REGISTRATION`），
 * 这一页只是界面 —— 即使有人绕过界面直接打接口，也一样会被服务端拒。
 */
export default async function RegisterPage({
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
  if (authRaw && parseCookieValue(authRaw)) redirect(next);

  const loginHref = `/${locale}/login${rawNext ? `?next=${encodeURIComponent(next)}` : ""}`;
  const allowRegistration = process.env.ALLOW_REGISTRATION !== "0";

  if (!allowRegistration) {
    return (
      <AuthShell subtitle="注册已关闭">
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[--surface] text-[--text-muted]">
            <Shield className="h-5 w-5" />
          </div>
          <p className="text-sm leading-relaxed text-[--text-secondary]">
            本站已关闭自助注册。
            <br />
            需要账号请联系管理员开通。
          </p>
          <Link href={loginHref} className={buttonVariants({ variant: "outline" })}>
            返回登录
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      subtitle="创建账号后，数据存在服务器，换设备也在"
      footer={
        <p>
          已有账号？
          <Link
            href={loginHref}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            去登录
          </Link>
        </p>
      }
    >
      <AuthForm mode="register" next={next} />
    </AuthShell>
  );
}
