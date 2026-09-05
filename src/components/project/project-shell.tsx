"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/stores/project-store";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, Loader2, Settings, Wand2 } from "lucide-react";
import { LogoIcon } from "@/components/logo";
import { VisualStylePicker } from "@/components/editor/visual-style-picker";

/**
 * 项目页的客户端外壳（顶栏 + 加载态）。
 *
 * 从原来的 `project/[id]/layout.tsx` 原样搬出来，**内容一行没改**。
 * 拆出来只是为了让那个 layout 能变成**服务端组件** —— 服务端组件才能读 cookie 做登录闸，
 * 而且它的 `params` 里有 `[id]`，所以能把 `next=` 精确地指回这个项目（deep link 不丢）。
 *
 * 注：顶栏里的 `/zh` 是原有写法。目前 `routing.locales` 只有 `zh`，所以无害；
 * 将来真要加语言时这几处要一起改。
 */
export function ProjectShell({
  children,
  id,
}: {
  children: React.ReactNode;
  id: string;
}) {
  const t = useTranslations("common");
  const { project, loading, fetchProject } = useProjectStore();

  useEffect(() => {
    fetchProject(id).catch((err) => {
      console.error("[ProjectLayout] fetchProject failed:", err);
    });
  }, [id, fetchProject]);

  if (loading || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-white/80 backdrop-blur-xl px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/zh"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-4 w-px bg-[--border-subtle]" />
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[--primary]/10 text-[--primary]">
              <LogoIcon size={14} />
            </div>
            <h1 className="font-display text-sm font-semibold text-[--text-primary]">
              {project.title}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VisualStylePicker />
          <div className="flex items-center gap-1">
          <Link
            href={`/zh/settings/prompts?scope=project&projectId=${id}`}
            title="项目提示词"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <Wand2 className="h-4 w-4" />
          </Link>
          <Link
            href="/zh/settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <Settings className="h-4 w-4" />
          </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      {children}
    </div>
  );
}
