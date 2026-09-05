import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, parseCookieValue } from "@/lib/auth";
import { isAuthRequired } from "@/lib/get-user-id";

/**
 * 设置区（`/settings` 与 `/settings/prompts`）的登录闸。
 *
 * 常规网站的做法：**设置页本身就在登录之后**，未登录根本走不到，
 * 所以页面里也就不需要放一个登录入口。开了 `REQUIRE_AUTH` 就直接送去登录页。
 *
 * 未开 `REQUIRE_AUTH` 时**不拦**：自部署单机是匿名可用的，
 * 那种部署下设置页要能进去配模型，把人挡在外面等于废掉整个自部署场景
 * （与 `BILLING_ENABLED` / `WORKER_IN_WEB` 同一条原则：默认值要让单机装机即用）。
 * 那种情况下 `AuthSection` 里的「去登录」才是有意义的 —— 匿名用户需要一个升级成账号的入口。
 *
 * ⚠️ **这是 UX 跳转，不是安全边界。** 真正的准入在 API 那一层（约定 8b 的 api-guard）：
 * 绕过这个跳转直接打接口，一样会被 401/404 挡掉。
 *
 * 为什么放在 layout 而不是 middleware：middleware 跑在 edge runtime，
 * 没有 node 的 `crypto`，验签得用 Web Crypto 重写一遍 —— 那就有了第二份签名实现，
 * 早晚和 `lib/auth.ts` 那份漂移。layout 是服务端组件，能直接复用 `parseCookieValue`。
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

  if (isAuthRequired()) {
    const raw = (await cookies()).get(AUTH_COOKIE)?.value;
    if (!raw || !parseCookieValue(raw)) {
      redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/settings`)}`);
    }
  }

  return <>{children}</>;
}
