# Shot Reference Image Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-level "基于参考图" generation mode to the storyboard that skips first/last frame generation and calls Kling's text2video API with character reference images directly.

**Architecture:** A new `generationMode` column on the `projects` table ('keyframe' | 'reference') controls which workflow the UI exposes. `VideoGenerateParams` becomes a TypeScript discriminated union so keyframe and reference paths are type-safe and mutually exclusive. Two new API actions (`single_reference_video`, `batch_reference_video`) call a new `handleReferenceVideoGenerate` helper that collects character reference images and calls a new `text2video` branch in `KlingVideoProvider`.

**Tech Stack:** Next.js App Router, Drizzle ORM + SQLite, Zustand, next-intl, Kling AI API (image2video + text2video endpoints), TypeScript 5.

---

## Chunk 1: Data layer — DB migration, schema, store, PATCH route

### Task 1: DB migration + schema

**Files:**
- Create: `drizzle/0002_add_generation_mode.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Create the migration SQL file**

```sql
-- drizzle/0002_add_generation_mode.sql
ALTER TABLE projects ADD COLUMN generation_mode TEXT NOT NULL DEFAULT 'keyframe';
```

- [ ] **Step 2: Register the migration in the journal**

In `drizzle/meta/_journal.json`, add a third entry to the `"entries"` array (after the existing idx 1 entry):

```json
{
  "idx": 2,
  "version": "6",
  "when": 1773640000000,
  "tag": "0002_add_generation_mode",
  "breakpoints": true
}
```

- [ ] **Step 3: Add the field to the Drizzle schema**

In `src/lib/db/schema.ts`, add one line to the `projects` table definition, after the `finalVideoUrl` line:

```ts
generationMode: text('generation_mode').notNull().default('keyframe'),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `generationMode`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0002_add_generation_mode.sql drizzle/meta/_journal.json src/lib/db/schema.ts
git commit -m "feat: add generation_mode column to projects table"
```

---

### Task 2: Update project-store and PATCH route

**Files:**
- Modify: `src/stores/project-store.ts`
- Modify: `src/app/api/projects/[id]/route.ts`

- [ ] **Step 1: Add `generationMode` to the `Project` interface in the store**

In `src/stores/project-store.ts`, find the `Project` interface (lines 35–44) and add `generationMode` after `finalVideoUrl`:

```ts
interface Project {
  id: string;
  title: string;
  idea: string;
  script: string;
  status: string;
  finalVideoUrl: string | null;
  generationMode: string;   // add this line
  characters: Character[];
  shots: Shot[];
}
```

- [ ] **Step 2: Harden the PATCH route with explicit field construction**

Replace the current `PATCH` body parsing and update in `src/app/api/projects/[id]/route.ts` (lines 77–88):

```ts
  const body = (await request.json()) as Partial<{
    title: string;
    idea: string;
    script: string;
    status: "draft" | "processing" | "completed";
    generationMode: string;
  }>;

  const { title, idea, script, status, generationMode } = body;

  const [updated] = await db
    .update(projects)
    .set({
      ...(title !== undefined && { title }),
      ...(idea !== undefined && { idea }),
      ...(script !== undefined && { script }),
      ...(status !== undefined && { status }),
      ...(generationMode !== undefined && { generationMode }),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning();

  return NextResponse.json(updated);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/project-store.ts src/app/api/projects/[id]/route.ts
git commit -m "feat: add generationMode to project store and harden PATCH route"
```

---

## Chunk 2: AI provider + pipeline + API actions

### Task 3: Refactor VideoGenerateParams to discriminated union

**Files:**
- Modify: `src/lib/ai/types.ts`

- [ ] **Step 1: Replace the `VideoGenerateParams` interface with a discriminated union type**

Replace the entire `VideoGenerateParams` declaration in `src/lib/ai/types.ts` (lines 21–27):

```ts
// Keyframe mode: both firstFrame and lastFrame must be provided
type KeyframeVideoParams = {
  firstFrame: string;
  lastFrame: string;
  charRefImages?: never;
};

// Reference image mode: charRefImages must be provided (local file paths)
type ReferenceVideoParams = {
  firstFrame?: never;
  lastFrame?: never;
  charRefImages: string[];
};

export type VideoGenerateParams = (KeyframeVideoParams | ReferenceVideoParams) & {
  prompt: string;
  duration: number;
  ratio: string;  // required; callers must provide (default "16:9" at call site)
};
```

Note: `VideoProvider` interface on line 29 (`generateVideo(params: VideoGenerateParams): Promise<string>`) stays unchanged — swapping `interface` to `type` is transparent to callers.

- [ ] **Step 2: Verify existing call sites still compile**

```bash
npx tsc --noEmit 2>&1 | head -50
```

Expected: The existing `handleSingleVideoGenerate` and `handleBatchVideoGenerate` pass `firstFrame` and `lastFrame`, satisfying `KeyframeVideoParams`. Any error here means an unexpected call site — fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "refactor: VideoGenerateParams to discriminated union for keyframe vs reference modes"
```

---

### Task 4: Extend KlingVideoProvider with text2video branch

**Files:**
- Modify: `src/lib/ai/providers/kling-video.ts`

- [ ] **Step 1: Replace the entire `pollForResult` method**

Replace `private async pollForResult(taskId: string): Promise<string>` and its entire body (lines 131–166 in `src/lib/ai/providers/kling-video.ts`) with:

```ts
  private async pollForResult(
    taskId: string,
    taskType: "image2video" | "text2video"
  ): Promise<string> {
    const maxAttempts = 120;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      const res = await fetch(
        `${this.baseUrl}/v1/videos/${taskType}/${taskId}`,
        { headers: { Authorization: this.getAuthHeader() } }
      );

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
```

- [ ] **Step 2: Update the existing `generateVideo` call to pass `"image2video"`**

On the existing line that calls `pollForResult` (line 116):

```ts
    const videoUrl = await this.pollForResult(taskId, "image2video");
```

- [ ] **Step 3: Remove the dead `?? "16:9"` fallback**

`ratio` is now required in `VideoGenerateParams` (Task 3). In the existing `generateVideo` keyframe path, change:

```ts
    const aspectRatio = params.ratio ?? "16:9";
```

to:

```ts
    const aspectRatio = params.ratio;
```

- [ ] **Step 4: Add the text2video branch inside `generateVideo`**

Replace the entire `generateVideo` method with this version that branches on `'firstFrame' in params`:

```ts
  async generateVideo(params: VideoGenerateParams): Promise<string> {
    const duration = params.duration <= 5 ? 5 : 10;
    const aspectRatio = params.ratio;

    let taskId: string;

    if ("firstFrame" in params) {
      // ── Keyframe mode: image2video ──
      const imageData = toBase64(params.firstFrame);
      const tailImageData = toBase64(params.lastFrame);

      console.log(
        `[Kling Video] image2video: model=${this.model}, duration=${duration}s, ratio=${aspectRatio}`
      );

      const submitRes = await fetch(`${this.baseUrl}/v1/videos/image2video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          model: this.model,
          prompt: params.prompt,
          image: imageData,
          tail_image: tailImageData,
          duration,
          aspect_ratio: aspectRatio,
          sound: "on",
        }),
      });

      if (!submitRes.ok) {
        const errBody = await submitRes.text().catch(() => "");
        throw new Error(`Kling image2video submit failed: ${submitRes.status} ${errBody}`);
      }

      const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
      if (submitJson.code !== 0) {
        throw new Error(`Kling image2video error: ${submitJson.message}`);
      }
      taskId = submitJson.data.task_id;
      console.log(`[Kling Video] image2video task submitted: ${taskId}`);

    } else {
      // ── Reference image mode: text2video ──
      const refImages = params.charRefImages.map((p) => toBase64(p));

      console.log(
        `[Kling Video] text2video: model=${this.model}, duration=${duration}s, ratio=${aspectRatio}, refs=${refImages.length}`
      );

      let submitRes = await fetch(`${this.baseUrl}/v1/videos/text2video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          model: this.model,
          prompt: params.prompt,
          reference_image: refImages,
          duration,
          aspect_ratio: aspectRatio,
        }),
      });

      // Fallback: if reference_image is unsupported (400/422), retry without it
      if (submitRes.status === 400 || submitRes.status === 422) {
        console.warn(`[Kling Video] text2video reference_image rejected (${submitRes.status}), retrying without ref images`);
        submitRes = await fetch(`${this.baseUrl}/v1/videos/text2video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            model: this.model,
            prompt: params.prompt,
            duration,
            aspect_ratio: aspectRatio,
          }),
        });
      }

      if (!submitRes.ok) {
        const errBody = await submitRes.text().catch(() => "");
        throw new Error(`Kling text2video submit failed: ${submitRes.status} ${errBody}`);
      }

      const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
      if (submitJson.code !== 0) {
        throw new Error(`Kling text2video error: ${submitJson.message}`);
      }
      taskId = submitJson.data.task_id;
      console.log(`[Kling Video] text2video task submitted: ${taskId}`);
    }

    const taskType = "firstFrame" in params ? "image2video" : "text2video";
    const videoUrl = await this.pollForResult(taskId, taskType);

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
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/providers/kling-video.ts
git commit -m "feat: add text2video branch and parameterized poll endpoint to KlingVideoProvider"
```

---

### Task 5: Add reference video API actions to generate route

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

- [ ] **Step 1: Add the two new action dispatchers to the POST handler**

In `src/app/api/projects/[id]/generate/route.ts`, find the last `if (action === ...)` block before the final `return NextResponse.json(...)`. Add after `batch_video_generate`:

```ts
  if (action === "single_reference_video") {
    return handleSingleReferenceVideo(projectId, payload, modelConfig);
  }

  if (action === "batch_reference_video") {
    return handleBatchReferenceVideo(projectId, payload, modelConfig);
  }
```

- [ ] **Step 2: Add `handleSingleReferenceVideo` function**

Add this function before `handleVideoAssembleSync` (around line 961):

```ts
// --- single_reference_video: text2video with character reference images ---

async function handleSingleReferenceVideo(
  projectId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  // Derive projectId from the shot record (ownership already verified by route guard)
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  // Collect all project characters that have reference images
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  const charRefImages = projectCharacters
    .filter((c) => !!c.referenceImage)
    .map((c) => c.referenceImage as string);

  if (charRefImages.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available. Please generate character reference images first." },
      { status: 400 }
    );
  }

  const videoProvider = resolveVideoProvider(modelConfig);
  const ratio = (payload?.ratio as string) || "16:9";

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const dialogueList = shotDialogues.map((d) => ({
    characterName: projectCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown",
    text: d.text,
  }));

  const videoPrompt = shot.motionScript
    ? buildVideoPrompt({
        sceneDescription: shot.prompt || "",
        motionScript: shot.motionScript,
        cameraDirection: shot.cameraDirection || "static",
        duration: shot.duration ?? 10,
        characterDescriptions,
        dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      })
    : shot.prompt || "";

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const videoPath = await videoProvider.generateVideo({
      charRefImages,
      prompt: videoPrompt,
      duration: shot.duration ?? 10,
      ratio,
    });

    await db
      .update(shots)
      .set({ videoUrl: videoPath, status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, videoUrl: videoPath, status: "ok" });
  } catch (err) {
    console.error(`[SingleReferenceVideo] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Add `handleBatchReferenceVideo` function**

Add this function directly after `handleSingleReferenceVideo`:

```ts
// --- batch_reference_video: sequential text2video for all eligible shots ---

async function handleBatchReferenceVideo(
  projectId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  // Eligible: not currently generating, no video yet (failed shots are retried)
  const eligible = allShots.filter(
    (s) => s.status !== "generating" && !s.videoUrl
  );
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const charRefImages = projectCharacters
    .filter((c) => !!c.referenceImage)
    .map((c) => c.referenceImage as string);

  if (charRefImages.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available." },
      { status: 400 }
    );
  }

  const videoProvider = resolveVideoProvider(modelConfig);
  const ratio = (payload?.ratio as string) || "16:9";

  // Pre-mark all eligible shots as generating
  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const results: Array<{
    shotId: string;
    sequence: number;
    status: "ok" | "error";
    videoUrl?: string;
    error?: string;
  }> = [];

  for (const shot of eligible) {
    try {
      const shotDialogues = await db
        .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
        .from(dialogues)
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));
      const dialogueList = shotDialogues.map((d) => ({
        characterName: projectCharacters.find((c) => c.id === d.characterId)?.name ?? "Unknown",
        text: d.text,
      }));

      const videoPrompt = shot.motionScript
        ? buildVideoPrompt({
            sceneDescription: shot.prompt || "",
            motionScript: shot.motionScript,
            cameraDirection: shot.cameraDirection || "static",
            duration: shot.duration ?? 10,
            characterDescriptions,
            dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          })
        : shot.prompt || "";

      const videoPath = await videoProvider.generateVideo({
        charRefImages,
        prompt: videoPrompt,
        duration: shot.duration ?? 10,
        ratio,
      });

      await db
        .update(shots)
        .set({ videoUrl: videoPath, status: "completed" })
        .where(eq(shots.id, shot.id));

      console.log(`[BatchReferenceVideo] Shot ${shot.sequence} completed`);
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", videoUrl: videoPath });
    } catch (err) {
      console.error(`[BatchReferenceVideo] Error for shot ${shot.sequence}:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: extractErrorMessage(err),
      });
    }
  }

  return NextResponse.json({ results });
}
```

> **Note:** The spec's file change list mentions `src/lib/pipeline/reference-video.ts` as a new file. This plan intentionally inlines the handler logic directly into the generate route (consistent with `handleSingleVideoGenerate` and `handleBatchVideoGenerate`, which are also inline). No separate pipeline file is needed.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: add single_reference_video and batch_reference_video API actions"
```

---

## Chunk 3: UI — GenerationModeTab, ShotCard, Storyboard page

### Task 6: Create GenerationModeTab component + i18n strings

**Files:**
- Create: `src/components/editor/generation-mode-tab.tsx`
- Modify: `messages/zh.json`, `messages/en.json`, `messages/ja.json`, `messages/ko.json`

- [ ] **Step 1: Add i18n keys to all four locale files**

In `messages/zh.json`, inside the `"project"` object, add:

```json
"generationModeKeyframe": "基于首尾帧",
"generationModeReference": "基于参考图",
"referenceCharactersLabel": "参考角色：{names}（{count} 个）",
"noReferenceImages": "无可用参考图，请先为角色生成参考图",
"batchGenerateReferenceVideos": "批量生成视频"
```

In `messages/en.json`, inside the `"project"` object, add:

```json
"generationModeKeyframe": "Keyframe Mode",
"generationModeReference": "Reference Image Mode",
"referenceCharactersLabel": "Reference: {names} ({count})",
"noReferenceImages": "No reference images — generate character images first",
"batchGenerateReferenceVideos": "Batch Generate Videos"
```

In `messages/ja.json`, inside the `"project"` object, add:

```json
"generationModeKeyframe": "キーフレームモード",
"generationModeReference": "参照画像モード",
"referenceCharactersLabel": "参照キャラ：{names}（{count}人）",
"noReferenceImages": "参照画像がありません。先にキャラクター画像を生成してください",
"batchGenerateReferenceVideos": "一括動画生成"
```

In `messages/ko.json`, inside the `"project"` object, add:

```json
"generationModeKeyframe": "키프레임 모드",
"generationModeReference": "참조 이미지 모드",
"referenceCharactersLabel": "참조 캐릭터: {names} ({count}명)",
"noReferenceImages": "참조 이미지 없음 — 먼저 캐릭터 이미지를 생성하세요",
"batchGenerateReferenceVideos": "일괄 동영상 생성"
```

- [ ] **Step 2: Create `GenerationModeTab` component**

Create `src/components/editor/generation-mode-tab.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useProjectStore } from "@/stores/project-store";
import { apiFetch } from "@/lib/api-fetch";
import { Film, ImageIcon } from "lucide-react";
import { toast } from "sonner";

type GenerationMode = "keyframe" | "reference";

export function GenerationModeTab() {
  const t = useTranslations("project");
  const { project, setProject } = useProjectStore();

  if (!project) return null;

  const mode = (project.generationMode || "keyframe") as GenerationMode;

  async function switchMode(newMode: GenerationMode) {
    if (!project || newMode === mode) return;

    // Optimistic update
    const previous = project;
    setProject({ ...project, generationMode: newMode });

    try {
      await apiFetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationMode: newMode }),
      });
    } catch (err) {
      // Rollback on failure
      setProject(previous);
      toast.error(err instanceof Error ? err.message : "Failed to switch mode");
    }
  }

  return (
    <div className="flex gap-1 rounded-lg border border-[--border-subtle] bg-[--surface] p-1">
      <button
        onClick={() => switchMode("keyframe")}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          mode === "keyframe"
            ? "bg-white text-[--text-primary] shadow-sm"
            : "text-[--text-muted] hover:text-[--text-secondary]"
        }`}
      >
        <Film className="h-3.5 w-3.5" />
        {t("generationModeKeyframe")}
      </button>
      <button
        onClick={() => switchMode("reference")}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          mode === "reference"
            ? "bg-white text-[--text-primary] shadow-sm"
            : "text-[--text-muted] hover:text-[--text-secondary]"
        }`}
      >
        <ImageIcon className="h-3.5 w-3.5" />
        {t("generationModeReference")}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/generation-mode-tab.tsx messages/zh.json messages/en.json messages/ja.json messages/ko.json
git commit -m "feat: add GenerationModeTab component and i18n strings"
```

---

### Task 7: Update ShotCard to accept and respond to generationMode

**Files:**
- Modify: `src/components/editor/shot-card.tsx`

- [ ] **Step 1: Add `generationMode` and `batchGeneratingReferenceVideo` to `ShotCardProps`**

In `src/components/editor/shot-card.tsx`, find the `ShotCardProps` interface (lines 36–55) and add two props:

```ts
  generationMode?: "keyframe" | "reference";
  batchGeneratingReferenceVideo?: boolean;
```

- [ ] **Step 2: Destructure the new props and add reference video handler**

In the function body, destructure the new props alongside the existing ones (after `characterDescriptions`):

```ts
  generationMode = "keyframe",
  batchGeneratingReferenceVideo,
```

Then update the `isGeneratingVideo` line to also cover reference batch:

```ts
  const isGeneratingVideo =
    generatingVideo ||
    (!!batchGeneratingVideo && !!firstFrame && !!lastFrame && !videoUrl) ||
    (!!batchGeneratingReferenceVideo && generationMode === "reference" && !videoUrl);
```

Add a new handler after `handleGenerateVideo`:

```ts
  async function handleGenerateReferenceVideo() {
    if (!videoGuard()) return;
    setGeneratingVideo(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_reference_video",
          payload: { shotId: id, ratio: videoRatio },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      console.error("Reference video generate error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingVideo(false);
  }
```

- [ ] **Step 3: Replace thumbnails array + collapsed action buttons with mode-aware versions**

The target is the **header strip** in `src/components/editor/shot-card.tsx`. Replace the entire thumbnails `<div className="flex gap-1.5">` block (lines 208–232) AND the `{!expanded && (...)}` block (lines 265–295) with the following:

**Thumbnails** — replace lines 208–232:

```tsx
        {/* Media thumbnails */}
        <div className="flex gap-1.5">
          {(generationMode === "reference"
            ? [{ src: videoUrl, icon: VideoIcon, label: "Video", type: "video" as const }]
            : [
                { src: firstFrame, icon: ImageIcon, label: t("shot.firstFrame"), type: "image" as const },
                { src: lastFrame, icon: ImageIcon, label: t("shot.lastFrame"), type: "image" as const },
                { src: videoUrl, icon: VideoIcon, label: "Video", type: "video" as const },
              ]
          ).map((item, i) => (
            <div
              key={i}
              className={`h-14 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-[--border-subtle] ${item.src ? "cursor-pointer transition-opacity hover:opacity-80" : ""}`}
              onClick={() => item.src && setPreviewSrc(uploadUrl(item.src))}
            >
              {item.src ? (
                item.type === "video" ? (
                  <video className="h-full w-full object-cover" src={uploadUrl(item.src)} />
                ) : (
                  <img src={uploadUrl(item.src)} alt={item.label} className="h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[--surface]">
                  <item.icon className="h-4 w-4 text-[--text-muted]" />
                </div>
              )}
            </div>
          ))}
        </div>
```

**Collapsed action buttons** — replace lines 265–295:

```tsx
          {!expanded && (
            <>
              {generationMode !== "reference" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); handleGenerateFrames(); }}
                  disabled={isGeneratingFrames || isGeneratingVideo}
                >
                  {isGeneratingFrames ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3 w-3" />
                  )}
                  {isGeneratingFrames ? t("common.generating") : t("project.generateFrames")}
                </Button>
              )}
              {generationMode === "reference" ? (
                <Button
                  size="xs"
                  onClick={(e) => { e.stopPropagation(); handleGenerateReferenceVideo(); }}
                  disabled={isGeneratingVideo}
                >
                  {isGeneratingVideo ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {isGeneratingVideo ? t("common.generating") : t("project.generateVideo")}
                </Button>
              ) : (firstFrame && lastFrame && (
                <Button
                  size="xs"
                  onClick={(e) => { e.stopPropagation(); handleGenerateVideo(); }}
                  disabled={isGeneratingFrames || isGeneratingVideo}
                >
                  {isGeneratingVideo ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {isGeneratingVideo ? t("common.generating") : t("project.generateVideo")}
                </Button>
              ))}
            </>
          )}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/shot-card.tsx
git commit -m "feat: ShotCard responds to generationMode prop, adds reference video button"
```

---

### Task 8: Integrate GenerationModeTab into storyboard page

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

- [ ] **Step 1: Import GenerationModeTab and Link**

Add to the existing imports at the top of the storyboard page:

```ts
import { GenerationModeTab } from "@/components/editor/generation-mode-tab";
import Link from "next/link";
```

- [ ] **Step 2: Derive mode and character ref info**

After the existing `const shotsWithVideo = ...` line, add:

```ts
  const generationMode = (project.generationMode || "keyframe") as "keyframe" | "reference";
  const charactersWithRefs = project.characters.filter((c) => c.referenceImage);
  const hasReferenceImages = charactersWithRefs.length > 0;
```

- [ ] **Step 3: Update step indicator logic for reference mode**

Replace the existing `step2Status` and `step3Status` blocks with mode-aware versions:

```ts
  const step2Status: StepStatus =
    generationMode === "reference"
      ? "completed"  // frame step is skipped in reference mode
      : totalShots === 0
        ? "pending"
        : shotsWithFrames === totalShots
          ? "completed"
          : "active";

  const step3Status: StepStatus =
    totalShots === 0
      ? "pending"
      : generationMode === "reference"
        ? shotsWithVideo === totalShots
          ? "completed"
          : totalShots > 0
            ? "active"
            : "pending"
        : shotsWithFrames === 0
          ? "pending"
          : shotsWithVideo === totalShots
            ? "completed"
            : shotsWithFrames > 0
              ? "active"
              : "pending";
```

- [ ] **Step 4: Add a `handleBatchGenerateReferenceVideos` function**

Add after `handleBatchGenerateVideos`:

```ts
  async function handleBatchGenerateReferenceVideos() {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideos(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_reference_video",
          payload: { ratio: videoRatio },
          modelConfig: getModelConfig(),
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch reference video error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideos(false);
    fetchProject(project.id);
  }
```

- [ ] **Step 5: Render GenerationModeTab + reference character indicator**

In the JSX, inside the `3-Step Workflow Pipeline` div, add `<GenerationModeTab />` right before the `{/* Step indicators */}` comment. Then add the character reference indicator after the step indicators and before the action buttons div:

```tsx
      {/* Generation mode tab */}
      <GenerationModeTab />

      {/* Reference image mode: character indicator */}
      {generationMode === "reference" && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${
          hasReferenceImages
            ? "bg-violet-50 text-violet-700 border border-violet-200"
            : "bg-amber-50 text-amber-700 border border-amber-200"
        }`}>
          {hasReferenceImages ? (
            <>
              🖼️ {t("project.referenceCharactersLabel", {
                names: charactersWithRefs.map((c) => c.name).join("、"),
                count: charactersWithRefs.length,
              })}
            </>
          ) : (
            <>
              ⚠️ {t("project.noReferenceImages")}
              {" — "}
              <Link href="../characters" className="underline">
                {t("project.characters")}
              </Link>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 6: Replace action buttons area with mode-aware rendering**

In the action buttons area (currently lines 301–364), keep Step 1 (generate shots) unconditional. Replace Step 2 and Step 3 with:

```tsx
          {/* Step 2: Batch generate frames — keyframe mode only */}
          {generationMode === "keyframe" && totalShots > 0 && (
            <>
              <InlineModelPicker capability="image" />
              <Button
                onClick={handleBatchGenerateFrames}
                disabled={anyGenerating}
                variant={step2Status === "completed" ? "outline" : "default"}
                size="sm"
              >
                {generatingFrames ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                {generatingFrames ? t("common.generating") : t("project.batchGenerateFrames")}
              </Button>
            </>
          )}

          {/* Step 3: Batch generate videos */}
          {totalShots > 0 &&
            (generationMode === "reference" ? hasReferenceImages : shotsWithFrames > 0) && (
            <>
              <InlineModelPicker capability="video" />
              <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
              <Button
                onClick={
                  generationMode === "reference"
                    ? handleBatchGenerateReferenceVideos
                    : handleBatchGenerateVideos
                }
                disabled={anyGenerating || (generationMode === "reference" && !hasReferenceImages)}
                variant={step3Status === "completed" ? "outline" : "default"}
                size="sm"
              >
                {generatingVideos ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generatingVideos
                  ? t("common.generating")
                  : generationMode === "reference"
                    ? t("project.batchGenerateReferenceVideos")
                    : t("project.batchGenerateVideos")}
              </Button>
            </>
          )}
```

- [ ] **Step 7: Pass `generationMode` and `batchGeneratingReferenceVideo` to each ShotCard**

In the `project.shots.map(...)` block, add the two new props:

```tsx
              generationMode={generationMode}
              batchGeneratingReferenceVideo={generationMode === "reference" ? generatingVideos : undefined}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 9: Smoke test**

1. Run `npm run dev`
2. Open a project's storyboard page
3. Verify: two tabs visible at top of workflow panel, default is "基于首尾帧"
4. Click "基于参考图" tab: frame buttons disappear from shot cards; batch video button changes to reference mode
5. If characters have reference images: purple indicator shows names
6. If no reference images: amber warning shows with link to characters page
7. Click "基于首尾帧" to switch back: frame UI returns
8. Reload page: mode persists (DB-stored)

- [ ] **Step 10: Commit**

```bash
git add src/app/[locale]/project/[id]/storyboard/page.tsx
git commit -m "feat: integrate GenerationModeTab and reference mode UI into storyboard page"
```
