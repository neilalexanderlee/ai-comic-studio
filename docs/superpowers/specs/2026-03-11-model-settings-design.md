# Model Settings Design Spec

## Overview

Add a settings page for model provider configuration. Users can configure multiple model providers with different protocols, fetch available models via API, and select default models for text/image/video generation.

## Storage

- **localStorage** via Zustand persist middleware
- Keys never touch the server database
- Keys are passed to backend on each generation request

## Data Model

```typescript
interface Provider {
  id: string           // ulid
  name: string         // user-defined, e.g. "DeepSeek"
  protocol: "openai" | "gemini" | "seedance"
  capabilities: ("text" | "image" | "video")[]
  baseUrl: string
  apiKey: string
  models: Model[]      // fetched or manually added
}

interface Model {
  id: string           // model_id, e.g. "gpt-4o"
  name: string         // display name
  checked: boolean     // user-enabled
}

interface ModelSelections {
  defaultTextModel: { providerId: string; modelId: string } | null
  defaultImageModel: { providerId: string; modelId: string } | null
  defaultVideoModel: { providerId: string; modelId: string } | null
}
```

## Page & Navigation

- Entry: gear icon in Dashboard header, links to `/:locale/settings`
- Layout: back button + title, same style as project pages
- Sections:
  1. Provider list (cards) with add/delete
  2. Selected provider config form (name, protocol, baseUrl, apiKey, fetch models, model checkboxes)
  3. Default model pickers (text/image/video dropdowns from checked models)

## API

### `POST /api/models/list`

Request: `{ protocol: string, baseUrl: string, apiKey: string }`

Response: `{ models: [{ id: string, name: string }] }`

Backend proxies to provider's model list endpoint:
- OpenAI protocol: `GET {baseUrl}/v1/models`
- Gemini protocol: `GET generativelanguage.googleapis.com/v1beta/models?key=...`
- Seedance protocol: returns hardcoded preset models

## Generation Flow

Frontend reads localStorage config and sends model info in generate request body:

```typescript
{
  type: "character_image",
  modelConfig: {
    text: { protocol, baseUrl, apiKey, modelId },
    image: { protocol, baseUrl, apiKey, modelId },
    video: { protocol, baseUrl, apiKey, modelId }
  }
}
```

Backend creates provider instances dynamically from the passed config instead of reading .env.

## Changes Required

1. **New page**: `/:locale/settings` with settings layout
2. **New components**: ProviderCard, ProviderForm, ModelCheckboxList, DefaultModelPicker
3. **New API**: `POST /api/models/list`
4. **New store**: `useModelStore` (Zustand + persist)
5. **Refactor AI providers**: support dynamic instantiation from config
6. **Refactor pipeline**: generate API accepts modelConfig, passes to handlers
7. **i18n**: add settings-related translations to all 4 locales
