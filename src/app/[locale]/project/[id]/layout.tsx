import { requirePageAuth } from "@/lib/auth-page-guard";
import { ProjectShell } from "@/components/project/project-shell";

/**
 * 项目区的登录闸。
 *
 * 之前这里是个客户端组件，所以加不了服务端闸：未登录访问一个项目链接会得到 **404**。
 * 不泄漏数据，但对「收藏了项目链接、隔天再打开」的人是个死胡同 —— 他不知道该去哪登录。
 *
 * 现在拆成「服务端 layout（本文件，负责闸）+ 客户端外壳（ProjectShell，负责 UI）」。
 * 这么拆的关键收益：**本文件的 `params` 里有 `[id]`**，
 * 于是 `next=` 能指回**这个项目**而不是退化成首页。
 * （拿不到具体子路由，所以统一回默认入口 `/episodes`，与设置区同样的已知取舍。）
 *
 * 对比之下，如果只在上一层加 `project/layout.tsx`，那一层拿不到 `[id]`，
 * `next=` 只能退化成首页 —— 那还不如不做。
 *
 * 判定逻辑（未开 REQUIRE_AUTH 不拦、这是 UX 跳转不是安全边界）见 `requirePageAuth`。
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  // ⚠️ next 必须指向 `/episodes` 而不是 `/project/${id}` ——
  // **后者没有 page.tsx，是个 404**（这一层只有子路由）。
  // 指过去的话用户登录完会直接落到一个 404 上，比原来的死胡同还糟。
  // `/episodes` 是项目的默认入口（点项目卡片去的就是这里，见 project-card.tsx）。
  await requirePageAuth(locale, `/${locale}/project/${id}/episodes`);

  return <ProjectShell id={id}>{children}</ProjectShell>;
}
