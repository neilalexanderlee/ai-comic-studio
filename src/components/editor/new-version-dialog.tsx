"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, GitBranch, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import type { StoryboardVersion } from "@/stores/project-store";

interface NewVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  episodeId: string;
  versions: StoryboardVersion[];
  currentVersionId: string | null;
  onCreated: (versionId: string) => void;
}

type CopyField = "copyText" | "copyFrames" | "copyVideoPrompts" | "copyVideos";

const COPY_OPTIONS: { key: CopyField; label: string; desc: string }[] = [
  { key: "copyText",        label: "分镜描述",     desc: "提示词 / 动作脚本 / 首尾帧描述" },
  { key: "copyFrames",      label: "图片帧",        desc: "首帧 / 尾帧 / 参考帧" },
  { key: "copyVideoPrompts",label: "视频提示词",   desc: "video prompt / 视频脚本" },
  { key: "copyVideos",      label: "视频",          desc: "已生成的视频文件" },
];

export function NewVersionDialog({
  open,
  onOpenChange,
  projectId,
  episodeId,
  versions,
  currentVersionId,
  onCreated,
}: NewVersionDialogProps) {
  const [label, setLabel] = useState("");
  const [sourceId, setSourceId] = useState<string>("none");
  const [copyFlags, setCopyFlags] = useState<Record<CopyField, boolean>>({
    copyText: true,
    copyFrames: false,
    copyVideoPrompts: false,
    copyVideos: false,
  });
  const [loading, setLoading] = useState(false);

  // When dialog opens, default source to current version
  function handleOpen(v: boolean) {
    if (v) {
      setSourceId(currentVersionId ?? "none");
      setLabel("");
      setCopyFlags({ copyText: true, copyFrames: false, copyVideoPrompts: false, copyVideos: false });
    }
    onOpenChange(v);
  }

  function toggleFlag(key: CopyField) {
    setCopyFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleCreate() {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        label: label.trim() || undefined,
        sourceVersionId: sourceId === "none" ? null : sourceId,
        ...copyFlags,
      };
      const res = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/versions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      const data = await res.json();
      toast.success(`已创建版本 ${data.label}`);
      onOpenChange(false);
      onCreated(data.versionId);
    } catch (err) {
      toast.error("创建失败，请重试");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const hasSource = sourceId !== "none";

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            新建版本
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* 版本名称 */}
          <div className="space-y-1.5">
            <Label htmlFor="ver-label">版本名称</Label>
            <Input
              id="ver-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="留空则自动命名（如 20250506-V2）"
              autoFocus
            />
          </div>

          {/* 基于哪个版本 */}
          <div className="space-y-1.5">
            <Label>基于</Label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-[--border-subtle] px-3 py-2.5 transition-colors hover:bg-[--surface]">
                <input
                  type="radio"
                  name="source"
                  value="none"
                  checked={sourceId === "none"}
                  onChange={() => setSourceId("none")}
                  className="accent-primary"
                />
                <span className="text-sm font-medium text-[--text-primary]">从头开始（空版本）</span>
              </label>
              {versions.map((v) => (
                <label
                  key={v.id}
                  className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-[--border-subtle] px-3 py-2.5 transition-colors hover:bg-[--surface]"
                >
                  <input
                    type="radio"
                    name="source"
                    value={v.id}
                    checked={sourceId === v.id}
                    onChange={() => setSourceId(v.id)}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium text-[--text-primary]">{v.label}</span>
                  {v.id === currentVersionId && (
                    <span className="ml-auto text-[10px] font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">
                      当前
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* 复制内容（仅基于已有版本时显示） */}
          {hasSource && (
            <div className="space-y-1.5">
              <Label>复制内容</Label>
              <div className="rounded-xl border border-[--border-subtle] divide-y divide-[--border-subtle]">
                {COPY_OPTIONS.map(({ key, label: optLabel, desc }) => (
                  <label
                    key={key}
                    className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[--surface] transition-colors first:rounded-t-xl last:rounded-b-xl"
                  >
                    <input
                      type="checkbox"
                      checked={copyFlags[key]}
                      onChange={() => toggleFlag(key)}
                      className="accent-primary mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    />
                    <div>
                      <div className="text-sm font-medium text-[--text-primary]">{optLabel}</div>
                      <div className="text-[11px] text-[--text-muted] mt-0.5">{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleCreate} disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {loading ? "创建中..." : "创建版本"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
