import { requirePageAuth } from "@/lib/auth-page-guard";

/**
 * `/settings` 自己的登录闸。
 *
 * ## 为什么用 `(root)` 路由组而不是放在上一层 `settings/layout.tsx`
 *
 * 放上一层的话，它**看不出你要的是 `/settings` 还是 `/settings/prompts`**
 * （layout 只拿得到 `params`，拿不到完整 pathname），于是只能一律
 * `next=/settings` —— 想去提示词管理的人登录完落在设置首页，还得再点一次。
 *
 * 路由组 `(root)` 不占 URL 段（`(root)/page.tsx` 服务的仍是 `/settings`），
 * 但它给了 `/settings` 一个**独享的 layout**，于是每个叶子路由都能带自己精确的 `next`。
 * `prompts/layout.tsx` 是同样的做法。
 *
 * 父层不能留守卫：父层先执行，它一 redirect 子层就没机会了。
 */
export default async function SettingsRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePageAuth(locale, `/${locale}/settings`);
  return <>{children}</>;
}
