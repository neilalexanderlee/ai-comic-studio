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
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { FileText, Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

type Mode = "blank" | "ai";

export function CreateProjectDialog() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("blank");
  const [title, setTitle] = useState("");
  const [outline, setOutline] = useState("");
  const [loading, setLoading] = useState(false);

  function reset() {
    setTitle("");
    setOutline("");
    setMode("blank");
    setLoading(false);
  }

  async function handleCreate() {
    if (!title.trim()) return;
    if (mode === "ai" && !outline.trim()) return;
    setLoading(true);

    try {
      const body: { title: string; idea?: string } = { title };
      if (mode === "ai") body.idea = outline;

      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const project = await res.json();
      setOpen(false);
      reset();

      if (mode === "ai") {
        router.push(`/${locale}/project/${project.id}/auto-pipeline`);
      } else {
        router.push(`/${locale}/project/${project.id}/script`);
      }
    } catch {
      setLoading(false);
    }
  }

  const canSubmit =
    !loading &&
    title.trim().length > 0 &&
    (mode === "blank" || outline.trim().length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-3.5 w-3.5" />
        {t("dashboard.newProject")}
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[--primary]" />
            {t("dashboard.newProject")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Mode tabs */}
          <div className="flex rounded-xl border border-[--border-subtle] p-1 gap-1 bg-[--surface]">
            <button
              onClick={() => setMode("blank")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                mode === "blank"
                  ? "bg-white text-[--text-primary] shadow-sm"
                  : "text-[--text-muted] hover:text-[--text-secondary]"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              空白项目
            </button>
            <button
              onClick={() => setMode("ai")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                mode === "ai"
                  ? "bg-white text-primary shadow-sm"
                  : "text-[--text-muted] hover:text-[--text-secondary]"
              }`}
            >
              <Wand2 className="h-3.5 w-3.5" />
              AI 自动生成
            </button>
          </div>

          {/* AI mode description */}
          {mode === "ai" && (
            <div className="rounded-xl bg-primary/5 border border-primary/15 px-3.5 py-3 text-xs text-primary leading-relaxed">
              <strong>全自动流水线：</strong>
              输入故事大纲，AI 将自动扩写为完整剧本、提取角色定妆词、分集，并写入数据库。
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="proj-title">{t("project.title")}</Label>
            <Input
              id="proj-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={mode === "ai" ? "例如：《大剑勇者》" : "My Epic Comic..."}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && mode === "blank") {
                  handleCreate();
                }
              }}
              autoFocus
            />
          </div>

          {/* Outline textarea (AI mode only) */}
          {mode === "ai" && (
            <div className="space-y-2">
              <Label htmlFor="proj-outline">
                故事大纲
                <span className="ml-1 text-[10px] font-normal text-[--text-muted]">
                  （描述世界观、主角、核心冲突即可）
                </span>
              </Label>
              <Textarea
                id="proj-outline"
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                placeholder={`例如：\n一个叫龙渊的少年剑客，在末世大陆上寻找失落的古剑「大剑」。\n他需要打败魔王军团，途中结识了精灵弓手翠蒂娜和神秘法师凌瑶。\n故事充满热血打斗，最终在古遗迹决战中揭开了大剑的秘密。`}
                className="min-h-[130px] resize-none text-sm leading-relaxed"
              />
              <p className="text-[10px] text-[--text-muted]">
                {outline.length} 字 · 建议 100–500 字，AI 会自动扩充为 8–24 集完整剧本
              </p>
            </div>
          )}

          {/* Submit */}
          <Button onClick={handleCreate} disabled={!canSubmit} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                创建中...
              </>
            ) : mode === "ai" ? (
              <>
                <Wand2 className="h-4 w-4" />
                创建并开始 AI 生成
              </>
            ) : (
              t("common.create")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
