# Model Settings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings page where users can configure multiple AI model providers (text/image/video), fetch model lists via API, and select default models — all stored in localStorage.

**Architecture:** Zustand store with `persist` middleware stores provider configs and model selections in localStorage. A new `/api/models/list` endpoint proxies model list requests to providers. Pipeline handlers receive model config from the frontend via task payload and dynamically instantiate providers instead of reading `.env`.

**Tech Stack:** Next.js 16, React 19, Zustand 5 (persist), Tailwind CSS 4, @base-ui/react, next-intl, OpenAI SDK, Google GenAI SDK

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/stores/model-store.ts` | Zustand store with localStorage persist for providers & default model selections |
| Create | `src/app/[locale]/settings/page.tsx` | Settings page (client component) |
| Create | `src/components/settings/provider-card.tsx` | Provider card in the sidebar list |
| Create | `src/components/settings/provider-form.tsx` | Provider edit form (name, protocol, URL, key, models) |
| Create | `src/components/settings/default-model-picker.tsx` | Default model dropdowns for text/image/video |
| Create | `src/app/api/models/list/route.ts` | API endpoint to proxy model list fetches |
| Create | `src/lib/ai/provider-factory.ts` | Factory to create provider instances from config |
| Modify | `src/app/[locale]/(dashboard)/layout.tsx` | Add settings gear icon to header |
| Modify | `src/lib/pipeline/script-parse.ts` | Read model config from task payload |
| Modify | `src/lib/pipeline/character-extract.ts` | Read model config from task payload |
| Modify | `src/lib/pipeline/character-image.ts` | Read model config from task payload |
| Modify | `src/lib/pipeline/shot-split.ts` | Read model config from task payload |
| Modify | `src/lib/pipeline/frame-generate.ts` | Read model config from task payload |
| Modify | `src/lib/pipeline/video-generate.ts` | Read model config from task payload |
| Modify | `src/app/api/projects/[id]/generate/route.ts` | Accept modelConfig in request body |
| Modify | `src/components/editor/script-editor.tsx` | Send modelConfig from store |
| Modify | `src/components/editor/character-card.tsx` | Send modelConfig from store |
| Modify | `src/components/editor/shot-card.tsx` | Send modelConfig from store |
| Modify | `messages/zh.json` | Add settings translations |
| Modify | `messages/en.json` | Add settings translations |
| Modify | `messages/ja.json` | Add settings translations |
| Modify | `messages/ko.json` | Add settings translations |

---

## Chunk 1: Model Store & Provider Factory

### Task 1: Create Model Store

**Files:**
- Create: `src/stores/model-store.ts`

- [ ] **Step 1: Create the Zustand store with persist middleware**

```typescript
// src/stores/model-store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ulid } from "ulid";

export type Protocol = "openai" | "gemini" | "seedance";
export type Capability = "text" | "image" | "video";

export interface Model {
  id: string;
  name: string;
  checked: boolean;
}

export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  capabilities: Capability[];
  baseUrl: string;
  apiKey: string;
  models: Model[];
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ModelConfig {
  text: { protocol: Protocol; baseUrl: string; apiKey: string; modelId: string } | null;
  image: { protocol: Protocol; baseUrl: string; apiKey: string; modelId: string } | null;
  video: { protocol: Protocol; baseUrl: string; apiKey: string; modelId: string } | null;
}

interface ModelStore {
  providers: Provider[];
  defaultTextModel: ModelRef | null;
  defaultImageModel: ModelRef | null;
  defaultVideoModel: ModelRef | null;

  addProvider: (provider: Omit<Provider, "id" | "models">) => string;
  updateProvider: (id: string, updates: Partial<Omit<Provider, "id">>) => void;
  removeProvider: (id: string) => void;
  setModels: (providerId: string, models: Model[]) => void;
  toggleModel: (providerId: string, modelId: string) => void;
  addManualModel: (providerId: string, modelId: string) => void;
  setDefaultTextModel: (ref: ModelRef | null) => void;
  setDefaultImageModel: (ref: ModelRef | null) => void;
  setDefaultVideoModel: (ref: ModelRef | null) => void;
  getModelConfig: () => ModelConfig;
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set, get) => ({
      providers: [],
      defaultTextModel: null,
      defaultImageModel: null,
      defaultVideoModel: null,

      addProvider: (provider) => {
        const id = ulid();
        set((state) => ({
          providers: [...state.providers, { ...provider, id, models: [] }],
        }));
        return id;
      },

      updateProvider: (id, updates) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
      },

      removeProvider: (id) => {
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
          defaultTextModel:
            state.defaultTextModel?.providerId === id ? null : state.defaultTextModel,
          defaultImageModel:
            state.defaultImageModel?.providerId === id ? null : state.defaultImageModel,
          defaultVideoModel:
            state.defaultVideoModel?.providerId === id ? null : state.defaultVideoModel,
        }));
      },

      setModels: (providerId, models) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId ? { ...p, models } : p
          ),
        }));
      },

      toggleModel: (providerId, modelId) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: p.models.map((m) =>
                    m.id === modelId ? { ...m, checked: !m.checked } : m
                  ),
                }
              : p
          ),
        }));
      },

      addManualModel: (providerId, modelId) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: [
                    ...p.models,
                    { id: modelId, name: modelId, checked: true },
                  ],
                }
              : p
          ),
        }));
      },

      setDefaultTextModel: (ref) => set({ defaultTextModel: ref }),
      setDefaultImageModel: (ref) => set({ defaultImageModel: ref }),
      setDefaultVideoModel: (ref) => set({ defaultVideoModel: ref }),

      getModelConfig: () => {
        const state = get();
        function resolve(ref: ModelRef | null) {
          if (!ref) return null;
          const provider = state.providers.find((p) => p.id === ref.providerId);
          if (!provider) return null;
          return {
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            modelId: ref.modelId,
          };
        }
        return {
          text: resolve(state.defaultTextModel),
          image: resolve(state.defaultImageModel),
          video: resolve(state.defaultVideoModel),
        };
      },
    }),
    { name: "model-store" }
  )
);
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/stores/model-store.ts 2>&1 | head -20`

---

### Task 2: Create Provider Factory

**Files:**
- Create: `src/lib/ai/provider-factory.ts`

- [ ] **Step 1: Create factory that instantiates providers from config**

```typescript
// src/lib/ai/provider-factory.ts
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import type { AIProvider, VideoProvider } from "./types";

interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export function createAIProvider(config: ProviderConfig): AIProvider {
  switch (config.protocol) {
    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        model: config.modelId,
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.apiKey,
        model: config.modelId,
      });
    default:
      throw new Error(`Unsupported AI protocol: ${config.protocol}`);
  }
}

export function createVideoProvider(config: ProviderConfig): VideoProvider {
  switch (config.protocol) {
    case "seedance":
      return new SeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/model-store.ts src/lib/ai/provider-factory.ts
git commit -m "feat: add model store with localStorage persist and provider factory"
```

---

## Chunk 2: Models List API

### Task 3: Create `/api/models/list` endpoint

**Files:**
- Create: `src/app/api/models/list/route.ts`

- [ ] **Step 1: Implement the proxy endpoint**

```typescript
// src/app/api/models/list/route.ts
import { NextResponse } from "next/server";

interface ListRequest {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}

interface ModelItem {
  id: string;
  name: string;
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<ModelItem[]> {
  const url = baseUrl.replace(/\/+$/, "") + "/v1/models";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data: { id: string }[] };
  return data.data.map((m) => ({ id: m.id, name: m.id }));
}

async function fetchGeminiModels(apiKey: string): Promise<ModelItem[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    models: { name: string; displayName: string }[];
  };
  return data.models.map((m) => ({
    id: m.name.replace("models/", ""),
    name: m.displayName || m.name,
  }));
}

function getSeedanceModels(): ModelItem[] {
  return [
    { id: "seedance-1-lite", name: "Seedance 1 Lite" },
    { id: "seedance-1", name: "Seedance 1" },
  ];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ListRequest;
    let models: ModelItem[];

    switch (body.protocol) {
      case "openai":
        models = await fetchOpenAIModels(body.baseUrl, body.apiKey);
        break;
      case "gemini":
        models = await fetchGeminiModels(body.apiKey);
        break;
      case "seedance":
        models = getSeedanceModels();
        break;
      default:
        return NextResponse.json(
          { error: `Unknown protocol: ${body.protocol}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/models/list/route.ts
git commit -m "feat: add /api/models/list proxy endpoint"
```

---

## Chunk 3: Settings UI Components

### Task 4: Create Provider Card component

**Files:**
- Create: `src/components/settings/provider-card.tsx`

- [ ] **Step 1: Create the provider card**

Provider card displays in the left sidebar list. Shows provider name, protocol badge, and delete button.

```typescript
// src/components/settings/provider-card.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import type { Provider } from "@/stores/model-store";

interface ProviderCardProps {
  provider: Provider;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function ProviderCard({ provider, selected, onSelect, onDelete }: ProviderCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200 ${
        selected
          ? "border-primary/30 bg-primary/5 shadow-sm"
          : "border-[--border-subtle] bg-white hover:border-[--border-hover] hover:shadow-sm"
      }`}
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/8 font-display text-sm font-bold text-primary">
        {provider.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[--text-primary]">{provider.name}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {provider.protocol}
          </Badge>
          <span className="text-[10px] text-[--text-muted]">
            {provider.models.filter((m) => m.checked).length} models
          </span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </button>
  );
}
```

---

### Task 5: Create Provider Form component

**Files:**
- Create: `src/components/settings/provider-form.tsx`

- [ ] **Step 1: Create the provider edit form**

The form shows name, protocol selector, base URL, API key, fetch models button, model checkbox list, and manual model input.

```typescript
// src/components/settings/provider-form.tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useModelStore, type Provider, type Protocol, type Capability } from "@/stores/model-store";
import { useTranslations } from "next-intl";
import { Loader2, Download, Plus, Eye, EyeOff } from "lucide-react";

const PROTOCOL_OPTIONS: { value: Protocol; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "seedance", label: "Seedance" },
];

const CAPABILITY_OPTIONS: { value: Capability; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];

interface ProviderFormProps {
  provider: Provider;
}

export function ProviderForm({ provider }: ProviderFormProps) {
  const t = useTranslations("settings");
  const { updateProvider, setModels, toggleModel, addManualModel } = useModelStore();
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualModelId, setManualModelId] = useState("");
  const [showKey, setShowKey] = useState(false);

  async function handleFetchModels() {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/models/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data.error || "Failed to fetch models");
        return;
      }
      const models = data.models.map((m: { id: string; name: string }) => ({
        id: m.id,
        name: m.name,
        checked: false,
      }));
      setModels(provider.id, models);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Network error");
    } finally {
      setFetching(false);
    }
  }

  function handleAddManualModel() {
    const id = manualModelId.trim();
    if (!id) return;
    addManualModel(provider.id, id);
    setManualModelId("");
  }

  function handleCapabilityToggle(cap: Capability) {
    const caps = provider.capabilities.includes(cap)
      ? provider.capabilities.filter((c) => c !== cap)
      : [...provider.capabilities, cap];
    updateProvider(provider.id, { capabilities: caps });
  }

  return (
    <div className="space-y-6">
      {/* Name */}
      <div className="space-y-2">
        <Label>{t("providerName")}</Label>
        <Input
          value={provider.name}
          onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
          placeholder="e.g. DeepSeek, OpenRouter..."
        />
      </div>

      {/* Protocol */}
      <div className="space-y-2">
        <Label>{t("protocol")}</Label>
        <div className="flex gap-2">
          {PROTOCOL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateProvider(provider.id, { protocol: opt.value })}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
                provider.protocol === opt.value
                  ? "border-primary/30 bg-primary/8 text-primary font-medium"
                  : "border-[--border-subtle] text-[--text-secondary] hover:border-[--border-hover]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div className="space-y-2">
        <Label>{t("capabilities")}</Label>
        <div className="flex gap-2">
          {CAPABILITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleCapabilityToggle(opt.value)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
                provider.capabilities.includes(opt.value)
                  ? "border-primary/30 bg-primary/8 text-primary font-medium"
                  : "border-[--border-subtle] text-[--text-secondary] hover:border-[--border-hover]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Base URL */}
      <div className="space-y-2">
        <Label>Base URL</Label>
        <Input
          value={provider.baseUrl}
          onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
          placeholder="https://api.openai.com"
        />
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <Label>API Key</Label>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={provider.apiKey}
            onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
            placeholder="sk-..."
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Fetch Models */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>{t("models")}</Label>
          <Button
            size="sm"
            variant="outline"
            onClick={handleFetchModels}
            disabled={fetching || !provider.apiKey}
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {t("fetchModels")}
          </Button>
        </div>

        {fetchError && (
          <p className="text-xs text-destructive">{fetchError}</p>
        )}

        {/* Model checkbox list */}
        {provider.models.length > 0 && (
          <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-[--border-subtle] p-2">
            {provider.models.map((model) => (
              <label
                key={model.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[--surface]"
              >
                <input
                  type="checkbox"
                  checked={model.checked}
                  onChange={() => toggleModel(provider.id, model.id)}
                  className="h-3.5 w-3.5 rounded border-[--border-subtle] text-primary accent-primary"
                />
                <span className="text-sm text-[--text-primary]">{model.name}</span>
                {model.name !== model.id && (
                  <span className="text-xs text-[--text-muted]">{model.id}</span>
                )}
              </label>
            ))}
          </div>
        )}

        {/* Manual model input */}
        <div className="flex gap-2">
          <Input
            value={manualModelId}
            onChange={(e) => setManualModelId(e.target.value)}
            placeholder={t("manualModelPlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && handleAddManualModel()}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddManualModel}
            disabled={!manualModelId.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 6: Create Default Model Picker component

**Files:**
- Create: `src/components/settings/default-model-picker.tsx`

- [ ] **Step 1: Create the default model picker**

Shows three dropdowns (text, image, video) that let users select from checked models.

```typescript
// src/components/settings/default-model-picker.tsx
"use client";

import { Label } from "@/components/ui/label";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { useTranslations } from "next-intl";
import { Type, ImageIcon, VideoIcon } from "lucide-react";

interface PickerRowProps {
  label: string;
  icon: React.ReactNode;
  options: { providerId: string; providerName: string; modelId: string; modelName: string }[];
  value: ModelRef | null;
  onChange: (ref: ModelRef | null) => void;
}

function PickerRow({ label, icon, options, value, onChange }: PickerRowProps) {
  const currentValue = value ? `${value.providerId}:${value.modelId}` : "";

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <Label className="text-xs text-[--text-muted]">{label}</Label>
        <select
          value={currentValue}
          onChange={(e) => {
            if (!e.target.value) {
              onChange(null);
              return;
            }
            const [providerId, modelId] = e.target.value.split(":");
            onChange({ providerId, modelId });
          }}
          className="mt-1 block w-full rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-sm text-[--text-primary] outline-none transition-all hover:border-[--border-hover] focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
        >
          <option value="">--</option>
          {options.map((opt) => (
            <option key={`${opt.providerId}:${opt.modelId}`} value={`${opt.providerId}:${opt.modelId}`}>
              {opt.providerName} / {opt.modelName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function DefaultModelPicker() {
  const t = useTranslations("settings");
  const {
    providers,
    defaultTextModel,
    defaultImageModel,
    defaultVideoModel,
    setDefaultTextModel,
    setDefaultImageModel,
    setDefaultVideoModel,
  } = useModelStore();

  function getOptions(capability: string) {
    const result: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    for (const p of providers) {
      if (!p.capabilities.includes(capability as "text" | "image" | "video")) continue;
      for (const m of p.models) {
        if (!m.checked) continue;
        result.push({
          providerId: p.id,
          providerName: p.name,
          modelId: m.id,
          modelName: m.name,
        });
      }
    }
    return result;
  }

  return (
    <div className="space-y-4">
      <PickerRow
        label={t("defaultTextModel")}
        icon={<Type className="h-4 w-4" />}
        options={getOptions("text")}
        value={defaultTextModel}
        onChange={setDefaultTextModel}
      />
      <PickerRow
        label={t("defaultImageModel")}
        icon={<ImageIcon className="h-4 w-4" />}
        options={getOptions("image")}
        value={defaultImageModel}
        onChange={setDefaultImageModel}
      />
      <PickerRow
        label={t("defaultVideoModel")}
        icon={<VideoIcon className="h-4 w-4" />}
        options={getOptions("video")}
        value={defaultVideoModel}
        onChange={setDefaultVideoModel}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/
git commit -m "feat: add settings UI components (provider card, form, model picker)"
```

---

## Chunk 4: Settings Page & Navigation

### Task 7: Create Settings Page

**Files:**
- Create: `src/app/[locale]/settings/page.tsx`

- [ ] **Step 1: Create the settings page**

```typescript
// src/app/[locale]/settings/page.tsx
"use client";

import { useState } from "react";
import { useModelStore } from "@/stores/model-store";
import { ProviderCard } from "@/components/settings/provider-card";
import { ProviderForm } from "@/components/settings/provider-form";
import { DefaultModelPicker } from "@/components/settings/default-model-picker";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Settings, Cpu } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const { providers, addProvider, removeProvider } = useModelStore();
  const [selectedId, setSelectedId] = useState<string | null>(
    providers.length > 0 ? providers[0].id : null
  );

  const selectedProvider = providers.find((p) => p.id === selectedId) || null;

  function handleAdd() {
    const id = addProvider({
      name: "New Provider",
      protocol: "openai",
      capabilities: ["text", "image"],
      baseUrl: "https://api.openai.com",
      apiKey: "",
    });
    setSelectedId(id);
  }

  function handleDelete(id: string) {
    removeProvider(id);
    if (selectedId === id) {
      setSelectedId(providers.length > 1 ? providers.find((p) => p.id !== id)?.id || null : null);
    }
  }

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

      <main className="flex-1 bg-[--surface] p-6 lg:p-8">
        <div className="mx-auto max-w-5xl animate-page-in space-y-6">
          {/* Provider management */}
          <div className="flex flex-col gap-6 lg:flex-row">
            {/* Left: Provider list */}
            <div className="w-full space-y-3 lg:w-72 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
                  {t("providers")}
                </h3>
                <Button size="sm" variant="outline" onClick={handleAdd}>
                  <Plus className="h-3.5 w-3.5" />
                  {tc("create")}
                </Button>
              </div>
              <div className="space-y-2">
                {providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    selected={p.id === selectedId}
                    onSelect={() => setSelectedId(p.id)}
                    onDelete={() => handleDelete(p.id)}
                  />
                ))}
                {providers.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 py-12">
                    <Cpu className="h-8 w-8 text-[--text-muted]" />
                    <p className="mt-3 text-sm text-[--text-muted]">{t("noProviders")}</p>
                    <Button size="sm" className="mt-4" onClick={handleAdd}>
                      <Plus className="h-3.5 w-3.5" />
                      {t("addProvider")}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Provider form */}
            <div className="flex-1">
              {selectedProvider ? (
                <div className="rounded-2xl border border-[--border-subtle] bg-white p-6">
                  <ProviderForm provider={selectedProvider} />
                </div>
              ) : providers.length > 0 ? (
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 py-24">
                  <p className="text-sm text-[--text-muted]">{t("selectProvider")}</p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Default model selection */}
          <div className="rounded-2xl border border-[--border-subtle] bg-white p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
              <Cpu className="h-3.5 w-3.5" />
              {t("defaultModels")}
            </h3>
            <DefaultModelPicker />
          </div>
        </div>
      </main>
    </div>
  );
}
```

---

### Task 8: Add Settings gear icon to Dashboard header

**Files:**
- Modify: `src/app/[locale]/(dashboard)/layout.tsx`

- [ ] **Step 1: Add gear icon link next to LanguageSwitcher**

In `src/app/[locale]/(dashboard)/layout.tsx`, add a settings link icon before the LanguageSwitcher:

```diff
 import { getTranslations } from "next-intl/server";
 import { LanguageSwitcher } from "@/components/language-switcher";
 import { LogoIcon } from "@/components/logo";
 import Link from "next/link";
+import { Settings } from "lucide-react";

 ...

-        <LanguageSwitcher />
+        <div className="flex items-center gap-2">
+          <Link
+            href="/settings"
+            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
+          >
+            <Settings className="h-4 w-4" />
+          </Link>
+          <LanguageSwitcher />
+        </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/settings/page.tsx src/app/[locale]/(dashboard)/layout.tsx
git commit -m "feat: add settings page and gear icon in dashboard header"
```

---

## Chunk 5: i18n Translations

### Task 9: Add settings translations to all locales

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `messages/ja.json`
- Modify: `messages/ko.json`

- [ ] **Step 1: Add settings key to zh.json**

Add at the end of the JSON (before the last `}`):

```json
"settings": {
  "title": "模型设置",
  "providers": "供应商",
  "addProvider": "添加供应商",
  "noProviders": "还没有供应商，添加一个开始配置",
  "selectProvider": "选择左侧供应商进行配置",
  "providerName": "供应商名称",
  "protocol": "协议",
  "capabilities": "能力",
  "models": "模型列表",
  "fetchModels": "获取模型",
  "manualModelPlaceholder": "手动输入 model_id...",
  "defaultModels": "默认模型",
  "defaultTextModel": "文本模型",
  "defaultImageModel": "图像模型",
  "defaultVideoModel": "视频模型"
}
```

- [ ] **Step 2: Add settings key to en.json**

```json
"settings": {
  "title": "Model Settings",
  "providers": "Providers",
  "addProvider": "Add Provider",
  "noProviders": "No providers yet. Add one to get started.",
  "selectProvider": "Select a provider to configure",
  "providerName": "Provider Name",
  "protocol": "Protocol",
  "capabilities": "Capabilities",
  "models": "Models",
  "fetchModels": "Fetch Models",
  "manualModelPlaceholder": "Enter model_id manually...",
  "defaultModels": "Default Models",
  "defaultTextModel": "Text Model",
  "defaultImageModel": "Image Model",
  "defaultVideoModel": "Video Model"
}
```

- [ ] **Step 3: Add settings key to ja.json**

```json
"settings": {
  "title": "モデル設定",
  "providers": "プロバイダー",
  "addProvider": "プロバイダーを追加",
  "noProviders": "プロバイダーがありません。追加して設定を始めましょう",
  "selectProvider": "左のプロバイダーを選択して設定",
  "providerName": "プロバイダー名",
  "protocol": "プロトコル",
  "capabilities": "機能",
  "models": "モデル一覧",
  "fetchModels": "モデルを取得",
  "manualModelPlaceholder": "model_id を手動入力...",
  "defaultModels": "デフォルトモデル",
  "defaultTextModel": "テキストモデル",
  "defaultImageModel": "画像モデル",
  "defaultVideoModel": "動画モデル"
}
```

- [ ] **Step 4: Add settings key to ko.json**

```json
"settings": {
  "title": "모델 설정",
  "providers": "제공자",
  "addProvider": "제공자 추가",
  "noProviders": "제공자가 없습니다. 하나를 추가하여 시작하세요.",
  "selectProvider": "왼쪽에서 제공자를 선택하여 설정",
  "providerName": "제공자 이름",
  "protocol": "프로토콜",
  "capabilities": "기능",
  "models": "모델 목록",
  "fetchModels": "모델 가져오기",
  "manualModelPlaceholder": "model_id를 수동 입력...",
  "defaultModels": "기본 모델",
  "defaultTextModel": "텍스트 모델",
  "defaultImageModel": "이미지 모델",
  "defaultVideoModel": "동영상 모델"
}
```

- [ ] **Step 5: Commit**

```bash
git add messages/
git commit -m "feat: add settings i18n translations for all 4 locales"
```

---

## Chunk 6: Pipeline Refactor — Dynamic Provider from Payload

### Task 10: Refactor pipeline handlers to use dynamic providers

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`
- Modify: `src/lib/pipeline/script-parse.ts`
- Modify: `src/lib/pipeline/character-extract.ts`
- Modify: `src/lib/pipeline/character-image.ts`
- Modify: `src/lib/pipeline/shot-split.ts`
- Modify: `src/lib/pipeline/frame-generate.ts`
- Modify: `src/lib/pipeline/video-generate.ts`

- [ ] **Step 1: Update generate route to accept and pass modelConfig**

In `src/app/api/projects/[id]/generate/route.ts`, add `modelConfig` to the request body and pass it through the task payload:

```typescript
// src/app/api/projects/[id]/generate/route.ts
import { NextResponse } from "next/server";
import { enqueueTask } from "@/lib/task-queue";
import type { TaskType } from "@/lib/task-queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const body = (await request.json()) as {
    action: NonNullable<TaskType>;
    payload?: Record<string, unknown>;
    modelConfig?: {
      text?: { protocol: string; baseUrl: string; apiKey: string; modelId: string } | null;
      image?: { protocol: string; baseUrl: string; apiKey: string; modelId: string } | null;
      video?: { protocol: string; baseUrl: string; apiKey: string; modelId: string } | null;
    };
  };

  const task = await enqueueTask({
    type: body.action,
    projectId,
    payload: { projectId, ...body.payload, modelConfig: body.modelConfig },
  });

  return NextResponse.json(task, { status: 201 });
}
```

- [ ] **Step 2: Create a helper to resolve providers from payload**

Add a helper in `src/lib/ai/provider-factory.ts`:

```typescript
// Append to src/lib/ai/provider-factory.ts

import { getAIProvider, getVideoProvider } from "./index";

interface ModelConfigPayload {
  text?: { protocol: string; baseUrl: string; apiKey: string; modelId: string } | null;
  image?: { protocol: string; baseUrl: string; apiKey: string; modelId: string } | null;
  video?: { protocol: string; baseUrl: string; apiKey: string; modelId: string } | null;
}

export function resolveAIProvider(modelConfig?: ModelConfigPayload): AIProvider {
  if (modelConfig?.text) {
    return createAIProvider(modelConfig.text);
  }
  // Fallback to env-configured provider
  return getAIProvider();
}

export function resolveImageProvider(modelConfig?: ModelConfigPayload): AIProvider {
  if (modelConfig?.image) {
    return createAIProvider(modelConfig.image);
  }
  return getAIProvider();
}

export function resolveVideoProvider(modelConfig?: ModelConfigPayload): VideoProvider {
  if (modelConfig?.video) {
    return createVideoProvider(modelConfig.video);
  }
  return getVideoProvider();
}
```

- [ ] **Step 3: Update script-parse.ts**

Replace `getAIProvider()` with `resolveAIProvider(payload.modelConfig)`:

```diff
-import { getAIProvider } from "@/lib/ai";
+import { resolveAIProvider } from "@/lib/ai/provider-factory";

-  const ai = getAIProvider();
+  const ai = resolveAIProvider(payload.modelConfig);
```

Also update the payload type:

```diff
-  const payload = task.payload as { projectId: string };
+  const payload = task.payload as { projectId: string; modelConfig?: any };
```

And pass modelConfig when auto-enqueuing the next task:

```diff
   await enqueueTask({
     type: "character_extract",
     projectId: payload.projectId,
     payload: {
       projectId: payload.projectId,
       screenplay: result,
+      modelConfig: payload.modelConfig,
     },
   });
```

- [ ] **Step 4: Update character-extract.ts**

Same pattern — replace `getAIProvider()` with `resolveAIProvider(payload.modelConfig)`.

- [ ] **Step 5: Update character-image.ts**

Replace `getAIProvider()` with `resolveImageProvider(payload.modelConfig)`:

```diff
-import { getAIProvider } from "@/lib/ai";
+import { resolveImageProvider } from "@/lib/ai/provider-factory";

-  const ai = getAIProvider();
+  const ai = resolveImageProvider(payload.modelConfig);
```

- [ ] **Step 6: Update shot-split.ts**

Same pattern as script-parse — use `resolveAIProvider`.

- [ ] **Step 7: Update frame-generate.ts**

Replace `getAIProvider()` with `resolveImageProvider(payload.modelConfig)`:

```diff
-import { getAIProvider } from "@/lib/ai";
+import { resolveImageProvider } from "@/lib/ai/provider-factory";

-  const ai = getAIProvider();
+  const ai = resolveImageProvider(payload.modelConfig);
```

- [ ] **Step 8: Update video-generate.ts**

Replace `getVideoProvider()` with `resolveVideoProvider(payload.modelConfig)`:

```diff
-import { getVideoProvider } from "@/lib/ai";
+import { resolveVideoProvider } from "@/lib/ai/provider-factory";

-  const videoProvider = getVideoProvider();
+  const videoProvider = resolveVideoProvider(payload.modelConfig);
```

- [ ] **Step 9: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts src/lib/ai/provider-factory.ts src/lib/pipeline/
git commit -m "feat: refactor pipeline to use dynamic provider from payload modelConfig"
```

---

## Chunk 7: Frontend — Send modelConfig with generate requests

### Task 11: Update editor components to send modelConfig

**Files:**
- Modify: `src/components/editor/script-editor.tsx`
- Modify: `src/components/editor/character-card.tsx`
- Modify: `src/components/editor/shot-card.tsx`

- [ ] **Step 1: Update script-editor.tsx**

Import `useModelStore` and send `modelConfig` with the generate request:

```diff
+import { useModelStore } from "@/stores/model-store";

 export function ScriptEditor() {
   const t = useTranslations();
   const { project, updateScript, fetchProject } = useProjectStore();
+  const getModelConfig = useModelStore((s) => s.getModelConfig);
   const [saving, setSaving] = useState(false);
```

In `handleParseScript`:

```diff
     await fetch(`/api/projects/${project.id}/generate`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
-      body: JSON.stringify({ action: "script_parse" }),
+      body: JSON.stringify({ action: "script_parse", modelConfig: getModelConfig() }),
     });
```

- [ ] **Step 2: Update character-card.tsx**

```diff
+import { useModelStore } from "@/stores/model-store";

 export function CharacterCard({ ... }) {
   const t = useTranslations();
+  const getModelConfig = useModelStore((s) => s.getModelConfig);
```

In `handleGenerateImage`:

```diff
       body: JSON.stringify({
         action: "character_image",
         payload: { characterId: id },
+        modelConfig: getModelConfig(),
       }),
```

- [ ] **Step 3: Update shot-card.tsx**

```diff
+import { useModelStore } from "@/stores/model-store";

 export function ShotCard({ ... }) {
   const t = useTranslations();
+  const getModelConfig = useModelStore((s) => s.getModelConfig);
```

In `handleGenerateFrames`:

```diff
       body: JSON.stringify({
         action: "frame_generate",
         payload: { shotId: id },
+        modelConfig: getModelConfig(),
       }),
```

In `handleGenerateVideo`:

```diff
       body: JSON.stringify({
         action: "video_generate",
         payload: { shotId: id },
+        modelConfig: getModelConfig(),
       }),
```

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/script-editor.tsx src/components/editor/character-card.tsx src/components/editor/shot-card.tsx
git commit -m "feat: send modelConfig from store with all generate requests"
```

---

## Chunk 8: Verification

### Task 12: Verify the build compiles

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run Next.js build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 3: Manual smoke test**

1. Open `http://localhost:3000`
2. Verify gear icon appears in dashboard header
3. Click gear icon → settings page loads
4. Add a provider → form appears
5. Fill in API key → click Fetch Models → models appear
6. Check some models → select defaults
7. Go back to dashboard → create project → generate should use selected models

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address build issues from model settings feature"
```
