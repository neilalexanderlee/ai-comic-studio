# Storyboard Workflow UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three additive UX features to the Storyboard page: a shot edit drawer (A), a characters inline panel (B), and a pipeline kanban view (C).

**Architecture:** All features are purely frontend — no new API routes or DB changes. Feature A adds a slide-over drawer component and a compact row mode to ShotCard. Feature B adds a collapsible inline character panel above the batch controls. Feature C adds a kanban board view with per-column batch actions; clicking a kanban shot opens the Feature A drawer. All state lives in component state or localStorage.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, next-intl (ICU i18n), Zustand (project store), lucide-react icons, existing `apiFetch` wrapper, `InlineModelPicker` component.

**Dev command:** `pnpm dev` (runs on localhost:3000 by default)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `messages/en.json` | Modify | Add 9 new i18n keys |
| `messages/zh.json` | Modify | Add 9 new i18n keys (Chinese) |
| `messages/ja.json` | Modify | Add 9 new i18n keys (Japanese) |
| `messages/ko.json` | Modify | Add 9 new i18n keys (Korean) |
| `src/components/editor/shot-card.tsx` | Modify | Add `isCompact` prop + `onOpenDrawer` prop |
| `src/components/editor/shot-drawer.tsx` | Create | Full shot edit drawer component |
| `src/components/editor/characters-inline-panel.tsx` | Create | Inline character panel |
| `src/components/editor/shot-kanban.tsx` | Create | Kanban board view |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Modify | Wire drawer, inline panel, view toggle |

---

## Task 1: Add i18n Keys

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh.json`
- Modify: `messages/ja.json`
- Modify: `messages/ko.json`

- [ ] **Step 1: Add keys to `messages/en.json`**

Inside the `"project"` object, add after `"downloadVideo"`:

```json
"charactersPanel": "Characters",
"charactersPanelEdit": "Edit in Characters page",
"viewList": "List",
"viewKanban": "Kanban",
"kanbanNeedsFrames": "Needs Frames",
"kanbanNeedsPrompt": "Needs Prompt",
"kanbanNeedsVideo": "Needs Video",
"kanbanDone": "Done",
"kanbanBatchGenerate": "Generate ({count})"
```

- [ ] **Step 2: Add keys to `messages/zh.json`**

Same location in `"project"` object:

```json
"charactersPanel": "角色",
"charactersPanelEdit": "前往角色页面编辑",
"viewList": "列表",
"viewKanban": "看板",
"kanbanNeedsFrames": "待生成帧",
"kanbanNeedsPrompt": "待生成提示词",
"kanbanNeedsVideo": "待生成视频",
"kanbanDone": "已完成",
"kanbanBatchGenerate": "批量生成 ({count})"
```

- [ ] **Step 3: Add keys to `messages/ja.json`**

Same location:

```json
"charactersPanel": "キャラクター",
"charactersPanelEdit": "キャラクターページで編集",
"viewList": "リスト",
"viewKanban": "カンバン",
"kanbanNeedsFrames": "フレーム生成待ち",
"kanbanNeedsPrompt": "プロンプト生成待ち",
"kanbanNeedsVideo": "動画生成待ち",
"kanbanDone": "完了",
"kanbanBatchGenerate": "一括生成 ({count})"
```

- [ ] **Step 4: Add keys to `messages/ko.json`**

Same location:

```json
"charactersPanel": "캐릭터",
"charactersPanelEdit": "캐릭터 페이지에서 편집",
"viewList": "목록",
"viewKanban": "칸반",
"kanbanNeedsFrames": "프레임 생성 필요",
"kanbanNeedsPrompt": "프롬프트 생성 필요",
"kanbanNeedsVideo": "동영상 생성 필요",
"kanbanDone": "완료",
"kanbanBatchGenerate": "일괄 생성 ({count})"
```

- [ ] **Step 5: Commit**

```bash
git add messages/
git commit -m "feat: add i18n keys for storyboard UX features"
```

---

## Task 2: ShotCard Compact Mode

**Files:**
- Modify: `src/components/editor/shot-card.tsx`

The compact mode renders a single-line row (thumbnail strip + scene text + status dots) instead of the full accordion card. When `isCompact` is true, the component renders only the header row, with a click handler that calls `onOpenDrawer(id)`.

- [ ] **Step 1: Add props to `ShotCardProps` interface**

In `shot-card.tsx`, find the `ShotCardProps` interface and add two new optional props:

```typescript
isCompact?: boolean;
onOpenDrawer?: (id: string) => void;
```

- [ ] **Step 2: Add compact render branch to `ShotCard`**

In `ShotCard`, destructure the new props:
```typescript
isCompact = false,
onOpenDrawer,
```

At the very top of the `return` statement (before the existing `<div className="overflow-hidden rounded-2xl...`), add:

```tsx
if (isCompact) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-[--border-subtle] bg-white px-3 py-2 cursor-pointer hover:border-primary/30 hover:bg-primary/2 transition-colors"
      onClick={() => onOpenDrawer?.(id)}
    >
      {/* Sequence */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/8 font-mono text-xs font-bold text-primary">
        {sequence}
      </div>
      {/* Thumbnails */}
      <div className="flex gap-1">
        {(generationMode === "reference"
          ? [sceneRefFrame, videoUrl]
          : [firstFrame, lastFrame, videoUrl]
        ).map((src, i) => {
          const isVid = i === (generationMode === "reference" ? 1 : 2);
          return (
            <div key={i} className="h-8 w-11 flex-shrink-0 overflow-hidden rounded-md border border-[--border-subtle] bg-[--surface]">
              {src ? (
                isVid
                  ? <video className="h-full w-full object-cover" src={uploadUrl(src)} />
                  : <img src={uploadUrl(src)} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {isVid
                    ? <VideoIcon className="h-3 w-3 text-[--text-muted]" />
                    : <ImageIcon className="h-3 w-3 text-[--text-muted]" />
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Scene text */}
      <p className="flex-1 truncate text-xs text-[--text-secondary]">{prompt}</p>
      {/* Progress dots */}
      <div className="flex items-center gap-1">
        {[hasText, hasFrame, hasVideoPrompt, hasVideo].map((done, i) => (
          <div key={i} className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-[--border-subtle]"}`} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and verify**

```bash
pnpm dev
```

Navigate to a project's storyboard page. The compact mode is not yet wired up, but the code should compile without errors. Check browser console for TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/shot-card.tsx
git commit -m "feat: add isCompact mode and onOpenDrawer prop to ShotCard"
```

---

## Task 3: Shot Edit Drawer Component

**Files:**
- Create: `src/components/editor/shot-drawer.tsx`

This is a slide-over panel fixed to the right side of the viewport. It receives a `shotId` and renders all 4 pipeline steps fully expanded. Generate actions inside the drawer use local state and do not touch the page-level `anyGenerating`. The drawer receives `selectedVersionId` from the page and forwards it to all generate API calls.

- [ ] **Step 1: Create `shot-drawer.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ImageIcon,
  VideoIcon,
  Sparkles,
  RefreshCw,
  MessageCircle,
  Clock,
} from "lucide-react";

interface Dialogue {
  id: string;
  text: string;
  characterName: string;
}

interface DrawerShot {
  id: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  sceneRefFrame?: string | null;
  videoPrompt?: string | null;
  videoUrl: string | null;
  dialogues: Dialogue[];
}

interface ShotDrawerProps {
  shots: DrawerShot[];
  openShotId: string | null;
  onClose: () => void;
  onShotChange: (id: string) => void;
  onUpdate: () => void;
  projectId: string;
  generationMode: "keyframe" | "reference";
  videoRatio: string;
  selectedVersionId: string | null;
  anyGenerating: boolean;
}

export function ShotDrawer({
  shots,
  openShotId,
  onClose,
  onShotChange,
  onUpdate,
  projectId,
  generationMode,
  videoRatio,
  selectedVersionId,
  anyGenerating,
}: ShotDrawerProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  const currentIndex = shots.findIndex((s) => s.id === openShotId);
  const shot = currentIndex >= 0 ? shots[currentIndex] : null;

  // Local edit state
  const [editPrompt, setEditPrompt] = useState("");
  const [editStartFrame, setEditStartFrame] = useState("");
  const [editEndFrame, setEditEndFrame] = useState("");
  const [editMotionScript, setEditMotionScript] = useState("");
  const [editVideoPrompt, setEditVideoPrompt] = useState("");
  const [editCameraDirection, setEditCameraDirection] = useState("static");
  const [editDuration, setEditDuration] = useState(5);

  // Local generating state (independent of page-level anyGenerating)
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingSceneFrame, setGeneratingSceneFrame] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [rewritingText, setRewritingText] = useState(false);

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // Sync local state when shot changes
  useEffect(() => {
    if (!shot) return;
    setEditPrompt(shot.prompt ?? "");
    setEditStartFrame(shot.startFrameDesc ?? "");
    setEditEndFrame(shot.endFrameDesc ?? "");
    setEditMotionScript(shot.motionScript ?? "");
    setEditVideoPrompt(shot.videoPrompt ?? "");
    setEditCameraDirection(shot.cameraDirection ?? "static");
    setEditDuration(shot.duration ?? 5);
    setGeneratingFrames(false);
    setGeneratingSceneFrame(false);
    setGeneratingVideo(false);
    setGeneratingPrompt(false);
    setRewritingText(false);
  }, [shot?.id]);

  // Escape key to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!shot) return null;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < shots.length - 1;

  const hasFrame = !!(shot.sceneRefFrame || shot.firstFrame || shot.lastFrame);
  const hasFramePair = !!(shot.firstFrame && shot.lastFrame);
  const hasVideoPrompt = !!shot.videoPrompt;
  const hasVideo = !!shot.videoUrl;
  const localGenerating = generatingFrames || generatingSceneFrame || generatingVideo || generatingPrompt || rewritingText;

  async function patchShot(fields: Record<string, unknown>) {
    await apiFetch(`/api/projects/${projectId}/shots/${shot!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function handleGenerateFrames() {
    if (!imageGuard()) return;
    setGeneratingFrames(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_frame_generate",
          payload: { shotId: shot!.id, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingFrames(false);
  }

  async function handleGenerateSceneFrame() {
    if (!imageGuard()) return;
    setGeneratingSceneFrame(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_scene_frame",
          payload: { shotId: shot!.id, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingSceneFrame(false);
  }

  async function handleGenerateVideoPrompt() {
    setGeneratingPrompt(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_prompt",
          payload: { shotId: shot!.id, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingPrompt(false);
  }

  async function handleGenerateVideo() {
    if (!videoGuard()) return;
    setGeneratingVideo(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: generationMode === "reference" ? "single_reference_video" : "single_video_generate",
          payload: { shotId: shot!.id, ratio: videoRatio, versionId: selectedVersionId },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingVideo(false);
  }

  async function handleRewriteText() {
    setRewritingText(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_shot_rewrite",
          payload: { shotId: shot!.id },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setRewritingText(false);
  }

  const frameAssets = generationMode === "reference"
    ? [{ src: shot.sceneRefFrame, label: t("shot.sceneRefFrame") }]
    : [
        { src: shot.firstFrame, label: t("shot.firstFrame") },
        { src: shot.lastFrame, label: t("shot.lastFrame") },
      ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[420px] max-w-[90vw] flex-col border-l border-[--border-subtle] bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-[--border-subtle] px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 font-mono text-sm font-bold text-primary">
            {shot.sequence}
          </div>
          <p className="flex-1 truncate text-sm font-medium text-[--text-primary]">{shot.prompt}</p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => hasPrev && onShotChange(shots[currentIndex - 1].id)}
              disabled={!hasPrev}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => hasNext && onShotChange(shots[currentIndex + 1].id)}
              disabled={!hasNext}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {/* Step 1: Text */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.stepText")}</p>
            <div className="space-y-2">
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onBlur={() => patchShot({ prompt: editPrompt })}
                rows={2}
                placeholder={t("shot.prompt")}
              />
              {generationMode !== "reference" && (
                <>
                  <Textarea
                    value={editStartFrame}
                    onChange={(e) => setEditStartFrame(e.target.value)}
                    onBlur={() => patchShot({ startFrameDesc: editStartFrame })}
                    rows={2}
                    placeholder={t("shot.startFrame")}
                    className="border-blue-200 bg-blue-50/30 text-sm"
                  />
                  <Textarea
                    value={editEndFrame}
                    onChange={(e) => setEditEndFrame(e.target.value)}
                    onBlur={() => patchShot({ endFrameDesc: editEndFrame })}
                    rows={2}
                    placeholder={t("shot.endFrame")}
                    className="border-amber-200 bg-amber-50/30 text-sm"
                  />
                </>
              )}
              <Textarea
                value={editMotionScript}
                onChange={(e) => setEditMotionScript(e.target.value)}
                onBlur={() => patchShot({ motionScript: editMotionScript })}
                rows={2}
                placeholder={t("shot.motionScript")}
                className="border-emerald-200 bg-emerald-50/30 text-sm"
              />
              <input
                value={editCameraDirection}
                onChange={(e) => setEditCameraDirection(e.target.value)}
                onBlur={() => patchShot({ cameraDirection: editCameraDirection })}
                className="w-full rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-sm outline-none focus:border-primary/50"
                placeholder="static / pan-left / zoom-in ..."
              />
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-[--text-muted]">
                  <Clock className="h-3 w-3" />
                  <input
                    type="number"
                    min={5}
                    max={15}
                    value={editDuration}
                    onChange={(e) => {
                      const v = Math.min(15, Math.max(5, Number(e.target.value)));
                      setEditDuration(v);
                      patchShot({ duration: v });
                    }}
                    className="w-9 rounded border border-[--border-subtle] bg-white px-1 py-0.5 text-center text-[11px] font-medium outline-none focus:border-primary/50"
                  />
                  <span className="text-[11px]">s</span>
                </span>
              </div>
              {shot.dialogues.length > 0 && (
                <div className="space-y-1 rounded-xl bg-[--surface] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.dialogue")}</p>
                  {shot.dialogues.map((d) => (
                    <p key={d.id} className="text-sm">
                      <span className="font-semibold text-primary">{d.characterName}</span>
                      <span className="mx-1.5 text-[--text-muted]">&mdash;</span>
                      <span className="text-[--text-secondary]">{d.text}</span>
                    </p>
                  ))}
                </div>
              )}
              <Button size="xs" variant="outline" onClick={handleRewriteText} disabled={rewritingText || anyGenerating}>
                {rewritingText ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {rewritingText ? t("common.generating") : t("shot.rewriteText")}
              </Button>
            </div>
          </section>

          {/* Step 2: Frames */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">
              {generationMode === "reference" ? t("shot.stepSceneFrame") : t("shot.stepFrames")}
            </p>
            {hasFrame && (
              <div className="mb-2 flex gap-2">
                {frameAssets.map((asset, i) => (
                  <div
                    key={i}
                    className={`overflow-hidden rounded-lg border border-[--border-subtle] cursor-pointer hover:opacity-80 transition-opacity ${generationMode === "reference" ? "w-full" : "flex-1"}`}
                    style={{ height: 64 }}
                    onClick={() => asset.src && setPreviewSrc(uploadUrl(asset.src))}
                  >
                    {asset.src
                      ? <img src={uploadUrl(asset.src)} className="h-full w-full object-cover" />
                      : <div className="flex h-full w-full items-center justify-center bg-[--surface]"><ImageIcon className="h-4 w-4 text-[--text-muted]" /></div>
                    }
                  </div>
                ))}
              </div>
            )}
            <Button
              size="xs"
              variant={!hasFrame ? "default" : "outline"}
              onClick={generationMode === "reference" ? handleGenerateSceneFrame : handleGenerateFrames}
              disabled={generatingFrames || generatingSceneFrame || anyGenerating}
            >
              {(generatingFrames || generatingSceneFrame) ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
              {(generatingFrames || generatingSceneFrame)
                ? t("common.generating")
                : hasFrame ? t("shot.regenerateFrames") : t("project.generateFrames")
              }
            </Button>
          </section>

          {/* Step 3: Video Prompt */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.stepVideoPrompt")}</p>
            {hasVideoPrompt && (
              <Textarea
                value={editVideoPrompt}
                onChange={(e) => setEditVideoPrompt(e.target.value)}
                onBlur={() => patchShot({ videoPrompt: editVideoPrompt })}
                className="mb-2 min-h-[5rem] resize-none font-mono text-xs leading-relaxed"
              />
            )}
            <Button
              size="xs"
              variant={hasFrame && !hasVideoPrompt ? "default" : "outline"}
              onClick={handleGenerateVideoPrompt}
              disabled={generatingPrompt || !hasFrame || anyGenerating}
            >
              {generatingPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {generatingPrompt
                ? t("common.generating")
                : hasVideoPrompt ? t("shot.regeneratePrompt") : t("shot.generateVideoPrompt")
              }
            </Button>
          </section>

          {/* Step 4: Video */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.stepVideo")}</p>
            {hasVideo && (
              <div
                className="mb-2 overflow-hidden rounded-lg border border-[--border-subtle] cursor-pointer"
                onClick={() => setPreviewSrc(uploadUrl(shot.videoUrl!))}
              >
                <video className="w-full max-h-32 object-cover" src={uploadUrl(shot.videoUrl!)} />
              </div>
            )}
            <Button
              size="xs"
              variant={hasVideoPrompt && !hasVideo ? "default" : "outline"}
              onClick={handleGenerateVideo}
              disabled={generatingVideo || (generationMode === "keyframe" && !hasFramePair) || anyGenerating}
            >
              {generatingVideo ? <Loader2 className="h-3 w-3 animate-spin" /> : <VideoIcon className="h-3 w-3" />}
              {generatingVideo
                ? t("common.generating")
                : hasVideo ? t("shot.regenerateVideo") : t("project.generateVideo")
              }
            </Button>
          </section>

        </div>
      </div>

      {/* Preview lightbox */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {previewSrc.match(/\.(mp4|webm|mov)/) ? (
              <video src={previewSrc} controls autoPlay className="max-h-[85vh] rounded-xl" />
            ) : (
              <img src={previewSrc} alt="Preview" className="max-h-[85vh] rounded-xl" />
            )}
            <button
              onClick={() => setPreviewSrc(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-sm font-bold shadow-lg hover:scale-110 transition-transform"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Check the dev server (or run `pnpm build 2>&1 | head -30`) for TypeScript errors on the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/shot-drawer.tsx
git commit -m "feat: add ShotDrawer component"
```

---

## Task 4: Wire Drawer into StoryboardPage

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

- [ ] **Step 1: Import ShotDrawer**

Add to the imports at the top of `storyboard/page.tsx`:

```typescript
import { ShotDrawer } from "@/components/editor/shot-drawer";
```

- [ ] **Step 2: Add drawer state**

Inside `StoryboardPage`, after the existing `useState` declarations, add:

```typescript
const [openDrawerShotId, setOpenDrawerShotId] = useState<string | null>(null);
```

- [ ] **Step 3: Build the drawerShots array**

After the existing derived values block, add:

```typescript
const drawerShots = project.shots.map((shot) => ({
  id: shot.id,
  sequence: shot.sequence,
  prompt: shot.prompt,
  startFrameDesc: shot.startFrameDesc,
  endFrameDesc: shot.endFrameDesc,
  videoScript: shot.videoScript,
  motionScript: shot.motionScript,
  cameraDirection: shot.cameraDirection,
  duration: shot.duration,
  firstFrame: shot.firstFrame,
  lastFrame: shot.lastFrame,
  sceneRefFrame: shot.sceneRefFrame,
  videoPrompt: shot.videoPrompt,
  videoUrl: generationMode === "reference" ? shot.referenceVideoUrl : shot.videoUrl,
  dialogues: shot.dialogues || [],
}));
```

- [ ] **Step 4: Update ShotCard render to pass compact mode + open drawer callback**

Find the `{project.shots.map((shot) => (` block and update each `<ShotCard` to add:

```tsx
isCompact={openDrawerShotId !== null}
onOpenDrawer={(id) => setOpenDrawerShotId(id)}
```

Also wrap the shot card's header in a way that clicking the header opens the drawer. Since `ShotCard` already handles this via the `isCompact` + `onOpenDrawer` props added in Task 2, and in non-compact mode we want clicking the header row to open the drawer, add `onOpenDrawer` to non-compact mode too. The compact check in ShotCard handles this — when `isCompact=false`, `onOpenDrawer` is still passed but won't auto-fire; clicking the compact row would call it. For non-compact mode, we need to add a subtle "click to expand" mechanism.

Actually, the simplest approach: when `openDrawerShotId` is null, all cards are in normal mode. When a drawer IS open, all cards switch to compact mode. Users open the drawer by clicking the sequence badge on a non-compact card. Add an `onClick` to the sequence badge in `ShotCard` (non-compact mode) that calls `onOpenDrawer(id)`:

In `shot-card.tsx`, find the sequence badge `<div className="flex h-9 w-9...` in the Header section and wrap it with an onClick:

```tsx
<div
  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/8 font-mono text-sm font-bold text-primary cursor-pointer hover:bg-primary/15 transition-colors"
  onClick={() => onOpenDrawer?.(id)}
  title="Open editor"
>
  {sequence}
</div>
```

- [ ] **Step 5: Render ShotDrawer at the bottom of StoryboardPage return**

At the end of the `return` JSX, just before the closing `</div>`:

```tsx
{openDrawerShotId && (
  <ShotDrawer
    shots={drawerShots}
    openShotId={openDrawerShotId}
    onClose={() => setOpenDrawerShotId(null)}
    onShotChange={(id) => setOpenDrawerShotId(id)}
    onUpdate={() => fetchProject(project.id)}
    projectId={project.id}
    generationMode={generationMode}
    videoRatio={videoRatio}
    selectedVersionId={selectedVersionId}
    anyGenerating={anyGenerating}
  />
)}
```

- [ ] **Step 6: Verify in browser**

1. Start dev server (`pnpm dev`)
2. Open a project with shots on the storyboard page
3. Click the sequence badge on a shot card — drawer should slide in from the right
4. All 4 steps should be visible and scrollable in the drawer
5. Click prev/next arrows to navigate between shots
6. Press Escape or click × to close
7. While drawer is open, all cards should switch to compact row mode
8. Click a compact row to switch the drawer to that shot

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/project/[id]/storyboard/page.tsx src/components/editor/shot-card.tsx
git commit -m "feat: wire ShotDrawer into StoryboardPage (Feature A)"
```

---

## Task 5: Characters Inline Panel Component

**Files:**
- Create: `src/components/editor/characters-inline-panel.tsx`

The panel shows compact character thumbnails with generate buttons. It uses the same `single_character_image` generate action as `CharacterCard`. The `InlineModelPicker` controls which image model is used, same pattern as CharacterCard (local `imageModelRef` state with `resolveImageRef`).

- [ ] **Step 1: Create `characters-inline-panel.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Sparkles, Loader2, Users } from "lucide-react";
import Link from "next/link";

interface Character {
  id: string;
  name: string;
  referenceImage: string | null;
}

interface CharactersInlinePanelProps {
  characters: Character[];
  projectId: string;
  generationMode: "keyframe" | "reference";
  onUpdate: () => void;
}

export function CharactersInlinePanel({
  characters,
  projectId,
  generationMode,
  onUpdate,
}: CharactersInlinePanelProps) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const providers = useModelStore((s) => s.providers);
  const defaultImageModel = useModelStore((s) => s.defaultImageModel);
  const imageGuard = useModelGuard("image");

  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(() => defaultImageModel);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const storageKey = `charPanel:${projectId}`;
  const anyMissingRef = characters.some((c) => !c.referenceImage);

  const [open, setOpen] = useState(() => {
    // Will be updated on mount via useEffect
    return false;
  });

  useEffect(() => {
    // Auto-expand rule: condition takes precedence over localStorage at mount time
    if (generationMode === "reference" && anyMissingRef) {
      setOpen(true);
      return;
    }
    const stored = localStorage.getItem(storageKey);
    setOpen(stored === "true");
  }, []); // only on mount

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }

  function resolveImageRef(ref: ModelRef | null) {
    if (!ref) return null;
    const provider = providers.find((p) => p.id === ref.providerId);
    if (!provider) return null;
    return {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      secretKey: provider.secretKey,
      modelId: ref.modelId,
    };
  }

  async function handleGenerate(characterId: string) {
    if (!imageGuard()) return;
    setGeneratingId(characterId);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_character_image",
          payload: { characterId },
          modelConfig: { ...getModelConfig(), image: resolveImageRef(imageModelRef) },
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("generationFailed"));
    }
    setGeneratingId(null);
  }

  if (characters.length === 0) return null;

  const needsAttention = generationMode === "reference" && anyMissingRef;

  return (
    <div className={`rounded-xl border transition-colors ${
      needsAttention && open
        ? "border-amber-300 bg-amber-50/60"
        : "border-[--border-subtle] bg-[--surface]/50"
    }`}>
      {/* Header toggle */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={toggle}
      >
        <Users className="h-3.5 w-3.5 text-[--text-muted]" />
        <span className="flex-1 text-[13px] font-medium text-[--text-secondary]">
          {t("charactersPanel")}
        </span>
        {needsAttention && (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {characters.filter((c) => !c.referenceImage).length}
          </span>
        )}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-[--text-muted]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-[--text-muted]" />
        )}
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-[--border-subtle] px-3 pb-3 pt-2.5">
          {/* Model picker */}
          <div className="mb-3">
            <InlineModelPicker capability="image" value={imageModelRef} onChange={setImageModelRef} />
          </div>

          {/* Character grid */}
          <div className="flex flex-wrap gap-2">
            {characters.map((char) => {
              const isGenerating = generatingId === char.id;
              return (
                <div key={char.id} className="flex flex-col items-center gap-1">
                  {/* Thumbnail */}
                  <div className="relative h-12 w-12 overflow-hidden rounded-lg border border-[--border-subtle] bg-[--surface]">
                    {char.referenceImage ? (
                      <img
                        src={uploadUrl(char.referenceImage)}
                        alt={char.name}
                        className="h-full w-full object-cover"
                      />
                    ) : isGenerating ? (
                      <div className="flex h-full w-full items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-bold text-primary">
                        {char.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {/* Status badge */}
                    <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                      char.referenceImage ? "bg-emerald-500" : "bg-amber-500"
                    }`} />
                  </div>
                  {/* Name */}
                  <span className="max-w-[52px] truncate text-[10px] text-[--text-muted]">{char.name}</span>
                  {/* Generate button (only when no image) */}
                  {!char.referenceImage && (
                    <button
                      onClick={() => handleGenerate(char.id)}
                      disabled={isGenerating || !!generatingId}
                      className="flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                    >
                      {isGenerating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                      Gen
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer link */}
          <div className="mt-3 flex justify-end">
            <Link
              href={`/${locale}/project/${projectId}/characters`}
              className="text-[11px] text-[--text-muted] underline underline-offset-2 hover:text-[--text-secondary] transition-colors"
            >
              {t("charactersPanelEdit")} →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit the new file**

```bash
git add src/components/editor/characters-inline-panel.tsx
git commit -m "feat: add CharactersInlinePanel component"
```

---

## Task 6: Wire Inline Panel into StoryboardPage

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

- [ ] **Step 1: Import CharactersInlinePanel**

Add to imports:

```typescript
import { CharactersInlinePanel } from "@/components/editor/characters-inline-panel";
```

- [ ] **Step 2: Add panel to the control block**

In the JSX, inside the `{/* ── Control Panel ── */}` div, just before `{/* Batch operations */}`, add:

```tsx
{/* Characters inline panel (Feature B) */}
<CharactersInlinePanel
  characters={project.characters}
  projectId={project.id}
  generationMode={generationMode}
  onUpdate={() => fetchProject(project.id)}
/>
```

Also remove the existing `{/* Reference image mode: character indicator */}` banner block (the amber/violet banner), since the inline panel supersedes it.

- [ ] **Step 3: Verify in browser**

1. Navigate to a project's storyboard page
2. A "Characters" row should appear in the control panel above the batch operations
3. Click to expand — should show character thumbnails with status badges
4. In reference mode with missing images: panel should auto-expand and show amber styling
5. Collapsing and refreshing the page should persist the collapsed state (via localStorage)
6. "Edit in Characters page →" link should navigate to the characters page

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/project/[id]/storyboard/page.tsx
git commit -m "feat: wire CharactersInlinePanel into StoryboardPage (Feature B)"
```

---

## Task 7: Shot Kanban Component

**Files:**
- Create: `src/components/editor/shot-kanban.tsx`

The kanban receives shots, `generationMode`, and all batch handlers from the page. Columns are computed client-side from shot data. Each column's batch button calls the appropriate handler conditioned on `generationMode`.

- [ ] **Step 1: Create `shot-kanban.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Loader2, ImageIcon, VideoIcon, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadUrl } from "@/lib/utils/upload-url";

interface KanbanShot {
  id: string;
  sequence: number;
  prompt: string;
  firstFrame: string | null;
  lastFrame: string | null;
  sceneRefFrame: string | null;
  videoPrompt: string | null;
  videoUrl: string | null;
}

interface ShotKanbanProps {
  shots: KanbanShot[];
  generationMode: "keyframe" | "reference";
  anyGenerating: boolean;
  onOpenDrawer: (id: string) => void;
  onBatchFrames: () => void;
  onBatchSceneFrames: () => void;
  onBatchVideoPrompts: () => void;
  onBatchVideos: () => void;
  onBatchReferenceVideos: () => void;
  generatingFrames: boolean;
  generatingSceneFrames: boolean;
  generatingVideoPrompts: boolean;
  generatingVideos: boolean;
}

interface KanbanColumn {
  key: string;
  labelKey: string;
  color: string;
  headerBg: string;
  shots: KanbanShot[];
  batchAction?: () => void;
  isGenerating?: boolean;
  icon: React.ReactNode;
}

export function ShotKanban({
  shots,
  generationMode,
  anyGenerating,
  onOpenDrawer,
  onBatchFrames,
  onBatchSceneFrames,
  onBatchVideoPrompts,
  onBatchVideos,
  onBatchReferenceVideos,
  generatingFrames,
  generatingSceneFrames,
  generatingVideoPrompts,
  generatingVideos,
}: ShotKanbanProps) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");

  function classifyShot(shot: KanbanShot) {
    const hasFrame = !!(shot.sceneRefFrame || shot.firstFrame || shot.lastFrame);
    const hasVideoPrompt = !!shot.videoPrompt;
    const hasVideo = !!shot.videoUrl;
    if (!hasFrame) return "frames";
    if (!hasVideoPrompt) return "prompt";
    if (!hasVideo) return "video";
    return "done";
  }

  const frameShots = shots.filter((s) => classifyShot(s) === "frames");
  const promptShots = shots.filter((s) => classifyShot(s) === "prompt");
  const videoShots = shots.filter((s) => classifyShot(s) === "video");
  const doneShots = shots.filter((s) => classifyShot(s) === "done");

  const framesGenerating = generationMode === "reference" ? generatingSceneFrames : generatingFrames;
  const framesAction = generationMode === "reference" ? onBatchSceneFrames : onBatchFrames;
  const videosAction = generationMode === "reference" ? onBatchReferenceVideos : onBatchVideos;

  const columns: KanbanColumn[] = [
    {
      key: "frames",
      labelKey: "kanbanNeedsFrames",
      color: "text-amber-700",
      headerBg: "bg-amber-50 border-amber-200",
      shots: frameShots,
      batchAction: framesAction,
      isGenerating: framesGenerating,
      icon: <ImageIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "prompt",
      labelKey: "kanbanNeedsPrompt",
      color: "text-violet-700",
      headerBg: "bg-violet-50 border-violet-200",
      shots: promptShots,
      batchAction: onBatchVideoPrompts,
      isGenerating: generatingVideoPrompts,
      icon: <Sparkles className="h-3.5 w-3.5" />,
    },
    {
      key: "video",
      labelKey: "kanbanNeedsVideo",
      color: "text-pink-700",
      headerBg: "bg-pink-50 border-pink-200",
      shots: videoShots,
      batchAction: videosAction,
      isGenerating: generatingVideos,
      icon: <VideoIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "done",
      labelKey: "kanbanDone",
      color: "text-emerald-700",
      headerBg: "bg-emerald-50 border-emerald-200",
      shots: doneShots,
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {columns.map((col) => (
        <div key={col.key} className="flex flex-col rounded-2xl border border-[--border-subtle] bg-white overflow-hidden">
          {/* Column header */}
          <div className={`flex items-center gap-2 border-b px-3 py-2 ${col.headerBg}`}>
            <span className={col.color}>{col.icon}</span>
            <span className={`flex-1 text-[12px] font-semibold ${col.color}`}>
              {t(col.labelKey as Parameters<typeof t>[0])}
            </span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${col.headerBg} ${col.color} border`}>
              {col.shots.length}
            </span>
          </div>

          {/* Batch button */}
          {col.batchAction && col.shots.length > 0 && (
            <div className="border-b border-[--border-subtle] px-2 py-2">
              <Button
                size="xs"
                variant="outline"
                className="w-full"
                onClick={col.batchAction}
                disabled={anyGenerating}
              >
                {col.isGenerating
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : col.icon
                }
                {col.isGenerating
                  ? tCommon("generating")
                  : t("kanbanBatchGenerate", { count: col.shots.length } as never)
                }
              </Button>
            </div>
          )}

          {/* Shot mini-cards */}
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
            {col.shots.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-[11px] text-[--text-muted]">
                —
              </div>
            ) : (
              col.shots.map((shot) => {
                const thumb = shot.firstFrame || shot.sceneRefFrame || shot.lastFrame;
                return (
                  <div
                    key={shot.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-[--border-subtle] bg-white px-2 py-1.5 transition-colors hover:border-primary/30 hover:bg-primary/2"
                    onClick={() => onOpenDrawer(shot.id)}
                  >
                    {/* Thumbnail */}
                    <div className="h-8 w-11 flex-shrink-0 overflow-hidden rounded-md border border-[--border-subtle] bg-[--surface]">
                      {thumb ? (
                        <img src={uploadUrl(thumb)} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-3 w-3 text-[--text-muted]" />
                        </div>
                      )}
                    </div>
                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-mono font-bold text-primary">#{shot.sequence}</div>
                      <div className="truncate text-[11px] text-[--text-secondary]">{shot.prompt}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit the new file**

```bash
git add src/components/editor/shot-kanban.tsx
git commit -m "feat: add ShotKanban component"
```

---

## Task 8: Wire Kanban View into StoryboardPage

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

- [ ] **Step 1: Import ShotKanban and LayoutGrid icon**

Add to imports:

```typescript
import { ShotKanban } from "@/components/editor/shot-kanban";
import { LayoutGrid, List } from "lucide-react";
```

- [ ] **Step 2: Add view mode state**

Inside `StoryboardPage`, add:

```typescript
const [viewMode, setViewMode] = useState<"list" | "kanban">(() => {
  if (typeof window !== "undefined") {
    return (localStorage.getItem(`storyboardView:${project?.id}`) as "list" | "kanban") || "list";
  }
  return "list";
});
```

Add a helper to toggle and persist:

```typescript
function switchView(mode: "list" | "kanban") {
  setViewMode(mode);
  localStorage.setItem(`storyboardView:${project.id}`, mode);
}
```

- [ ] **Step 3: Add view toggle to the page header**

Find the page header `<div className="flex items-center justify-between">` block. Inside the right-side `<div className="flex items-center gap-2">`, add the toggle before the existing preview/download buttons:

```tsx
{totalShots > 0 && (
  <div className="inline-flex gap-0.5 rounded-lg border border-[--border-subtle] bg-[--surface] p-0.5">
    <button
      onClick={() => switchView("list")}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
        viewMode === "list"
          ? "bg-white text-[--text-primary] shadow-xs"
          : "text-[--text-muted] hover:text-[--text-secondary]"
      }`}
    >
      <List className="h-3.5 w-3.5" />
      {t("project.viewList")}
    </button>
    <button
      onClick={() => switchView("kanban")}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
        viewMode === "kanban"
          ? "bg-white text-[--text-primary] shadow-xs"
          : "text-[--text-muted] hover:text-[--text-secondary]"
      }`}
    >
      <LayoutGrid className="h-3.5 w-3.5" />
      {t("project.viewKanban")}
    </button>
  </div>
)}
```

- [ ] **Step 4: Conditionally render kanban or list**

Find the shot list section:

```tsx
{totalShots === 0 ? (
  ...empty state...
) : (
  <div className="space-y-3">
    {project.shots.map(...)}
  </div>
)}
```

Replace the non-empty branch with:

```tsx
{totalShots === 0 ? (
  // ... existing empty state unchanged ...
) : viewMode === "kanban" ? (
  <ShotKanban
    shots={project.shots.map((shot) => ({
      id: shot.id,
      sequence: shot.sequence,
      prompt: shot.prompt,
      firstFrame: shot.firstFrame,
      lastFrame: shot.lastFrame,
      sceneRefFrame: shot.sceneRefFrame,
      videoPrompt: shot.videoPrompt,
      videoUrl: generationMode === "reference" ? shot.referenceVideoUrl : shot.videoUrl,
    }))}
    generationMode={generationMode}
    anyGenerating={anyGenerating}
    onOpenDrawer={(id) => setOpenDrawerShotId(id)}
    onBatchFrames={() => handleBatchGenerateFrames(false)}
    onBatchSceneFrames={() => handleBatchGenerateSceneFrames(false)}
    onBatchVideoPrompts={handleBatchGenerateVideoPrompts}
    onBatchVideos={() => handleBatchGenerateVideos(false)}
    onBatchReferenceVideos={() => handleBatchGenerateReferenceVideos(false)}
    generatingFrames={generatingFrames}
    generatingSceneFrames={generatingSceneFrames}
    generatingVideoPrompts={generatingVideoPrompts}
    generatingVideos={generatingVideos}
  />
) : (
  <div className="space-y-3">
    {project.shots.map((shot) => (
      <ShotCard
        key={shot.id}
        // ... all existing props unchanged ...
        isCompact={openDrawerShotId !== null}
        onOpenDrawer={(id) => setOpenDrawerShotId(id)}
      />
    ))}
  </div>
)}
```

Also hide the batch control panel (rows 1–4) when in kanban mode. Find `{/* Batch operations */}` and wrap it:

```tsx
{viewMode === "list" && (
  <div className="space-y-2">
    {/* ... all existing batch rows unchanged ... */}
  </div>
)}
```

- [ ] **Step 5: Verify in browser**

1. Navigate to a project's storyboard page with shots
2. List/Kanban toggle should appear in the top-right header
3. Switching to Kanban: 4 columns appear, shots sorted by pipeline stage
4. Kanban: batch buttons appear in each column (only when shots exist in that column)
5. Kanban: clicking a shot mini-card opens the drawer (Feature A)
6. Kanban: clicking prev/next in the drawer navigates the correct shot
7. Batch control rows (rows 1-4) should be hidden in kanban view
8. View mode persists across page reloads

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/project/[id]/storyboard/page.tsx
git commit -m "feat: wire ShotKanban into StoryboardPage (Feature C)"
```

---

## Task 9: Final Integration Check

- [ ] **Step 1: Test all three features together**

Verify the following interactions:
- Feature A: Drawer works in both list view and kanban view
- Feature B: Characters panel is visible in both keyframe and reference mode
- Feature C: Kanban view works with both `keyframe` and `reference` generation modes (correct batch handlers called)
- Feature B + C: Characters panel remains visible at top of control panel in kanban mode (it's inside the control block which is always shown)
- All i18n strings render correctly (check one non-English locale via URL prefix e.g. `/zh/project/...`)

- [ ] **Step 2: Build check**

```bash
pnpm build 2>&1 | tail -20
```

Expected: no TypeScript errors, successful build.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: storyboard workflow UX — drawer, inline panel, kanban view"
```
