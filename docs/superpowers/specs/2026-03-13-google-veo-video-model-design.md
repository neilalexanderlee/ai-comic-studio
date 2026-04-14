# Google Veo Video Model Integration Design

**Date**: 2026-03-13
**Status**: Approved

## Overview

Integrate Google's Veo video generation models (via Gemini API) into AIComicBuilder as a new `VideoProvider`, reusing the existing `gemini` protocol. Users configure a Gemini provider with video capability and select a Veo model to generate shot videos from first/last frame pairs.

## Architecture

### New File: `src/lib/ai/providers/veo.ts`

A standalone `VeoProvider` class implementing the `VideoProvider` interface, parallel to the existing `SeedanceProvider`.

```
VeoProvider implements VideoProvider
  constructor({ apiKey, baseUrl?, model?, uploadDir? })
  generateVideo({ firstFrame, lastFrame, prompt, duration, ratio }) → Promise<string>
```

**Internal flow:**
1. `clampDuration(duration)` — maps any integer to nearest of `[4, 6, 8]`; ties round down (5→4, 7→6)
2. Read `firstFrame` and `lastFrame` files → base64 `{ imageBytes, mimeType }`
3. Call SDK with explicit shape — `prompt` and `image` are top-level `GenerateVideosParameters` fields (not nested under `source`); `lastFrame`, `durationSeconds`, and `aspectRatio` go inside `config`:
   ```typescript
   ai.models.generateVideos({
     model,
     prompt,                          // top-level GenerateVideosParameters field
     image: firstFrameData,           // Image_2, top-level
     config: {
       lastFrame: lastFrameData,       // Image_2, inside GenerateVideosConfig
       durationSeconds,
       aspectRatio,
     }
   })
   ```
4. Poll `ai.operations.getVideosOperation({ operation })` every 10s, max 60 attempts (10 min timeout). All checks are evaluated only when `operation.done === true`:
   - `operation.done && operation.error` → throw with error detail
   - `operation.done && operation.response?.raiMediaFilteredCount > 0` → throw with RAI reason
   - `operation.done && operation.response?.generatedVideos?.[0]` → proceed
5. Null-guard: if `generatedVideos[0].video` is absent → throw `"No video URI returned from Veo"`; otherwise `await ai.files.download({ file: generatedVideos[0].video, downloadPath })` → save to `uploads/videos/<ulid>.mp4`
6. Return local file path

### Modified File: `src/lib/ai/provider-factory.ts`

Add `gemini` case to `createVideoProvider`:

```typescript
case "gemini":
  return new VeoProvider({ apiKey, baseUrl, model });
```

No other files require changes. Note: `src/lib/ai/setup.ts` initializes default providers via env vars (e.g. `SEEDANCE_API_KEY`). Adding a `VEO_API_KEY` env-var path to `setup.ts` for default Veo configuration is **out of scope** for this integration — users configure Veo through the Settings UI.

## Supported Models

| Model ID | Notes |
|---|---|
| `veo-2.0-generate-001` | Default, stable |
| `veo-3.1-generate-preview` | Latest, supports audio, reference images |
| `veo-3.1-fast-generate-preview` | Speed-optimized |

## Parameters

| Parameter | Handling |
|---|---|
| `duration` | Clamped to nearest of 4/6/8 seconds |
| `ratio` | `"16:9"` / `"9:16"` passed through; anything else defaults to `"16:9"` |
| `firstFrame` / `lastFrame` | Read from local filesystem, sent as `{ imageBytes, mimeType }` |

## Error Handling

- **Timeout**: 60 × 10s poll attempts → throws `"Veo generation timed out after 10 minutes"`
- **Generation failure**: `operation.done && operation.error` → throw with error detail (SDK surfaces HTTP errors through `operation.error`, not via raw HTTP status codes)
- **RAI filter**: `raiMediaFilteredCount > 0` → throw with `raiMediaFilteredReasons` included in message
- **Missing video**: `done` but no `generatedVideos[0]` → throws `"No video returned from Veo"`
- **Missing video URI**: `generatedVideos[0]` present but `.video` absent → throws `"No video URI returned from Veo"`

Note: `uploadDir` is accepted in the constructor but not passed by `createVideoProvider` (intentional — falls back to `process.env.UPLOAD_DIR || "./uploads"`, matching `SeedanceProvider` behavior).

## User Configuration

No UI changes required. Users add a Provider in Settings with:
- Protocol: `gemini`
- Capability: `video` (plus optionally `text`, `image`)
- API Key: Gemini API Key
- Model: one of the Veo model IDs above

The existing model selection UI and `resolveVideoProvider` plumbing handle the rest.

## Out of Scope

- Veo 3.1 audio generation (no audio pipeline in the project)
- Video extension (appending clips)
- Reference images beyond first/last frame
- UI changes to model settings
