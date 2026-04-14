---
title: Kling AI Provider + Model Config UI Redesign
date: 2026-03-13
status: approved
---

# Kling AI Provider + Model Config UI Redesign

## Overview

Two coupled changes:
1. **Add Kling AI** as a new provider protocol supporting image generation (text-to-image) and video generation (image-to-video).
2. **Redesign the model configuration UI** so that language, image, and video models are configured in separate, independent sections — a provider belongs to exactly one capability type.

---

## 1. Data Structure Changes

### `model-store.ts`

**`Protocol` type** — add `"kling"`:
```ts
export type Protocol = "openai" | "gemini" | "seedance" | "kling";
```

**`Provider.capability`** — change from `capabilities: Capability[]` (multi-select) to `capability: Capability` (single value):
```ts
// Before
export interface Provider {
  capabilities: Capability[];
  ...
}

// After
export interface Provider {
  capability: Capability;  // single value, set at creation time
  ...
}
```

**localStorage migration** — use Zustand `persist` middleware `version` + `migrate` option:
```ts
persist(
  (set, get) => ({ ... }),
  {
    name: "model-store",
    version: 2,
    migrate: (persistedState: unknown, fromVersion: number) => {
      const state = persistedState as Record<string, unknown>;
      if (fromVersion < 2) {
        const providers = (state.providers as Array<Record<string, unknown>>) ?? [];
        state.providers = providers.map((p) => {
          const caps = (p.capabilities as Capability[]) ?? [];
          return { ...p, capability: caps[0] ?? "text" };
        });
      }
      return state;
    },
  }
)
```

The current store has no explicit `version`, so Zustand treats existing data as version 0. The `fromVersion < 2` condition covers 0→2 and any future 1→2 cases.

No changes to `defaultTextModel`, `defaultImageModel`, `defaultVideoModel`, `ModelRef`, `ModelConfig`, or `getModelConfig()`.

---

## 2. Settings Page UI Redesign

### Layout

Replace the single flat provider list with three independent sections, each managing its own provider list:

```
┌──────────────────────────────────────────────────┐
│  [Type icon] Language Models         [+ Add]     │
│  [ProviderCard] [ProviderCard] ...               │
│  [ProviderForm for selected provider]            │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  [ImageIcon] Image Models            [+ Add]     │
│  [ProviderCard] [ProviderCard] ...               │
│  [ProviderForm for selected provider]            │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  [VideoIcon] Video Models            [+ Add]     │
│  [ProviderCard] [ProviderCard] ...               │
│  [ProviderForm for selected provider]            │
└──────────────────────────────────────────────────┘
```

Use existing Lucide icons: `Type` for language, `ImageIcon` for image, `VideoIcon` for video (already imported in `DefaultModelPicker`).

### `DefaultModelPicker` changes

**Must be updated** — currently uses `p.capabilities.includes(capability)` which will throw after the type change. Update the `getOptions` function:

```ts
// Before
if (!p.capabilities.includes(capability as "text" | "image" | "video")) continue;

// After
if (p.capability !== capability) continue;
```

### `settings/page.tsx`

- Remove the existing single `selectedId` state, `handleAdd`, and `handleDelete`.
- Replace with three `ProviderSection` instances, each managing its own state.
- The existing `addProvider({ ..., capabilities: ["text", "image"], ... })` call is a TypeScript compile error after the type change — it is replaced by each `ProviderSection`'s internal `handleAdd`.

### `ProviderSection` component — `src/components/settings/provider-section.tsx`

New component. Props interface:
```ts
interface ProviderSectionProps {
  capability: Capability;
  label: string;           // i18n translated label
  icon: React.ReactNode;
  defaultProtocol: Protocol;
  defaultBaseUrl: string;  // pre-filled when adding a new provider
}
```

Default values per section:

| capability | defaultProtocol | defaultBaseUrl |
|------------|-----------------|----------------|
| `"text"`   | `"openai"`      | `"https://api.openai.com"` |
| `"image"`  | `"kling"`       | `"https://api.klingai.com"` |
| `"video"`  | `"kling"`       | `"https://api.klingai.com"` |

The component's internal `handleAdd` calls:
```ts
addProvider({
  name: "New Provider",
  protocol: defaultProtocol,
  capability: capability,       // singular
  baseUrl: defaultBaseUrl,
  apiKey: "",
});
```

The component renders:
- Section header (icon + label + "Add" button)
- Provider card list (horizontal scroll, filtered by `p.capability === capability`)
- `ProviderForm` for the selected card
- Empty state (dashed border, `t("noProviders")` text, "Add" button) — reuses existing `settings.noProviders` i18n key

### `ProviderForm` changes

- **Delete** the entire capability checkbox `<div>` and the `handleCapabilityToggle` function — both reference the deleted `capabilities[]` field and would cause a compile error.
- **Delete** the `PROTOCOL_OPTIONS` constant. Replace with a capability-aware helper at the top of the file:

```ts
function getProtocolOptions(capability: Capability): { value: Protocol; label: string }[] {
  if (capability === "text") return [
    { value: "openai", label: "OpenAI" },
    { value: "gemini", label: "Gemini" },
  ];
  if (capability === "image") return [
    { value: "openai", label: "OpenAI" },
    { value: "gemini", label: "Gemini" },
    { value: "kling", label: "Kling" },
  ];
  // video
  return [
    { value: "seedance", label: "Seedance" },
    { value: "gemini", label: "Gemini (Veo)" },
    { value: "kling", label: "Kling" },
  ];
}
```

Derive `capability` from `provider.capability` directly — no new prop is needed. Use `getProtocolOptions(provider.capability)` in the render.

No other changes to the form.

### i18n changes (all 4 locales: zh, en, ja, ko)

**Add** 3 new keys:

| Key | en | zh |
|-----|----|----|
| `settings.languageModels` | Language Models | 语言模型 |
| `settings.imageModels` | Image Models | 图片模型 |
| `settings.videoModels` | Video Models | 视频模型 |

**Remove** the now-unused key `settings.capabilities` from all 4 locale files (was used only in the removed capability checkbox section of `ProviderForm`).

The existing `settings.noProviders` key is reused by `ProviderSection`'s empty state for all three sections.

---

## 3. Kling AI Provider Implementation

### Authentication

All Kling API requests use:
```
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Base URL: `https://api.klingai.com` (configurable via `baseUrl` constructor param; default to `"https://api.klingai.com"` if empty).

### Kling API response envelope

All Kling API responses share this envelope:
```ts
interface KlingResponse<T> {
  code: number;       // 0 = success, non-zero = error
  message: string;    // error message when code !== 0
  data: T;
}
```

**Error check**: After any HTTP request, if HTTP status is non-200 **or** `response.code !== 0`, throw `new Error(response.message || statusText)`.

**Polling response `data` shape**:
```ts
interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg: string;
  task_result: {
    images?: { url: string }[];  // image provider only
    videos?: { url: string }[];  // video provider only
  };
}
```

**Polling logic** (shared for both providers):
1. If HTTP non-200: throw `new Error(\`Kling API error: \${response.status}\`)`.
2. Parse as `KlingResponse<KlingTaskData>`.
3. If `code !== 0`: throw `new Error(message)`.
4. If `task_status === "succeed"`: extract result URL.
5. If `task_status === "failed"`: throw `new Error(task_status_msg)`.
6. Otherwise (`"submitted"` or `"processing"`): wait 5 seconds and retry.

Note: unlike Seedance (which uses `continue` on non-200), Kling throws immediately on non-200. This is intentional — consistent with VeoProvider's behavior. Transient 5xx errors are not silently retried.

### 3a. Image Provider — `src/lib/ai/providers/kling-image.ts`

```ts
export class KlingImageProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
    this.apiKey = params?.apiKey || process.env.KLING_API_KEY || "";
    this.baseUrl = (params?.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    this.model = params?.model || "kling-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  generateText(): Promise<string> {
    throw new Error("Kling does not support text generation");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    // POST /v1/images/generations
    // poll /v1/images/generations/{task_id}
    // download to uploads/images/<ulid>.<ext>
    // return local path
  }
}
```

**Submit**: `POST /v1/images/generations`
```json
{ "model": "<modelId>", "prompt": "<prompt>", "n": 1, "aspect_ratio": "16:9" }
```

**Poll**: `GET /v1/images/generations/{task_id}` every 5s, max 60 attempts (5 min).

**Success**: download `data.task_result.images[0].url` → `<uploadDir>/images/<ulid>.png`, return local path.

Known models: `kling-v1`, `kling-v1-5`, `kling-v2`, `kling-v2-new`, `kling-v2-1`

### 3b. Video Provider — `src/lib/ai/providers/kling-video.ts`

```ts
export class KlingVideoProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
    this.apiKey = params?.apiKey || process.env.KLING_API_KEY || "";
    this.baseUrl = (params?.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    this.model = params?.model || "kling-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<string> {
    // POST /v1/videos/image2video
    // poll /v1/videos/image2video/{task_id}
    // download .mp4 to uploads/videos/<ulid>.mp4
    // return local path
  }
}
```

**Submit**: `POST /v1/videos/image2video`
```json
{
  "model": "<modelId>",
  "prompt": "<prompt>",
  "image": "<firstFrame as data URI>",
  "tail_image": "<lastFrame as data URI>",
  "duration": 5,
  "aspect_ratio": "16:9"
}
```

Image encoding: `data:<mime>;base64,<base64>` — same pattern as Seedance's `toDataUrl` helper (can extract to shared util or duplicate inline).

Duration: clamp to nearest valid value (5 or 10).
Aspect ratio: use `params.ratio` if provided, default `"16:9"`.

**Poll**: `GET /v1/videos/image2video/{task_id}` every 5s, max 120 attempts (10 min).

**Success**: download `data.task_result.videos[0].url` → `<uploadDir>/videos/<ulid>.mp4`, return local path.

Known models: `kling-v1`, `kling-v1-6`, `kling-v2-master`, `kling-v2-1-master`, `kling-v2-5-turbo`

### 3c. `provider-factory.ts` changes

```ts
// createAIProvider — add kling case
case "kling":
  return new KlingImageProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.modelId });

// createVideoProvider — add kling case
case "kling":
  return new KlingVideoProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.modelId });
```

### 3d. `/api/models/list` route changes

1. Add `protocol?: string` to the `ListRequest` interface (or inline type) if not already present.
2. Place the Kling short-circuit **before** the `baseUrl`/`apiKey` validation block:

```ts
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

This union list covers both image and video models. The user selects the appropriate model for their use case. This is intentional — the route has no concept of sub-capability, and we do not add one.

---

## 4. Error Handling & Edge Cases

- **Kling API error**: throw `new Error(message)` on `code !== 0` or non-200 HTTP.
- **Image file encoding**: `data:<mime>;base64,<base64>` — consistent with Seedance pattern.
- **Polling timeout**: Image 5 min (60 × 5s), Video 10 min (120 × 5s).
- **`generateText` on KlingImageProvider**: throw `new Error("Kling does not support text generation")`.
- **`ProviderCard`**: no changes needed — renders only `provider.protocol`, `provider.name`, and model counts.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `src/stores/model-store.ts` | `capabilities[]` → `capability` (single), add `"kling"` protocol, Zustand `version: 2` + `migrate` |
| `src/components/settings/default-model-picker.tsx` | `p.capabilities.includes()` → `p.capability ===` in `getOptions` |
| `src/app/[locale]/settings/page.tsx` | Replace with three `ProviderSection` instances; remove old single-provider state |
| `src/components/settings/provider-section.tsx` | New — `ProviderSection` component |
| `src/components/settings/provider-form.tsx` | Remove capability checkboxes + `handleCapabilityToggle`; replace `PROTOCOL_OPTIONS` with `getProtocolOptions(provider.capability)` |
| `src/lib/ai/providers/kling-image.ts` | New — `KlingImageProvider` |
| `src/lib/ai/providers/kling-video.ts` | New — `KlingVideoProvider` |
| `src/lib/ai/provider-factory.ts` | Add `"kling"` cases to both factory functions |
| `src/app/api/models/list/route.ts` | Add `protocol?: string` to request type; add `kling` static model list before validation |
| `messages/zh.json`, `en.json`, `ja.json`, `ko.json` | Add 3 keys (`languageModels`, `imageModels`, `videoModels`); remove dead `capabilities` key |

---

## 6. Out of Scope

- Kling text generation (not supported by Kling API)
- Kling image-to-image / outpainting / omni features
- Kling video extension or multi-image-to-video
- Any changes to pipeline logic beyond `provider-factory.ts`
