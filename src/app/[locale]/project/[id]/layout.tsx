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
 * 于是 `next=` 能精确指回这个项目，登录完直接回到原来那一页，deep link 不丢。
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
  await requirePageAuth(locale, `/${locale}/project/${id}`);

  return <ProjectShell id={id}>{children}</ProjectShell>;
}
