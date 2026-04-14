# Google Veo Video Model Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Veo as a video generation provider so users can select `gemini` protocol + a Veo model ID in Settings to generate shot videos via the Gemini API.

**Architecture:** Create a standalone `VeoProvider` class (parallel to `SeedanceProvider`) that uses the already-installed `@google/genai` SDK. Wire it into `createVideoProvider` by adding a `case "gemini"` branch — the only other file that needs touching.

**Tech Stack:** `@google/genai` (already installed), TypeScript, Node.js `fs`, `ulid`

**Spec:** `docs/superpowers/specs/2026-03-13-google-veo-video-model-design.md`

---

## Chunk 1: VeoProvider + factory wiring

### Task 1: Create `src/lib/ai/providers/veo.ts`

**Files:**
- Create: `src/lib/ai/providers/veo.ts`

#### Notes on `@google/genai` SDK usage

- `GoogleGenAI` client construction: identical to `GeminiProvider` (strip trailing `/v1` path segments from `baseUrl` before passing to `httpOptions.baseUrl`)
- Image format for frames: `{ imageBytes: string, mimeType: string }` — NOT data URLs (Seedance used data URLs; Veo uses the SDK's `Image` type)
- `generateVideos` call shape: `prompt` and `image` are **top-level** parameters, `lastFrame`/`durationSeconds`/`aspectRatio` go in `config`
- Poll via `ai.operations.getVideosOperation({ operation })` — checks `operation.done` before acting
- Download via `ai.files.download({ file: generatedVideos[0].video, downloadPath })`

- [ ] **Step 1: Write `clampDuration` helper and `VeoProvider` class skeleton**

```typescript
// src/lib/ai/providers/veo.ts
import { GoogleGenAI } from "@google/genai";
import type { VideoProvider, VideoGenerateParams } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

const VALID_DURATIONS = [4, 6, 8] as const;

function clampDuration(duration: number): number {
  return VALID_DURATIONS.reduce((prev, curr) =>
    Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
  );
}

function toAspectRatio(ratio?: string): "16:9" | "9:16" {
  if (ratio === "9:16") return "9:16";
  return "16:9";
}

function readImageData(filePath: string): { imageBytes: string; mimeType: string } {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".png" ? "image/png" :
    ext === ".webp" ? "image/webp" :
    "image/jpeg";
  const imageBytes = fs.readFileSync(filePath, { encoding: "base64" });
  return { imageBytes, mimeType };
}

export class VeoProvider implements VideoProvider {
  private client: GoogleGenAI;
  private model: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
    const options: ConstructorParameters<typeof GoogleGenAI>[0] = {
      apiKey: params?.apiKey || process.env.GEMINI_API_KEY || "",
    };
    if (params?.baseUrl) {
      const baseUrl = params.baseUrl.replace(/\/+$/, "").replace(/\/v\d[^/]*$/, "");
      options.httpOptions = { baseUrl };
    }
    this.client = new GoogleGenAI(options);
    this.model = params?.model || "veo-2.0-generate-001";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<string> {
    const durationSeconds = clampDuration(params.duration);
    const aspectRatio = toAspectRatio(params.ratio);
    const firstFrameData = readImageData(params.firstFrame);
    const lastFrameData = readImageData(params.lastFrame);

    console.log(
      `[Veo] Submitting task: model=${this.model}, duration=${durationSeconds}s, ratio=${aspectRatio}`
    );

    let operation = await this.client.models.generateVideos({
      model: this.model,
      prompt: params.prompt,
      image: firstFrameData,
      config: {
        lastFrame: lastFrameData,
        durationSeconds,
        aspectRatio,
      },
    });

    operation = await this.pollForResult(operation);

    const response = operation.response;
    if (!response?.generatedVideos?.[0]) {
      throw new Error("No video returned from Veo");
    }
    const videoFile = response.generatedVideos[0].video;
    if (!videoFile) {
      throw new Error("No video URI returned from Veo");
    }

    if ((response.raiMediaFilteredCount ?? 0) > 0) {
      throw new Error(
        `Veo generation blocked by safety filter: ${JSON.stringify(response.raiMediaFilteredReasons)}`
      );
    }

    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const downloadPath = path.join(dir, `${ulid()}.mp4`);

    await this.client.files.download({ file: videoFile, downloadPath });

    console.log(`[Veo] Video saved to ${downloadPath}`);
    return downloadPath;
  }

  private async pollForResult(
    initial: Awaited<ReturnType<GoogleGenAI["models"]["generateVideos"]>>
  ): Promise<typeof initial> {
    const maxAttempts = 60;
    let operation = initial;

    for (let i = 0; i < maxAttempts; i++) {
      if (operation.done) {
        if (operation.error) {
          throw new Error(`Veo generation failed: ${JSON.stringify(operation.error)}`);
        }
        return operation;
      }

      await new Promise((resolve) => setTimeout(resolve, 10_000));
      operation = await this.client.operations.getVideosOperation({ operation });
      console.log(`[Veo] Poll ${i + 1}: done=${operation.done}`);
    }

    throw new Error("Veo generation timed out after 10 minutes");
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder
pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to `veo.ts`. Fix any type errors before proceeding.

---

### Task 2: Wire `VeoProvider` into `provider-factory.ts`

**Files:**
- Modify: `src/lib/ai/provider-factory.ts:39-50`

- [ ] **Step 3: Add import and `gemini` case to `createVideoProvider`**

In `src/lib/ai/provider-factory.ts`:

1. Add this import at the top alongside the existing provider imports:
```typescript
import { VeoProvider } from "./providers/veo";
```

2. Add the `gemini` case to `createVideoProvider`. The full updated function should look like:

```typescript
export function createVideoProvider(config: ProviderConfig): VideoProvider {
  switch (config.protocol) {
    case "seedance":
      return new SeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
      });
    case "gemini":
      return new VeoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -40
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/providers/veo.ts src/lib/ai/provider-factory.ts
git commit -m "feat: add Google Veo video provider via gemini protocol"
```

---

## Chunk 2: Manual smoke test

> No automated test framework is configured. Verify via Settings UI.

### Task 3: Manual verification steps

- [ ] **Step 6: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 7: Configure a Veo provider in Settings**

1. Open Settings → Model Providers → Add Provider
2. Set: Name = `Google Veo`, Protocol = `gemini`, Capability = `video`
3. API Key = your Gemini API Key
4. Add model: `veo-2.0-generate-001`
5. Set as default video model

- [ ] **Step 8: Generate a test video**

Open a project with a shot that has both first and last frames generated. Trigger video generation on that shot. Check:
- Task enters `generating` status
- After ~1-5 min, video appears in the shot
- Console logs show `[Veo] Submitting task` and poll updates
- No errors in server logs

---

## Notes

**`clampDuration` tie-breaking:** ties round down — distance is compared with `<` (strictly less than), so equal distances keep the previous (lower) value.

**RAI check placement:** The RAI check occurs after confirming `done` and `generatedVideos[0]` exists, since `raiMediaFilteredCount` is only meaningful in the final response.

**`uploadDir` not passed by factory:** intentional — falls back to `process.env.UPLOAD_DIR || "./uploads"` as with `SeedanceProvider`.
