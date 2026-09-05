import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { parseCookieValue, AUTH_COOKIE } from "@/lib/auth";
import { ProjectCard } from "@/components/project-card";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Clapperboard, LogIn } from "lucide-react";
import Link from "next/link";
import { isAuthRequired } from "@/lib/get-user-id";
import { buttonVariants } from "@/components/ui/button-variants";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("dashboard");
  const cookieStore = await cookies();

  // Prefer the signed auth cookie (logged-in users) over the anonymous fingerprint.
  // ai_comic_auth is HttpOnly so it's invisible to JS, but readable here server-side.
  const authRaw = cookieStore.get(AUTH_COOKIE)?.value;
  const authUserId = authRaw ? parseCookieValue(authRaw) : null;
  const anonUserId = cookieStore.get("ai_comic_uid")?.value ?? "";
  const userId = authUserId ?? anonUserId;
  const isAuthenticated = Boolean(authUserId);
  // `REQUIRE_AUTH=1` 且未登录时，空首页并不是「还没建项目」，而是「没有身份所以什么都看不到」。
  // 这两种状态长得一模一样，却需要完全相反的引导 —— 不区分的话用户只会以为项目丢了。
  const needsLogin = isAuthRequired() && !isAuthenticated;

  const allProjects = userId
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(desc(projects.createdAt))
    : [];

  return (
    <div className="animate-page-in space-y-6">
      {/* Page header — same pattern as detail pages */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Clapperboard className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("title")}
            </h2>
            {allProjects.length > 0 && (
              <p className="text-xs text-[--text-muted]">
                {allProjects.length}{" "}
                {allProjects.length === 1 ? "project" : "projects"}
              </p>
            )}
          </div>
        </div>
        {needsLogin ? (
          <Link href={`/${locale}/login`} className={buttonVariants({ size: "sm" })}>
            <LogIn className="h-3.5 w-3.5" />
            登录
          </Link>
        ) : (
          <CreateProjectDialog />
        )}
      </div>

      {needsLogin ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <LogIn className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            请先登录
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            本站需要登录后才能查看和创建项目。你的项目没有丢失，登录后即可看到。
          </p>
          <div className="mt-6">
            <Link href={`/${locale}/login`} className={buttonVariants()}>
              <LogIn className="h-4 w-4" />
              去登录
            </Link>
          </div>
        </div>
      ) : allProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Clapperboard className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("title")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("noProjects")}
          </p>
          <div className="mt-6">
            <CreateProjectDialog />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allProjects.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              title={project.title}
              status={project.status}
              createdAt={project.createdAt.toISOString()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
