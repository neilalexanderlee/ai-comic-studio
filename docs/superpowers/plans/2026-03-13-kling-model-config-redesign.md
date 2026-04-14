# Kling AI Provider + Model Config UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kling AI as a new image+video provider protocol, and restructure the model settings UI so language/image/video providers are configured in three separate independent sections.

**Architecture:** Single-capability providers (one `Capability` per `Provider`), three `ProviderSection` components on the settings page each scoped to one capability type. Two new Kling provider classes (`KlingImageProvider`, `KlingVideoProvider`) using async task polling. Zustand store migrated to v2 with `capabilities[]` → `capability` (single).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zustand + persist middleware, Tailwind CSS, next-intl, Lucide icons. No test framework — use `npm run build` for TypeScript validation and manual browser check for UI.

**Spec:** `docs/superpowers/specs/2026-03-13-kling-provider-model-config-redesign.md`

---

## Chunk 1: Data Layer

### Task 1: Update `model-store.ts` — single capability + Kling protocol + Zustand v2 migration

**Files:**
- Modify: `src/stores/model-store.ts`

- [ ] **Step 1.1: Update `Protocol` type and `Provider` interface**

Open `src/stores/model-store.ts`. Make these changes:

```ts
// Line 5 — add "kling"
export type Protocol = "openai" | "gemini" | "seedance" | "kling";

// Lines 14-22 — replace capabilities: Capability[] with capability: Capability
export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  capability: Capability;   // was: capabilities: Capability[]
  baseUrl: string;
  apiKey: string;
  models: Model[];
}
```

- [ ] **Step 1.2: Update `addProvider` action signature and initial value**

In the store body, the `addProvider` action accepts `Omit<Provider, "id" | "models">`. No change needed to the action itself — TypeScript will enforce the new shape at call sites.

- [ ] **Step 1.3: Remove `updateProvider` capabilities references**

Search the store for any call that passes `capabilities` to `updateProvider` — there are none in the store itself (that was in `provider-form.tsx`). No change needed in the store body.

- [ ] **Step 1.4: Add Zustand persist version, migrate, and merge**

Replace the final `persist` options object `{ name: "model-store" }` with:

```ts
{
  name: "model-store",
  version: 2,
  migrate: (persistedState: unknown, fromVersion: number) => {
    // Called only when stored data has an explicit version number that differs from 2.
    // For data with no version field (legacy), the merge function below handles migration.
    if (fromVersion < 2) {
      const state = persistedState as Record<string, unknown>;
      const providers = (state.providers as Array<Record<string, unknown>>) ?? [];
      return {
        ...state,
        providers: providers.map((p) => {
          const caps = (p.capabilities as string[]) ?? [];
          return { ...p, capability: caps[0] ?? "text" };
        }),
      };
    }
    return persistedState;
  },
  merge: (persistedState: unknown, currentState) => {
    // Handles legacy stored data that has no version field (Zustand skips migrate in that case).
    const ps = persistedState as Record<string, unknown>;
    const providers = (ps?.providers as Array<Record<string, unknown>>) ?? [];
    const migrated = providers.map((p) => {
      if (typeof p.capability === "string") return p; // already migrated
      const caps = (p.capabilities as string[]) ?? [];
      return { ...p, capability: caps[0] ?? "text" };
    });
    return { ...currentState, ...ps, providers: migrated };
  },
}
```

- [ ] **Step 1.5: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && npm run build 2>&1 | head -60
```

Expected: compile errors in `provider-form.tsx`, `settings/page.tsx`, `default-model-picker.tsx`, and `model-selector.tsx` (all referencing old `capabilities` field) — these are expected and will be fixed in later tasks. The store itself should have no errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/stores/model-store.ts
git commit -m "feat: migrate Provider to single capability, add kling protocol, Zustand v2 migration"
```

---

### Task 2: Update i18n files — add section labels, remove dead key

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh.json`
- Modify: `messages/ja.json`
- Modify: `messages/ko.json`

- [ ] **Step 2.1: Update `messages/en.json`**

In the `"settings"` object:
1. Remove the `"capabilities"` key.
2. Add three new keys after `"defaultVideoModel"`:

```json
"languageModels": "Language Models",
"imageModels": "Image Models",
"videoModels": "Video Models"
```

- [ ] **Step 2.2: Update `messages/zh.json`**

In the `"settings"` object:
1. Remove `"capabilities": "能力"`.
2. Add:
```json
"languageModels": "语言模型",
"imageModels": "图片模型",
"videoModels": "视频模型"
```

- [ ] **Step 2.3: Update `messages/ja.json`**

In the `"settings"` object:
1. Remove `"capabilities": "機能"`.
2. Add:
```json
"languageModels": "言語モデル",
"imageModels": "画像モデル",
"videoModels": "動画モデル"
```

- [ ] **Step 2.4: Update `messages/ko.json`**

In the `"settings"` object:
1. Remove `"capabilities": "기능"`.
2. Add:
```json
"languageModels": "언어 모델",
"imageModels": "이미지 모델",
"videoModels": "비디오 모델"
```

- [ ] **Step 2.5: Commit**

```bash
git add messages/en.json messages/zh.json messages/ja.json messages/ko.json
git commit -m "feat: add languageModels/imageModels/videoModels i18n keys, remove unused capabilities key"
```

---

## Chunk 2: UI Components

### Task 3: Fix `DefaultModelPicker` and `model-selector.tsx` — capability field rename

**Files:**
- Modify: `src/components/settings/default-model-picker.tsx`
- Modify: `src/components/editor/model-selector.tsx`

- [ ] **Step 3.1: Update `DefaultModelPicker.getOptions`**

In `src/components/settings/default-model-picker.tsx`, find the `getOptions` function (around line 83). Change:

```ts
// Before
if (
  !p.capabilities.includes(capability as "text" | "image" | "video")
)
  continue;

// After
if (p.capability !== capability) continue;
```

- [ ] **Step 3.2: Update `model-selector.tsx` InlineModelPicker**

In `src/components/editor/model-selector.tsx`, find line 44 inside the `InlineModelPicker` function. Change:

```ts
// Before
if (!p.capabilities.includes(capability)) continue;

// After
if (p.capability !== capability) continue;
```

- [ ] **Step 3.3: Verify build**

```bash
npm run build 2>&1 | grep -E "default-model-picker|model-selector" | head -10
```

Expected: no errors for either file.

- [ ] **Step 3.4: Commit**

```bash
git add src/components/settings/default-model-picker.tsx src/components/editor/model-selector.tsx
git commit -m "fix: update DefaultModelPicker and InlineModelPicker to use singular provider.capability"
```

---

### Task 4: Update `ProviderForm` — remove capability UI, add protocol filtering

**Files:**
- Modify: `src/components/settings/provider-form.tsx`

- [ ] **Step 4.1: Remove `PROTOCOL_OPTIONS` constant and `CAPABILITY_OPTIONS` constant**

Delete lines 16-26 (the two constant arrays at the top of the file).

- [ ] **Step 4.2: Add `getProtocolOptions` helper**

Note: `Capability` is already imported in the existing import block from `@/stores/model-store` — do not add a duplicate import.

Add this function right after the existing imports:

```ts

function getProtocolOptions(capability: Capability): { value: Protocol; label: string }[] {
  if (capability === "text") {
    return [
      { value: "openai", label: "OpenAI" },
      { value: "gemini", label: "Gemini" },
    ];
  }
  if (capability === "image") {
    return [
      { value: "openai", label: "OpenAI" },
      { value: "gemini", label: "Gemini" },
      { value: "kling", label: "Kling" },
    ];
  }
  // video
  return [
    { value: "seedance", label: "Seedance" },
    { value: "gemini", label: "Gemini (Veo)" },
    { value: "kling", label: "Kling" },
  ];
}
```

- [ ] **Step 4.3: Remove `handleCapabilityToggle` function**

Delete the entire `handleCapabilityToggle` function (around lines 80-85 in the original file).

- [ ] **Step 4.4: Remove capability checkbox UI block**

In the JSX, delete the entire `<div className="space-y-1.5">` block that renders the capability buttons (the third column in the Row 1 grid, with `CAPABILITY_OPTIONS.map`). This is the block starting with `<Label className="text-xs">{t("capabilities")}</Label>`.

- [ ] **Step 4.5: Update protocol buttons to use `getProtocolOptions`**

Replace the protocol buttons render with:

```tsx
{getProtocolOptions(provider.capability).map((opt) => (
  <button
    key={opt.value}
    onClick={() =>
      updateProvider(provider.id, { protocol: opt.value })
    }
    className={`rounded-lg border px-2.5 py-[7px] text-xs transition-all ${
      provider.protocol === opt.value
        ? "border-primary/30 bg-primary/8 text-primary font-medium"
        : "border-[--border-subtle] text-[--text-secondary] hover:border-[--border-hover]"
    }`}
  >
    {opt.label}
  </button>
))}
```

- [ ] **Step 4.6: Fix "Fetch Models" button disabled condition for Kling**

In the models section, find the "Fetch Models" `<Button>` (around line 187 in the original file). Update its `disabled` condition:

```tsx
// Before
disabled={fetching || !provider.apiKey}

// After
disabled={fetching || (!provider.apiKey && provider.protocol !== "kling")}
```

This allows Kling providers to fetch models (which uses a static list) without requiring an API key.

- [ ] **Step 4.7: Update the Row 1 grid**

Since we removed the capabilities column, change the grid from 3 columns to 2:

```tsx
// Before
<div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto]">

// After
<div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
```

- [ ] **Step 4.7: Verify build**

```bash
npm run build 2>&1 | grep "provider-form" | head -10
```

Expected: no errors for this file.

- [ ] **Step 4.8: Commit**

```bash
git add src/components/settings/provider-form.tsx
git commit -m "feat: remove capability checkbox from ProviderForm, filter protocols by provider.capability, allow Kling model fetch without API key"
```

---

### Task 5: Create `ProviderSection` component

**Files:**
- Create: `src/components/settings/provider-section.tsx`

- [ ] **Step 5.1: Create the component**

Create `src/components/settings/provider-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useModelStore, type Capability, type Protocol } from "@/stores/model-store";
import { ProviderCard } from "@/components/settings/provider-card";
import { ProviderForm } from "@/components/settings/provider-form";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface ProviderSectionProps {
  capability: Capability;
  label: string;
  icon: React.ReactNode;
  defaultProtocol: Protocol;
  defaultBaseUrl: string;
}

export function ProviderSection({
  capability,
  label,
  icon,
  defaultProtocol,
  defaultBaseUrl,
}: ProviderSectionProps) {
  const t = useTranslations("settings");
  const { providers, addProvider, removeProvider } = useModelStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sectionProviders = providers.filter((p) => p.capability === capability);
  const selectedProvider = sectionProviders.find((p) => p.id === selectedId) || null;

  function handleAdd() {
    const id = addProvider({
      name: "New Provider",
      protocol: defaultProtocol,
      capability,
      baseUrl: defaultBaseUrl,
      apiKey: "",
    });
    setSelectedId(id);
  }

  function handleDelete(id: string) {
    removeProvider(id);
    if (selectedId === id) {
      const remaining = sectionProviders.filter((p) => p.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  return (
    <div className="rounded-2xl border border-[--border-subtle] bg-white p-5 space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
          {icon}
          {label}
        </h3>
        <Button size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="h-3.5 w-3.5" />
          {t("addProvider")}
        </Button>
      </div>

      {sectionProviders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-10">
          <div className="h-6 w-6 text-[--text-muted]">{icon}</div>
          <p className="mt-2 text-sm text-[--text-muted]">{t("noProviders")}</p>
          <Button size="sm" className="mt-3" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
            {t("addProvider")}
          </Button>
        </div>
      ) : (
        <>
          {/* Provider cards */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sectionProviders.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </div>

          {/* Provider form */}
          {selectedProvider ? (
            <ProviderForm key={selectedProvider.id} provider={selectedProvider} />
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-8">
              <p className="text-sm text-[--text-muted]">{t("selectProvider")}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5.2: Verify build**

```bash
npm run build 2>&1 | grep "provider-section" | head -10
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/components/settings/provider-section.tsx
git commit -m "feat: add ProviderSection component for per-capability provider management"
```

---

### Task 6: Restructure `settings/page.tsx`

**Files:**
- Modify: `src/app/[locale]/settings/page.tsx`

- [ ] **Step 6.1: Replace the page content**

Replace the entire content of `src/app/[locale]/settings/page.tsx` with:

```tsx
"use client";

import { DefaultModelPicker } from "@/components/settings/default-model-picker";
import { ProviderSection } from "@/components/settings/provider-section";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, Zap, Type, ImageIcon, VideoIcon } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-white/80 backdrop-blur-xl px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings className="h-3.5 w-3.5" />
            </div>
            <span className="font-display text-sm font-semibold text-[--text-primary]">
              {t("title")}
            </span>
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="flex-1 bg-[--surface] p-4 lg:p-6">
        <div className="mx-auto max-w-4xl animate-page-in space-y-5">
          {/* Default model selection */}
          <div className="rounded-2xl border border-[--border-subtle] bg-white p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
              <Zap className="h-3.5 w-3.5" />
              {t("defaultModels")}
            </h3>
            <DefaultModelPicker />
          </div>

          {/* Language Models section */}
          <ProviderSection
            capability="text"
            label={t("languageModels")}
            icon={<Type className="h-3.5 w-3.5" />}
            defaultProtocol="openai"
            defaultBaseUrl="https://api.openai.com"
          />

          {/* Image Models section */}
          <ProviderSection
            capability="image"
            label={t("imageModels")}
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            defaultProtocol="kling"
            defaultBaseUrl="https://api.klingai.com"
          />

          {/* Video Models section */}
          <ProviderSection
            capability="video"
            label={t("videoModels")}
            icon={<VideoIcon className="h-3.5 w-3.5" />}
            defaultProtocol="kling"
            defaultBaseUrl="https://api.klingai.com"
          />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 6.2: Verify full build passes**

```bash
npm run build 2>&1 | head -60
```

Expected: no TypeScript errors. There may still be errors from `kling-image.ts` / `kling-video.ts` not existing yet — those are fine; they come from `provider-factory.ts` imports which aren't changed yet.

- [ ] **Step 6.3: Commit**

```bash
git add src/app/[locale]/settings/page.tsx
git commit -m "feat: restructure settings page into Language/Image/Video provider sections"
```

---

## Chunk 3: Kling Providers + Factory + Route

### Task 7: Create `KlingImageProvider`

**Files:**
- Create: `src/lib/ai/providers/kling-image.ts`

- [ ] **Step 7.1: Create the file**

Create `src/lib/ai/providers/kling-image.ts`:

```ts
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

interface KlingResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg: string;
  task_result: {
    images?: { url: string }[];
  };
}

export class KlingImageProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.KLING_API_KEY || "";
    this.baseUrl = (params?.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    this.model = params?.model || "kling-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("Kling does not support text generation");
  }

  async generateImage(prompt: string, _options?: ImageOptions): Promise<string> {
    // Submit task
    const submitRes = await fetch(`${this.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        aspect_ratio: "16:9",
      }),
    });

    if (!submitRes.ok) {
      throw new Error(`Kling image submit failed: ${submitRes.status}`);
    }

    const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
    if (submitJson.code !== 0) {
      throw new Error(`Kling image error: ${submitJson.message}`);
    }

    const taskId = submitJson.data.task_id;
    console.log(`[Kling Image] Task submitted: ${taskId}`);

    // Poll for result
    const imageUrl = await this.pollForResult(taskId);

    // Download to local storage
    const imageRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const ext = imageUrl.split("?")[0].split(".").pop() || "png";
    const filename = `${ulid()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[Kling Image] Saved to ${filepath}`);
    return filepath;
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 60;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      const res = await fetch(`${this.baseUrl}/v1/images/generations/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        throw new Error(`Kling image poll failed: ${res.status}`);
      }

      const json = (await res.json()) as KlingResponse<KlingTaskData>;

      if (json.code !== 0) {
        throw new Error(`Kling image poll error: ${json.message}`);
      }

      const { task_status, task_status_msg, task_result } = json.data;
      console.log(`[Kling Image] Poll ${i + 1}: status=${task_status}`);

      if (task_status === "succeed") {
        const url = task_result.images?.[0]?.url;
        if (!url) throw new Error("Kling image: no URL in result");
        return url;
      }

      if (task_status === "failed") {
        throw new Error(`Kling image generation failed: ${task_status_msg}`);
      }
    }

    throw new Error("Kling image generation timed out after 5 minutes");
  }
}
```

- [ ] **Step 7.2: Verify build**

```bash
npm run build 2>&1 | grep "kling-image" | head -10
```

Expected: no errors for this file.

- [ ] **Step 7.3: Commit**

```bash
git add src/lib/ai/providers/kling-image.ts
git commit -m "feat: add KlingImageProvider with async polling"
```

---

### Task 8: Create `KlingVideoProvider`

**Files:**
- Create: `src/lib/ai/providers/kling-video.ts`

- [ ] **Step 8.1: Create the file**

Create `src/lib/ai/providers/kling-video.ts`:

```ts
import type { VideoProvider, VideoGenerateParams } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

interface KlingResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg: string;
  task_result: {
    videos?: { url: string }[];
  };
}

const VALID_DURATIONS = [5, 10] as const;

function clampDuration(duration: number): number {
  return VALID_DURATIONS.reduce((prev, curr) =>
    Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
  );
}

function toDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
  const base64 = fs.readFileSync(filePath, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}

export class KlingVideoProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.KLING_API_KEY || "";
    this.baseUrl = (params?.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    this.model = params?.model || "kling-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<string> {
    const duration = clampDuration(params.duration);
    const aspectRatio = params.ratio ?? "16:9";
    const imageData = toDataUrl(params.firstFrame);
    const tailImageData = toDataUrl(params.lastFrame);

    console.log(
      `[Kling Video] Submitting: model=${this.model}, duration=${duration}s, ratio=${aspectRatio}`
    );

    const submitRes = await fetch(`${this.baseUrl}/v1/videos/image2video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt: params.prompt,
        image: imageData,
        tail_image: tailImageData,
        duration,
        aspect_ratio: aspectRatio,
      }),
    });

    if (!submitRes.ok) {
      throw new Error(`Kling video submit failed: ${submitRes.status}`);
    }

    const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
    if (submitJson.code !== 0) {
      throw new Error(`Kling video error: ${submitJson.message}`);
    }

    const taskId = submitJson.data.task_id;
    console.log(`[Kling Video] Task submitted: ${taskId}`);

    const videoUrl = await this.pollForResult(taskId);

    // Download video
    const videoRes = await fetch(videoUrl);
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const filename = `${ulid()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[Kling Video] Saved to ${filepath}`);
    return filepath;
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      const res = await fetch(`${this.baseUrl}/v1/videos/image2video/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        throw new Error(`Kling video poll failed: ${res.status}`);
      }

      const json = (await res.json()) as KlingResponse<KlingTaskData>;

      if (json.code !== 0) {
        throw new Error(`Kling video poll error: ${json.message}`);
      }

      const { task_status, task_status_msg, task_result } = json.data;
      console.log(`[Kling Video] Poll ${i + 1}: status=${task_status}`);

      if (task_status === "succeed") {
        const url = task_result.videos?.[0]?.url;
        if (!url) throw new Error("Kling video: no URL in result");
        return url;
      }

      if (task_status === "failed") {
        throw new Error(`Kling video generation failed: ${task_status_msg}`);
      }
    }

    throw new Error("Kling video generation timed out after 10 minutes");
  }
}
```

- [ ] **Step 8.2: Verify build**

```bash
npm run build 2>&1 | grep "kling-video" | head -10
```

Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/ai/providers/kling-video.ts
git commit -m "feat: add KlingVideoProvider with async polling"
```

---

### Task 9: Update `provider-factory.ts` — add Kling cases

**Files:**
- Modify: `src/lib/ai/provider-factory.ts`

- [ ] **Step 9.1: Add Kling imports**

At the top of `src/lib/ai/provider-factory.ts`, add:

```ts
import { KlingImageProvider } from "./providers/kling-image";
import { KlingVideoProvider } from "./providers/kling-video";
```

- [ ] **Step 9.2: Add `kling` case to `createAIProvider`**

In the `createAIProvider` switch statement, add before the `default` case:

```ts
case "kling":
  return new KlingImageProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.modelId,
  });
```

- [ ] **Step 9.3: Add `kling` case to `createVideoProvider`**

In the `createVideoProvider` switch statement, add before the `default` case:

```ts
case "kling":
  return new KlingVideoProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.modelId,
  });
```

- [ ] **Step 9.4: Verify build**

```bash
npm run build 2>&1 | head -40
```

Expected: no errors from `provider-factory.ts` or Kling provider files.

- [ ] **Step 9.5: Commit**

```bash
git add src/lib/ai/provider-factory.ts
git commit -m "feat: register KlingImageProvider and KlingVideoProvider in factory"
```

---

### Task 10: Update `/api/models/list` route — add Kling static model list

**Files:**
- Modify: `src/app/api/models/list/route.ts`

- [ ] **Step 10.1: Add `protocol` field to `ListRequest` and add Kling short-circuit**

The current `ListRequest` interface (lines 3-7) already has `protocol: string`. If it does not, add it.

Add the Kling early-return block inside `POST`, immediately after parsing the request body and before the `baseUrl`/`apiKey` validation:

```ts
// Add after: const body = (await request.json()) as ListRequest;
if (body.protocol === "kling") {
  return NextResponse.json({
    models: [
      { id: "kling-v1", name: "Kling v1" },
      { id: "kling-v1-5", name: "Kling v1.5" },
      { id: "kling-v1-6", name: "Kling v1.6" },
      { id: "kling-v2", name: "Kling v2" },
      { id: "kling-v2-new", name: "Kling v2 New" },
      { id: "kling-v2-1", name: "Kling v2.1" },
      { id: "kling-v2-master", name: "Kling v2 Master" },
      { id: "kling-v2-1-master", name: "Kling v2.1 Master" },
      { id: "kling-v2-5-turbo", name: "Kling v2.5 Turbo" },
    ],
  });
}
```

- [ ] **Step 10.2: Final full build check**

```bash
npm run build 2>&1
```

Expected: clean build with no TypeScript errors.

- [ ] **Step 10.3: Commit**

```bash
git add src/app/api/models/list/route.ts
git commit -m "feat: add Kling static model list to models/list route"
```

---

### Task 11: Manual verification

- [ ] **Step 11.1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 11.2: Test settings page**

Navigate to `/settings`. Verify:
- [ ] Three separate sections: "Language Models", "Image Models", "Video Models"
- [ ] Each section has an independent "+ Add Provider" button
- [ ] Clicking "+ Add Provider" in Language section → provider form shows only `openai` / `gemini` protocol options
- [ ] Clicking "+ Add Provider" in Image section → form shows `openai` / `gemini` / `kling`, pre-fills `https://api.klingai.com`
- [ ] Clicking "+ Add Provider" in Video section → form shows `seedance` / `gemini (Veo)` / `kling`, pre-fills `https://api.klingai.com`
- [ ] No capability checkboxes visible anywhere
- [ ] "Default Models" picker at the top still works (text/image/video dropdowns show providers from correct sections)

- [ ] **Step 11.3: Test Kling model fetch**

In Image section, add a Kling provider. Click "Fetch Models" (even without an API key filled — the Kling short-circuit runs before key validation). Verify the 9 Kling models appear in the list.

- [ ] **Step 11.4: Verify existing localStorage migration**

If you have existing providers from a previous session, open browser dev tools → Application → Local Storage → check that `model-store` data has `capability` (singular string) instead of `capabilities` (array) after the page reloads.

- [ ] **Step 11.5: Commit final verification**

```bash
git add -p  # stage any incidental fixes
git commit -m "chore: post-implementation verification complete" --allow-empty
```
