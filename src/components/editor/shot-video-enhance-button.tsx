"use client";

import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { resolutionRank } from "@/lib/billing/pricing";
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

/**
 * 可升级到的档位。provider 还支持 `4k`，**刻意不放出来** ——
 * 它的成本是 480p 的 20 倍，一次误点的代价太大；真要用可以直接调接口。
 */
const TARGETS = ["720p", "1080p"] as const;

/**
 * 画质增强按钮 —— 每个比当前分辨率更高的档位渲染一个按钮。
 *
 * 之所以不是单个按钮：目标分辨率必须是**用户显式选的**。
 * 这里原本写死 720p，而路由压根没把分辨率传给 provider，
 * 于是实际产出的是 provider 默认的 1080p —— 用户以为拿到 720p、
 * 实际拿到 1080p，额度也只按 720p 扣。三处（按钮文案/落库/额度）
 * 现在都跟着同一个 target 走。
 */
export function ShotVideoEnhanceButton({
  projectId,
  shotId,
  videoUrl,
  videoResolution,
  onEnhanced,
  disabled = false,
  size = "xs",
}: ShotVideoEnhanceButtonProps) {
  const [enhancing, setEnhancing] = useState<string | null>(null);

  if (!videoUrl) return null;

  // 只显示比当前更高的档位；已经是 1080p 就一个都不显示
  const current = resolutionRank(videoResolution);
  const targets = TARGETS.filter((t) => resolutionRank(t) > current);
  if (targets.length === 0) return null;

  async function handleEnhance(target: string) {
    setEnhancing(target);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots/${shotId}/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: target }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "画质增强失败");
      toast.success(`画质增强完成，视频已升级至 ${target}`);
      onEnhanced();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "画质增强失败");
    } finally {
      setEnhancing(null);
    }
  }

  return (
    <>
      {targets.map((t) => (
        <Button
          key={t}
          size={size}
          variant="outline"
          onClick={() => handleEnhance(t)}
          disabled={disabled || enhancing !== null}
          title={
            t === "1080p"
              ? "升到 1080p。成本约为 480p 的 5 倍，额度也按这个倍率扣"
              : "升到 720p。成本约为 480p 的 2.25 倍，额度也按这个倍率扣"
          }
          className="border-violet-300 text-violet-700 hover:bg-violet-50"
        >
          {enhancing === t ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Wand2 className="h-3 w-3" />
          )}
          {enhancing === t ? "增强中…" : `↑${t}`}
        </Button>
      ))}
    </>
  );
}
