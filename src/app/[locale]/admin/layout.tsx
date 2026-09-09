import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AUTH_COOKIE, parseCookieValue } from "@/lib/auth";
import { requirePageAuth } from "@/lib/auth-page-guard";
import { isAdminUser } from "@/lib/admin";

/**
 * `/admin` 的准入。两道：先登录闸（复用 `requirePageAuth`），再管理员校验。
 *
 * **非管理员返回 404 而不是 403**：这是页面层，不该告诉外面「这个站有管理后台、
 * 只是你不能进」。接口层的 `requireAdmin` 才返回 403 —— 那边调用者已经通过了
 * 身份校验，说清楚原因才是对的。
 *
 * ⚠️ 与所有页面闸一样，这是 UX，不是安全边界：真正的准入在
 * `/api/admin/*` 的 `requireAdmin` 上（约定 8b）。
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePageAuth(locale, `/${locale}/admin`);

  const raw = (await cookies()).get(AUTH_COOKIE)?.value;
  const userId = raw ? parseCookieValue(raw) : null;
  if (!userId || !(await isAdminUser(userId))) notFound();

  return <>{children}</>;
}
