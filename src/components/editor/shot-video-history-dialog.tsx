"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type HistoryEntry = {
  id: string;
  videoUrl: string;
  resolution: string | null;
  label: string | null;
  createdAt: number;
};

type ShotVideoHistoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  shotId: string;
  onReverted: () => void;
};

export function ShotVideoHistoryDialog({
  open,
  onOpenChange,
  projectId,
  shotId,
  onReverted,
}: ShotVideoHistoryDialogProps) {
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const res = await apiFetch(`/api/projects/${projectId}/shots/${shotId}/video-history`);
        const data = (await res.json()) as { history?: HistoryEntry[] };
        if (!cancelled) setHistoryList(data.history ?? []);
      } catch {
        if (!cancelled) setHistoryList([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, shotId]);

  async function handleRevert(historyId: string) {
    setRevertingId(historyId);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots/${shotId}/video-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId }),
      });
      if (!res.ok) throw new Error("恢复失败");
      toast.success("已恢复该历史版本");
      onReverted();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRevertingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            视频历史版本
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-2">
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[--text-muted]" />
            </div>
          ) : historyList.length === 0 ? (
            <p className="py-6 text-center text-sm text-[--text-muted]">暂无历史版本</p>
          ) : (
            historyList.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-lg border border-[--border-subtle] p-2.5"
              >
                <div className="h-14 w-24 flex-shrink-0 overflow-hidden rounded-md bg-black">
                  <video src={uploadUrl(entry.videoUrl)} className="h-full w-full object-contain" muted />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[--text-primary]">
                    {entry.label ?? "视频"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[--text-muted]">
                    {new Date(entry.createdAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {entry.resolution && (
                      <span
                        className={`ml-1.5 rounded px-1 py-px font-bold ${
                          entry.resolution === "720p"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {entry.resolution}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => handleRevert(entry.id)}
                  disabled={revertingId === entry.id}
                  className="flex-shrink-0"
                >
                  {revertingId === entry.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  恢复
                </Button>
              </div>
            ))
          )}
          <p className="pt-1 text-center text-[10px] text-[--text-muted]">
            最多保留 5 个历史版本，超出时自动清理最旧的
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
