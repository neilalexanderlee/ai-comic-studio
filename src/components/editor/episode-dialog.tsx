"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface EpisodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { title: string; description?: string; keywords?: string }) => Promise<void>;
  defaultValues?: { title?: string; description?: string; keywords?: string };
  mode?: "create" | "edit";
}

export function EpisodeDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  mode = "create",
}: EpisodeDialogProps) {
  const t = useTranslations("episode");
  const tc = useTranslations("common");
  const [title, setTitle] = useState(defaultValues?.title || "");
  const [description, setDescription] = useState(defaultValues?.description || "");
  const [keywords, setKeywords] = useState(defaultValues?.keywords || "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(defaultValues?.title || "");
      setDescription(defaultValues?.description || "");
      setKeywords(defaultValues?.keywords || "");
    }
  }, [open, defaultValues?.title, defaultValues?.description, defaultValues?.keywords]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        keywords: keywords.trim() || undefined,
      });
      setTitle("");
      setDescription("");
      setKeywords("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("create") : t("edit")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[--text-primary]">
              {t("title")} *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[--text-primary]">
              {t("description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              rows={3}
              className="w-full rounded-xl border border-[--border-subtle] bg-[--surface] px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-[--text-muted] focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[--text-primary]">
              {t("keywords")}
            </label>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("keywordsPlaceholder")}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={!title.trim() || submitting}>
              {submitting ? tc("loading") : tc("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
