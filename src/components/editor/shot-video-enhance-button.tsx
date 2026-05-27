"use client";

import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";

type ShotVideoEnhanceButtonProps = {
  projectId: string;
  shotId: string;
  videoUrl: string | null | undefined;
  videoResolution?: string | null;
  onEnhanced: () => void;
  disabled?: boolean;
  size?: "xs";
};

export function ShotVideoEnhanceButton({
  projectId,
  shotId,
  videoUrl,
  videoResolution,
  onEnhanced,
  disabled = false,
  size = "xs",
}: ShotVideoEnhanceButtonProps) {
  const [enhancing, setEnhancing] = useState(false);

  if (!videoUrl || videoResolution === "720p") {
    return null;
  }

  async function handleEnhance() {
    setEnhancing(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots/${shotId}/enhance`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "画质增强失败");
      }
      toast.success("画质增强完成，视频已升级至 720p");
      onEnhanced();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "画质增强失败");
    } finally {
      setEnhancing(false);
    }
  }

  return (
    <Button
      size={size}
      variant="outline"
      onClick={handleEnhance}
      disabled={disabled || enhancing}
      className="border-violet-300 text-violet-700 hover:bg-violet-50"
    >
      {enhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
      {enhancing ? "增强中…" : "画质增强↑720p"}
    </Button>
  );
}
