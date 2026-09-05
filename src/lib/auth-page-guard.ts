import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, parseCookieValue } from "@/lib/auth";
import { isAuthRequired } from "@/lib/get-user-id";

/**
 * 页面级登录闸，供各 segment layout 复用。
 *
 * ## 产品上为什么是「跳转」而不是「显示一个请登录的空页面」
 *
 * 整站需要登录时，访问首页就送到登录页是常规做法。
 * 之前首页在未登录时渲染一张「请先登录」卡片，结果**同一屏出现两个登录按钮**
 * （顶栏一个 + 卡片里一个），而且用户还得多点一次才能到登录页。
 * 跳转把这个重复从结构上消掉，而不是靠删掉其中一个按钮。
 *
 * ## 两条必须记住的约束
 *
 * 1. **未开 `REQUIRE_AUTH` 时不能拦。** 自部署单机是匿名可用的，
 *    拦住等于废掉整个自部署场景（与 `BILLING_ENABLED` / `WORKER_IN_WEB` 同一条原则：
 *    默认值要让单机装机即用）。
 * 2. **这是 UX 跳转，不是安全边界。** 真正的准入在 API 那一层（约定 8b 的 api-guard）——
 *    绕过跳转直接打接口一样会被 401/404 挡掉。不要因为「页面拦住了」就放松接口侧校验。
 *
 * 放在 segment layout 而不是 middleware：middleware 跑在 edge runtime，没有 node 的
 * `crypto`，在那里验签得用 Web Crypto 再写一份 HMAC —— 于是仓库里有两份签名实现，早晚漂移。
 *
 * @param locale  当前语言段
 * @param nextPath 登录后要回到的站内路径；省略则回首页
 */
export async function requirePageAuth(locale: string, nextPath?: string): Promise<void> {
  if (!isAuthRequired()) return;

  const raw = (await cookies()).get(AUTH_COOKIE)?.value;
  if (raw && parseCookieValue(raw)) return;

  const next = nextPath ?? `/${locale}`;
  redirect(`/${locale}/login?next=${encodeURIComponent(next)}`);
}
