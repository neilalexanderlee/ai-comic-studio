"use client";

import { useEffect, use } from "react";
import { useProjectStore } from "@/stores/project-store";
import { ProjectNav } from "@/components/editor/project-nav";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export default function EpisodeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; episodeId: string }>;
}) {
  const { id, episodeId } = use(params);
  const t = useTranslations("common");
  const { project, loading, fetchProject } = useProjectStore();

  useEffect(() => {
    fetchProject(id, episodeId);
  }, [id, episodeId, fetchProject]);

  if (loading || !project) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="ml-2 text-sm text-[--text-muted]">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <ProjectNav projectId={id} episodeId={episodeId} />
      <main className="flex-1 overflow-y-auto bg-[--surface] p-6 pb-24 lg:pb-6">
        {children}
      </main>
    </div>
  );
}
