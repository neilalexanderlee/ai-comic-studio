"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";

type ShotRestoreFromScriptButtonProps = {
  projectId: string;
  shotId: string;
  onRestored: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
};

export function ShotRestoreFromScriptButton({
  projectId,
  shotId,
  onRestored,
  disabled = false,
  variant = "outline",
}: ShotRestoreFromScriptButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleRestore() {
    setLoading(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_shot_restore_from_script",
          payload: { shotId },
        }),
      });
      onRestored();
      toast.success("已从原始剧本还原文本字段");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "从剧本还原失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="xs" variant={variant} onClick={handleRestore} disabled={disabled || loading}>
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
      {loading ? "还原中…" : "从剧本还原"}
    </Button>
  );
}
