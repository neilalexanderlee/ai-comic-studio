"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Plus, Loader2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

export function CreateProjectDialog() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setLoading(true);

    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    const project = await res.json();
    setOpen(false);
    setTitle("");
    setLoading(false);
    router.push(`/${locale}/project/${project.id}/script`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" className="gap-1.5" />}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("dashboard.newProject")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[--primary]" />
            {t("dashboard.newProject")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="title">{t("project.title")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Epic Comic..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  handleCreate();
                }
              }}
              autoFocus
            />
          </div>
          <Button
            onClick={handleCreate}
            disabled={loading || !title.trim()}
            className="w-full"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
