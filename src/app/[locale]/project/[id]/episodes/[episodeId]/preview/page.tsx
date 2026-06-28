/**
 * /preview 路由已合并进 /editor（第4步：剪辑导出）。
 * 保留此文件兼容旧书签，自动重定向。
 */
import { redirect } from "next/navigation";

export default async function PreviewRedirectPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; episodeId: string }>;
}) {
  const { locale, id, episodeId } = await params;
  redirect(`/${locale}/project/${id}/episodes/${episodeId}/editor`);
}
