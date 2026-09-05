import { requirePageAuth } from "@/lib/auth-page-guard";

/**
 * 设置区（`/settings` 与 `/settings/prompts`）的登录闸。
 *
 * 常规网站的做法：**设置页本身就在登录之后**，未登录根本走不到，
 * 所以页面里也就不需要放登录入口。判定逻辑见 `requirePageAuth`。
 *
 * 已知小瑕疵：从 `/settings/prompts` 被踢出去时，登录后回到的是 `/settings` 而不是原子页 ——
 * layout 拿不到具体 pathname。为这点精度去 middleware 里传 header 不划算。
 */
export default async function SettingsLayout({
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
