"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Clock, Sparkles, CircleCheck, FileText, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface ProjectCardProps {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

const statusConfig: Record<string, { dot: string; text: string; bg: string }> = {
  draft: {
    dot: "bg-[--text-muted]",
    text: "text-[--text-muted]",
    bg: "bg-[--surface]",
  },
  processing: {
    dot: "bg-[#F59E0B] animate-status-pulse",
    text: "text-[#B45309]",
    bg: "bg-[#FFFBEB]",
  },
  completed: {
    dot: "bg-[--success]",
    text: "text-[#047857]",
    bg: "bg-[#ECFDF5]",
  },
};

export function ProjectCard({ id, title, status, createdAt }: ProjectCardProps) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const config = statusConfig[status] || statusConfig.draft;

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteOpen(false);
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Link href={`/${locale}/project/${id}/episodes`} className="group block">
        <div className="relative flex flex-col rounded-xl border border-[--border-subtle] bg-white p-4 transition-all duration-200 hover:border-[--border-hover] hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
          {/* Delete button — top right */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDeleteOpen(true);
            }}
            className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
            title={tc("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          {/* Icon + Title */}
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
              {status === "completed" ? (
                <CircleCheck className="h-4 w-4" />
              ) : status === "processing" ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <h3 className="font-display text-sm font-semibold leading-snug text-[--text-primary] truncate">
                {title}
              </h3>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-[--text-muted]">
                <Clock className="h-3 w-3" />
                <span>{new Date(createdAt).toLocaleDateString(locale, { year: "numeric", month: "numeric", day: "numeric" })}</span>
              </div>
            </div>
          </div>

          {/* Footer: status + arrow */}
          <div className="mt-4 flex items-center justify-between border-t border-[--border-subtle] pt-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${config.bg} ${config.text}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
              {t(`projectStatus.${status}` as "projectStatus.draft" | "projectStatus.processing" | "projectStatus.completed")}
            </span>
            <div className="flex h-6 w-6 items-center justify-center rounded-full text-[--text-muted] transition-all duration-200 group-hover:bg-primary group-hover:text-white">
              <ArrowUpRight className="h-3 w-3" />
            </div>
          </div>
        </div>
      </Link>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirmDesc", { title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {tc("cancel")}
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? tc("loading") : tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
