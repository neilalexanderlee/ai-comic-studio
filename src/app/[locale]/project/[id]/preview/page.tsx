import { redirect } from "next/navigation";

export default async function LegacyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  redirect(`/${locale}/project/${id}/episodes`);
}
