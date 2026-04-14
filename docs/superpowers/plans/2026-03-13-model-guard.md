# Model Guard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a toast notification (with "Go to Settings" action) whenever a user clicks any AI generation button without having configured the required model.

**Architecture:** Install Sonner for toast UI. Create a `useModelGuard(capability)` hook that checks the Zustand model store and fires a toast if the required capability is unconfigured. Add the guard to the top of each generation handler across 5 components.

**Tech Stack:** sonner (new), Zustand v5 persist middleware, next-intl, Next.js App Router

**Spec:** `docs/superpowers/specs/2026-03-13-model-guard-design.md`

---

## Chunk 1: Infrastructure — Sonner + i18n keys

### Task 1: Install sonner

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install sonner**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm add sonner
```

Expected: sonner added to `dependencies` in `package.json`.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: install sonner for toast notifications"
```

---

### Task 2: Add Toaster to locale layout

**Files:**
- Modify: `src/app/[locale]/layout.tsx`

Current structure (lines 54-56):
```tsx
<NextIntlClientProvider messages={messages}>
  <FingerprintProvider>{children}</FingerprintProvider>
</NextIntlClientProvider>
```

- [ ] **Step 1: Add Toaster import and component**

Edit `src/app/[locale]/layout.tsx`:

Add import at top of file:
```tsx
import { Toaster } from "sonner";
```

Change lines 54-56 to:
```tsx
<NextIntlClientProvider messages={messages}>
  <FingerprintProvider>{children}</FingerprintProvider>
  <Toaster position="top-center" />
</NextIntlClientProvider>
```

- [ ] **Step 2: Verify dev server starts without error**

```bash
pnpm dev
```

Expected: No TypeScript or import errors. Visit any page — no console errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/layout.tsx
git commit -m "feat: add Sonner Toaster to locale layout"
```

---

### Task 3: Add i18n keys to all 4 message files

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `messages/ja.json`
- Modify: `messages/ko.json`

Add 4 new keys inside the `"settings"` object in each file, after the existing `"configureModels"` key.

The 4 new keys must be added as **direct children** of the `"settings"` object (not nested inside a sub-object). The resulting shape should be:
```json
"settings": {
  ...existing keys...,
  "configureModels": "...",
  "notConfiguredText": "...",
  "notConfiguredImage": "...",
  "notConfiguredVideo": "...",
  "goSettings": "...",
  ...remaining existing keys...
}
```

- [ ] **Step 1: Update messages/zh.json**

Find the `"settings"` object and add after `"configureModels": "请先配置模型",`:
```json
"notConfiguredText": "请先配置文本模型",
"notConfiguredImage": "请先配置图像模型",
"notConfiguredVideo": "请先配置视频模型",
"goSettings": "前往设置",
```

- [ ] **Step 2: Update messages/en.json**

Find the `"settings"` object and add after `"configureModels": "Configure models",`:
```json
"notConfiguredText": "Please configure a text model first",
"notConfiguredImage": "Please configure an image model first",
"notConfiguredVideo": "Please configure a video model first",
"goSettings": "Go to Settings",
```

- [ ] **Step 3: Update messages/ja.json**

Find the `"settings"` object and add after `"configureModels"`:
```json
"notConfiguredText": "テキストモデルを先に設定してください",
"notConfiguredImage": "画像モデルを先に設定してください",
"notConfiguredVideo": "動画モデルを先に設定してください",
"goSettings": "設定へ",
```

- [ ] **Step 4: Update messages/ko.json**

Find the `"settings"` object and add after `"configureModels"`:
```json
"notConfiguredText": "먼저 텍스트 모델을 설정해주세요",
"notConfiguredImage": "먼저 이미지 모델을 설정해주세요",
"notConfiguredVideo": "먼저 비디오 모델을 설정해주세요",
"goSettings": "설정으로 이동",
```

- [ ] **Step 5: Commit**

```bash
git add messages/
git commit -m "feat: add model guard i18n keys to all locales"
```

---

## Chunk 2: Core Hook — useModelGuard

### Task 4: Create useModelGuard hook

**Files:**
- Create: `src/hooks/use-model-guard.ts`

- [ ] **Step 1: Create the hook file**

Create `src/hooks/use-model-guard.ts` with this exact content:

```ts
"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useModelStore } from "@/stores/model-store";
import { toast } from "sonner";
import type { Capability } from "@/stores/model-store";

/**
 * Returns a guard() function for the given model capability.
 * Call guard() at the top of any AI generation handler.
 * Returns false (and shows a toast) if the model is not configured.
 * Returns true if the model is configured and the action can proceed.
 */
export function useModelGuard(capability: Capability): () => boolean {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settings");
  // Use selector pattern (consistent with codebase; avoids re-renders on unrelated store changes)
  const getModelConfig = useModelStore((s) => s.getModelConfig);

  return function guard(): boolean {
    // If the store hasn't hydrated from localStorage yet, allow through.
    // The API will handle missing config server-side.
    if (!useModelStore.persist.hasHydrated()) {
      return true;
    }

    const config = getModelConfig();

    if (config[capability] === null) {
      const messageKey =
        capability === "text"
          ? "notConfiguredText"
          : capability === "image"
            ? "notConfiguredImage"
            : "notConfiguredVideo";

      toast.warning(t(messageKey), {
        action: {
          label: t("goSettings"),
          onClick: () => router.push(`/${locale}/settings`),
        },
      });
      return false;
    }

    return true;
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 3: Manual smoke test**

Start dev server (`pnpm dev`), open any project page, open browser DevTools console, and in Application > Local Storage clear the `model-store` key. Reload the page and click any generation button — confirm no false-positive toast fires (store not hydrated path).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-model-guard.ts
git commit -m "feat: add useModelGuard hook for model config validation"
```

---

## Chunk 3: Apply guard to script-editor, characters page, character-card

### Task 5: Guard in ScriptEditor

**Files:**
- Modify: `src/components/editor/script-editor.tsx`

The `handleGenerateScript` function starts at line 41. We need to:
1. Add import for `useModelGuard`
2. Call the hook inside the component
3. Add guard check at the top of `handleGenerateScript`

- [ ] **Step 1: Add import**

In `src/components/editor/script-editor.tsx`, add to the import block:
```tsx
import { useModelGuard } from "@/hooks/use-model-guard";
```

- [ ] **Step 2: Add hook call inside ScriptEditor component**

After the existing `const [generating, setGenerating] = useState(false);` line (line 18), add:
```tsx
const textGuard = useModelGuard("text");
```

- [ ] **Step 3: Add guard check to handler**

In `handleGenerateScript` (line 41), add guard at the very top, after the `if (!project) return;` check:
```tsx
async function handleGenerateScript() {
  if (!project) return;
  if (!textGuard()) return;   // ← add this line
  setGenerating(true);
  // ... rest of function unchanged
```

- [ ] **Step 4: Manual verification**

With model store cleared (remove `model-store` from localStorage), click "AI Generate Script". Confirm:
- Toast appears at top-center with "请先配置文本模型" (zh) or "Please configure a text model first" (en)
- Toast has "前往设置" / "Go to Settings" button
- Clicking the button navigates to `/[locale]/settings`
- No API call is made

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/script-editor.tsx
git commit -m "feat: add model guard to script generation"
```

---

### Task 6: Guards in CharactersPage

**Files:**
- Modify: `src/app/[locale]/project/[id]/characters/page.tsx`

Two handlers need guards: `handleExtractCharacters` (text) and `handleBatchGenerateImages` (image).

- [ ] **Step 1: Add import**

Add to the import block:
```tsx
import { useModelGuard } from "@/hooks/use-model-guard";
```

- [ ] **Step 2: Add hook calls inside CharactersPage component**

After the existing `const [generatingImages, setGeneratingImages] = useState(false);` line (line 18), add:
```tsx
const textGuard = useModelGuard("text");
const imageGuard = useModelGuard("image");
```

- [ ] **Step 3: Guard handleExtractCharacters**

In `handleExtractCharacters` (line 26), after `if (!project) return;`:
```tsx
async function handleExtractCharacters() {
  if (!project) return;
  if (!textGuard()) return;   // ← add this line
  setExtracting(true);
```

- [ ] **Step 4: Guard handleBatchGenerateImages**

In `handleBatchGenerateImages` (line 55), after `if (!project) return;`:
```tsx
async function handleBatchGenerateImages() {
  if (!project) return;
  if (!imageGuard()) return;   // ← add this line
  setGeneratingImages(true);
```

- [ ] **Step 5: Manual verification**

With model store cleared, test both buttons on the characters page. Each should show capability-specific toast.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/project/[id]/characters/page.tsx"
git commit -m "feat: add model guards to character extraction and batch image generation"
```

---

### Task 7: Guard in CharacterCard

**Files:**
- Modify: `src/components/editor/character-card.tsx`

One handler: `handleGenerateImage` (image).

- [ ] **Step 1: Add import**

Add to the import block:
```tsx
import { useModelGuard } from "@/hooks/use-model-guard";
```

- [ ] **Step 2: Add hook call inside CharacterCard component**

After the existing `const [lightbox, setLightbox] = useState(false);` line (line 37), add:
```tsx
const imageGuard = useModelGuard("image");
```

- [ ] **Step 3: Guard handleGenerateImage**

In `handleGenerateImage` (line 48), add guard at the top:
```tsx
async function handleGenerateImage() {
  if (!imageGuard()) return;   // ← add this line
  setGenerating(true);
```

- [ ] **Step 4: Manual verification**

With model store cleared, click "Generate Turnaround" on any character card. Confirm image-specific toast appears.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/character-card.tsx
git commit -m "feat: add model guard to single character image generation"
```

---

## Chunk 4: Apply guard to storyboard page and shot-card

### Task 8: Guards in StoryboardPage

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

Three handlers need guards: `handleGenerateShots` (text), `handleBatchGenerateFrames` (image), `handleBatchGenerateVideos` (video).

- [ ] **Step 1: Add import**

Add to the import block:
```tsx
import { useModelGuard } from "@/hooks/use-model-guard";
```

- [ ] **Step 2: Add hook calls inside StoryboardPage component**

After the existing `const [videoRatio, setVideoRatio] = useState("16:9");` line (line 90), add:
```tsx
const textGuard = useModelGuard("text");
const imageGuard = useModelGuard("image");
const videoGuard = useModelGuard("video");
```

- [ ] **Step 3: Guard handleGenerateShots**

In `handleGenerateShots` (line 120), after `if (!project) return;`:
```tsx
async function handleGenerateShots() {
  if (!project) return;
  if (!textGuard()) return;   // ← add this line
  setGenerating(true);
```

- [ ] **Step 4: Guard handleBatchGenerateFrames**

In `handleBatchGenerateFrames` (line 149), after `if (!project) return;`:
```tsx
async function handleBatchGenerateFrames() {
  if (!project) return;
  if (!imageGuard()) return;   // ← add this line
  setGeneratingFrames(true);
```

- [ ] **Step 5: Guard handleBatchGenerateVideos**

In `handleBatchGenerateVideos` (line 171), after `if (!project) return;`:
```tsx
async function handleBatchGenerateVideos() {
  if (!project) return;
  if (!videoGuard()) return;   // ← add this line
  setGeneratingVideos(true);
```

- [ ] **Step 6: Manual verification**

With model store cleared, test all three batch buttons on the storyboard page. Each shows the correct capability-specific toast.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/project/[id]/storyboard/page.tsx"
git commit -m "feat: add model guards to storyboard shot/frame/video generation"
```

---

### Task 9: Guards in ShotCard

**Files:**
- Modify: `src/components/editor/shot-card.tsx`

Two handlers: `handleGenerateFrames` (image), `handleGenerateVideo` (video).
Note: each handler is called from two JSX locations (collapsed header + expanded panel). Adding the guard to the shared handler function covers both call sites automatically.

- [ ] **Step 1: Add import**

Add to the import block:
```tsx
import { useModelGuard } from "@/hooks/use-model-guard";
```

- [ ] **Step 2: Add hook calls inside ShotCard component**

After the existing `const [videoRatio, setVideoRatio] = useState("16:9");` line (line 84), add:
```tsx
const imageGuard = useModelGuard("image");
const videoGuard = useModelGuard("video");
```

- [ ] **Step 3: Guard handleGenerateFrames**

In `handleGenerateFrames` (line 100), add guard at the top:
```tsx
async function handleGenerateFrames() {
  if (!imageGuard()) return;   // ← add this line
  setGeneratingFrames(true);
```

- [ ] **Step 4: Guard handleGenerateVideo**

In `handleGenerateVideo` (line 119), add guard at the top:
```tsx
async function handleGenerateVideo() {
  if (!videoGuard()) return;   // ← add this line
  setGeneratingVideo(true);
```

- [ ] **Step 5: Manual verification**

With model store cleared, expand a shot card and click both "Generate Frames" and "Generate Video". Also test the collapsed-header buttons. All 4 click paths should show the correct toast and make no API call.

- [ ] **Step 6: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/shot-card.tsx
git commit -m "feat: add model guards to shot frame and video generation"
```

---

## Chunk 5: Final verification

### Task 10: End-to-end smoke test

- [ ] **Step 1: Full guard coverage check (no model configured)**

Start dev server. Clear `model-store` from localStorage. Go through all 4 pages and verify every AI generation button shows a toast:

| Page | Button | Expected toast |
|------|--------|----------------|
| Script | AI Generate Script | text model toast |
| Characters | Parse Characters | text model toast |
| Characters | Batch Generate Turnarounds | image model toast |
| Characters (card) | Generate Turnaround | image model toast |
| Storyboard | Generate Shots | text model toast |
| Storyboard | Batch Generate Frames | image model toast |
| Storyboard | Batch Generate Videos | video model toast |
| Storyboard (shot) | Generate Frames (header) | image model toast |
| Storyboard (shot) | Generate Frames (expanded) | image model toast |
| Storyboard (shot) | Generate Video (header) | video model toast |
| Storyboard (shot) | Generate Video (expanded) | video model toast |

- [ ] **Step 2: "Go to Settings" navigation check**

Click the action button in any toast. Confirm it navigates to `/{locale}/settings`.

- [ ] **Step 3: Happy path check (model configured)**

Configure a text + image + video model in settings. Return to each page and confirm buttons work normally — no toast, API calls proceed as before.

- [ ] **Step 4: Final TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: model guard complete — all AI generation buttons validated"
```
