# Model Guard Design Spec
Date: 2026-03-13

## Overview

When users click any AI generation button without having configured the required model, they currently get no meaningful feedback — the API returns 400 silently. This spec covers adding a lightweight toast-based guard to all AI generation entry points.

## Approach

Use [Sonner](https://sonner.emilkowal.ski/) for toast notifications. On any generation button click, first check if the required model capability is configured. If not, show a warning toast with a "Go to Settings" action that navigates to `/${locale}/settings`.

## Core Hook: `useModelGuard`

**File:** `src/hooks/use-model-guard.ts`

```ts
useModelGuard(capability: 'text' | 'image' | 'video'): () => boolean
```

**Imports:**
```ts
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useModelStore } from "@/stores/model-store"
import { toast } from "sonner"
```

**Behavior:**
- Reads `getModelConfig()` from `useModelStore()`
- Reads current locale via `useLocale()` to build settings URL as `` `/${locale}/settings` ``
- Uses `useTranslations('settings')` — same namespace as existing model-related keys
- Returns a `guard()` function:
  - If `!useModelStore.persist.hasHydrated()`: returns `true` (store not yet rehydrated from localStorage; allow the action through — API handles missing config server-side). Note: `hasHydrated()` is part of Zustand v4+ persist middleware API, confirmed available in the project's `zustand@^5.0.11`.
  - If capability is `null` in `getModelConfig()`: fires `toast.warning(t('notConfiguredText|notConfiguredImage|notConfiguredVideo'), { action: { label: t('goSettings'), onClick: () => router.push(`/${locale}/settings`) } })`, returns `false`
  - If configured: returns `true`

**Usage pattern for multiple capabilities in one component:**
```ts
// One hook call per capability needed in the component
const textGuard = useModelGuard('text');
const imageGuard = useModelGuard('image');

// Each guard gates its own handler
function handleExtractCharacters() {
  if (!textGuard()) return;
  // ... existing logic
}
function handleBatchGenerateImages() {
  if (!imageGuard()) return;
  // ... existing logic
}
```

## Toast Setup

- Install sonner via `pnpm add sonner` (project uses pnpm)
- Add `<Toaster position="top-center" />` to `src/app/[locale]/layout.tsx` **inside** `<NextIntlClientProvider>`, as a sibling of `<FingerprintProvider>`. This is valid: Next.js App Router server components can render client components directly; `<Toaster>` requires no additional client boundary wrapper:
  ```tsx
  <NextIntlClientProvider messages={messages}>
    <FingerprintProvider>{children}</FingerprintProvider>
    <Toaster position="top-center" />
  </NextIntlClientProvider>
  ```

## i18n Keys

Add 4 new keys to all four message files under the existing **`"settings"`** namespace. Note: the existing `settings.configureModels` ("请先配置模型") is a generic label used in the settings UI — it is NOT reused here. The new per-capability keys (`notConfiguredText/Image/Video`) provide specific messages for the toast body, and `goSettings` is the toast action button label ("前往设置"):

| Key | zh | en | ja | ko |
|-----|----|----|----|----|
| `settings.notConfiguredText` | 请先配置文本模型 | Please configure a text model first | テキストモデルを先に設定してください | 먼저 텍스트 모델을 설정해주세요 |
| `settings.notConfiguredImage` | 请先配置图像模型 | Please configure an image model first | 画像モデルを先に設定してください | 먼저 이미지 모델을 설정해주세요 |
| `settings.notConfiguredVideo` | 请先配置视频模型 | Please configure a video model first | 動画モデルを先に設定してください | 먼저 비디오 모델을 설정해주세요 |
| `settings.goSettings` | 前往设置 | Go to Settings | 設定へ | 설정으로 이동 |

## Generation Buttons (9 total)

| # | Button Label Key | Capability | File | Notes |
|---|-----------------|-----------|------|-------|
| 1 | `project.generateScript` | text | `src/components/editor/script-editor.tsx` | |
| 2 | `project.extractCharacters` | text | `src/app/[locale]/project/[id]/characters/page.tsx` | |
| 3 | `character.batchGenerateImages` | image | `src/app/[locale]/project/[id]/characters/page.tsx` | |
| 4 | `character.generateImage` | image | `src/components/editor/character-card.tsx` | |
| 5 | `project.generateShots` | text | `src/app/[locale]/project/[id]/storyboard/page.tsx` | |
| 6 | `project.batchGenerateFrames` | image | `src/app/[locale]/project/[id]/storyboard/page.tsx` | |
| 7 | `project.batchGenerateVideos` | video | `src/app/[locale]/project/[id]/storyboard/page.tsx` | |
| 8 | `project.generateFrames` | image | `src/components/editor/shot-card.tsx` | Button appears in both collapsed header AND expanded panel — guard must be added to the shared `handleGenerateFrame` function (called by both), not to individual JSX sites |
| 9 | `project.generateVideo` | video | `src/components/editor/shot-card.tsx` | Same as above — add guard to `handleGenerateVideo` function |

**Excluded:**
- `project.assembleVideo` (preview page) — no model required
- `project.parseScript` — not exposed in current UI

## Affected Files (11 files)

| File | Change |
|------|--------|
| `package.json` | Add `sonner` dependency |
| `src/app/[locale]/layout.tsx` | Add `<Toaster position="top-center" />` inside `<NextIntlClientProvider>` |
| `src/hooks/use-model-guard.ts` | **New file** — core guard hook |
| `messages/en.json` | Add 4 keys under `settings` namespace |
| `messages/zh.json` | Add 4 keys under `settings` namespace |
| `messages/ja.json` | Add 4 keys under `settings` namespace |
| `messages/ko.json` | Add 4 keys under `settings` namespace |
| `src/components/editor/script-editor.tsx` | Add text guard |
| `src/app/[locale]/project/[id]/characters/page.tsx` | Add text + image guards (two separate hook calls) |
| `src/components/editor/character-card.tsx` | Add image guard |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Add text + image + video guards (three separate hook calls) |
| `src/components/editor/shot-card.tsx` | Add image + video guards to handler functions (two hook calls; each guard covers both collapsed + expanded JSX sites via shared handler) |

## What is NOT in scope

- Disabling buttons when model not configured (toast UX chosen instead)
- Inline model configuration in the toast
- Server-side error handling changes (existing 400 responses remain as fallback)
