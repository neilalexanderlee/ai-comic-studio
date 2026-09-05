import { requirePageAuth } from "@/lib/auth-page-guard";

/**
 * `/settings/prompts` 自己的登录闸 —— 带**精确的** `next`。
 *
 * 之前守卫在上一层 `settings/layout.tsx`，那一层不知道你要的是哪个子页，
 * 只能一律回 `/settings`。现在每个叶子路由各自守卫，
 * 收藏了提示词管理页的人登录完就直接回到这一页。
 *
 * 见 `(root)/layout.tsx` 里对这套结构的说明。
 */
export default async function PromptsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePageAuth(locale, `/${locale}/settings/prompts`);
  return <>{children}</>;
}
