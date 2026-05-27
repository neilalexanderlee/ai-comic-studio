"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { Check, ClipboardCopy, Copy, Loader2 } from "lucide-react";

type FramePromptPreview = {
  reusePreviousLastFrame: boolean;
  firstPrompt: string;
  lastPrompt: string;
  startFrameDesc: string;
  endFrameDesc: string;
};

type ShotExternalFrameHelperProps = {
  projectId: string;
  shotId: string;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
};

/** 外链出图：复制 Seedream 首尾帧 prompt（列表/抽屉共用） */
export function ShotExternalFrameHelper({
  projectId,
  shotId,
  disabled = false,
  variant = "ghost",
}: ShotExternalFrameHelperProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FramePromptPreview | null>(null);
  const [copied, setCopied] = useState<"first" | "last" | null>(null);

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setData(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "frame_prompt_preview",
          payload: { shotId },
        }),
      });
      const json = (await res.json()) as FramePromptPreview;
      setData(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(kind: "first" | "last") {
    if (!data) return;
    const text = kind === "first" ? data.firstPrompt : data.lastPrompt;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <>
      <Button size="xs" variant={variant} onClick={handleOpen} disabled={disabled}>
        <ClipboardCopy className="h-3 w-3" />
        {t("shot.externalFrameHelper")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("shot.externalFrameHelper")}</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : data ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[--border-subtle] bg-[--surface] p-3 text-xs text-[--text-secondary]">
                <div>{t("shot.externalFrameHelperHint")}</div>
                {data.reusePreviousLastFrame && (
                  <div className="mt-1 text-amber-700">{t("shot.reusePreviousLastFrame")}</div>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-blue-700">{t("shot.startFramePrompt")}</div>
                    <Button size="xs" variant="outline" onClick={() => handleCopy("first")}>
                      {copied === "first" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied === "first" ? t("common.copied") : t("shot.copyPrompt")}
                    </Button>
                  </div>
                  <div className="mb-2 text-[11px] text-[--text-muted]">{data.startFrameDesc}</div>
                  <Textarea value={data.firstPrompt} readOnly rows={14} className="font-mono text-xs leading-relaxed" />
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-amber-700">{t("shot.endFramePrompt")}</div>
                    <Button size="xs" variant="outline" onClick={() => handleCopy("last")}>
                      {copied === "last" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied === "last" ? t("common.copied") : t("shot.copyPrompt")}
                    </Button>
                  </div>
                  <div className="mb-2 text-[11px] text-[--text-muted]">{data.endFrameDesc}</div>
                  <Textarea value={data.lastPrompt} readOnly rows={14} className="font-mono text-xs leading-relaxed" />
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
