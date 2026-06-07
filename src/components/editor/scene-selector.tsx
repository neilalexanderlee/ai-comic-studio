"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { MapPin, X, Check, Loader2 } from "lucide-react";

interface Scene {
  id: string;
  name: string;
  imagePath: string | null;
}

interface SceneSelectorProps {
  projectId: string;
  episodeId?: string | null;
  shotId: string;
  currentSceneId?: string | null;
  onUpdate: () => void;
  disabled?: boolean;
}

export function SceneSelector({
  projectId,
  episodeId,
  shotId,
  currentSceneId,
  onUpdate,
  disabled = false,
}: SceneSelectorProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const url = episodeId
      ? `/api/projects/${projectId}/scenes?episodeId=${episodeId}`
      : `/api/projects/${projectId}/scenes`;
    apiFetch(url)
      .then((r) => r.json())
      .then((data: Scene[]) => setScenes(data))
      .catch(() => {});
  }, [projectId, episodeId]);

  const current = scenes.find((s) => s.id === currentSceneId);

  async function select(sceneId: string | null) {
    setSaving(true);
    setOpen(false);
    try {
      await apiFetch(`/api/projects/${projectId}/shots/${shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      onUpdate();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  if (scenes.length === 0) return null;

  return (
    <div className="relative">
      {/* 触发按钮 */}
      <button
        onClick={() => !disabled && !saving && setOpen((v) => !v)}
        disabled={disabled || saving}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
          current
            ? "bg-primary/8 text-primary hover:bg-primary/15"
            : "text-muted-foreground hover:bg-[--surface] hover:text-[--text-primary]"
        }`}
        title={current ? `已关联场景：${current.name}` : "点击关联场景（生成首帧时自动注入场景参考图）"}
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <MapPin className="h-3 w-3 flex-shrink-0" />
        )}
        {current ? (
          <>
            {current.imagePath && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadUrl(current.imagePath)}
                alt={current.name}
                className="h-4 w-6 rounded object-cover flex-shrink-0"
              />
            )}
            <span className="max-w-[100px] truncate font-medium">{current.name}</span>
          </>
        ) : (
          <span>关联场景</span>
        )}
      </button>

      {/* 下拉面板 */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-1.5 w-56 overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-xl">
            {/* 取消关联 */}
            <button
              onClick={() => select(null)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <X className="h-4 w-4 flex-shrink-0" />
              <span>不关联场景</span>
            </button>

            <div className="border-t border-[--border-subtle]" />

            {/* 场景列表 */}
            <div className="max-h-64 overflow-y-auto py-1">
              {scenes.map((scene) => {
                const isSelected = scene.id === currentSceneId;
                return (
                  <button
                    key={scene.id}
                    onClick={() => select(scene.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm transition-colors text-left ${
                      isSelected
                        ? "bg-primary/8 text-primary"
                        : "hover:bg-[--surface] text-[--text-primary]"
                    }`}
                  >
                    {/* 缩略图 */}
                    <div className="h-10 w-14 flex-shrink-0 overflow-hidden rounded-md bg-[--surface]">
                      {scene.imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={uploadUrl(scene.imagePath)}
                          alt={scene.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <MapPin className="h-4 w-4 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    <span className="flex-1 truncate text-xs font-medium leading-tight">
                      {scene.name}
                    </span>
                    {isSelected && (
                      <Check className="h-4 w-4 flex-shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
