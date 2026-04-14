# Toonflow-Style Multi-Character Reference Injection (Reference Mode) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In reference mode video generation, replace the single-character-ref approach with Toonflow's multi-image injection pattern: collect all character reference images, build a `name=图片N` mapping appended to the prompt, and pass all refs to both Seedance and Kling providers.

**Architecture:** Extend `ReferenceVideoParams` with an optional `characterRefs` array. Route handlers (`handleSingleReferenceVideo` / `handleBatchReferenceVideo`) collect all characters with reference images, build the Toonflow mapping string (with correct 图片N indices), and pass `characterRefs` to the video provider. Seedance appends each ref as additional `image_url` entries in the `content` array; Kling expands `reference_image` from one to many using a new async `toBase64FromPathOrUrl` helper that handles both local files and HTTP URLs.

**Tech Stack:** TypeScript, Next.js API routes, Seedance API, Kling API

---

## File Map

| File | Change |
|------|--------|
| `src/lib/ai/types.ts` | Add `characterRefs` to `ReferenceVideoParams` |
| `src/lib/ai/providers/seedance.ts` | Inject `characterRefs` in `buildReferenceBody` |
| `src/lib/ai/providers/kling-video.ts` | Add `toBase64FromPathOrUrl` async helper; expand `reference_image` with `characterRefs` |
| `src/app/api/projects/[id]/generate/route.ts` | Collect all chars, build correct mapping, pass `characterRefs` in both handlers |

---

### Task 1: Extend `ReferenceVideoParams` with `characterRefs`

**Files:**
- Modify: `src/lib/ai/types.ts`

- [ ] **Step 1: Add `characterRefs` field to `ReferenceVideoParams`**

In `src/lib/ai/types.ts`, replace the `ReferenceVideoParams` type:

```typescript
// Reference image mode: a single initial image (local path or http URL)
type ReferenceVideoParams = {
  firstFrame?: never;
  lastFrame?: never;
  initialImage: string;
  /** Toonflow-style: additional character reference images injected alongside initialImage */
  characterRefs?: Array<{ name: string; imagePath: string }>;
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "feat: add characterRefs to ReferenceVideoParams for Toonflow-style injection"
```

---

### Task 2: Update Seedance provider

**Files:**
- Modify: `src/lib/ai/providers/seedance.ts`

`buildReferenceBody` receives `params` typed as `VideoGenerateParams & { initialImage: string }`. After Task 1, `params.characterRefs` is available directly on the type — no cast needed.

- [ ] **Step 1: Update `buildReferenceBody` in seedance.ts**

Replace the existing `buildReferenceBody` method (the one starting with `// Reference mode: use a single initial image`):

```typescript
// Reference mode: use initial image (prev lastFrame or first char ref) + Toonflow character refs
private buildReferenceBody(
  params: VideoGenerateParams & { initialImage: string }
): Record<string, unknown> {
  const content: unknown[] = [
    { type: "text", text: params.prompt },
    // 图片1 = initial image (temporal chain anchor)
    { type: "image_url", image_url: { url: toImageUrl(params.initialImage) } },
  ];

  // Toonflow pattern: inject character reference images as 图片2, 图片3, ...
  if (params.characterRefs?.length) {
    for (const ref of params.characterRefs) {
      content.push({
        type: "image_url",
        image_url: { url: toImageUrl(ref.imagePath) },
      });
    }
  }

  return {
    model: this.model,
    content,
    duration: params.duration || 5,
    ratio: params.ratio || "16:9",
    return_last_frame: true,
    watermark: false,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/providers/seedance.ts
git commit -m "feat: inject characterRefs into Seedance reference body content array"
```

---

### Task 3: Update Kling provider

**Files:**
- Modify: `src/lib/ai/providers/kling-video.ts`

The existing `toBase64` only handles local files (`fs.readFileSync`). Character `referenceImage` values and `lastFrameUrl` can be HTTP URLs (e.g., from remote storage or Seedance's `last_frame_url`). We need an async helper that handles both cases.

- [ ] **Step 1: Add `toBase64FromPathOrUrl` async helper**

Add this function after the existing `toBase64` function (after line 45):

```typescript
async function toBase64FromPathOrUrl(pathOrUrl: string): Promise<string> {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    const res = await fetch(pathOrUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }
  return toBase64(pathOrUrl);
}
```

- [ ] **Step 2: Update the reference mode branch in `generateVideo`**

Replace the entire `else` block (the reference image mode section) with:

```typescript
} else {
  // ── Reference image mode: text2video with initial image + character refs ──

  // Re-type params inside else branch: TypeScript's discriminated union narrowing via
  // "firstFrame" in params does not always narrow to ReferenceVideoParams statically.
  const refParams = params as VideoGenerateParams & {
    initialImage: string;
    characterRefs?: Array<{ name: string; imagePath: string }>;
  };

  // Use async helper to handle both local paths and HTTP URLs
  const refImages: string[] = [await toBase64FromPathOrUrl(refParams.initialImage)];

  // Toonflow pattern: append all character reference images (图片2, 图片3, ...)
  if (refParams.characterRefs?.length) {
    for (const ref of refParams.characterRefs) {
      refImages.push(await toBase64FromPathOrUrl(ref.imagePath));
    }
  }

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
    const fallbackBody = await submitRes.text().catch(() => "");
    console.warn(
      `[Kling Video] text2video reference_image rejected (${submitRes.status}: ${fallbackBody}), retrying without ref images`
    );
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
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/providers/kling-video.ts
git commit -m "feat: add URL-safe toBase64FromPathOrUrl helper; expand Kling reference_image with characterRefs"
```

---

### Task 4: Update route handlers

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

Both handlers need to:
1. Collect **all** character refs (not just the first)
2. Determine `initialImage` (prevLastFrame or first char ref) and `characterRefs` (remaining images)
3. Build Toonflow mapping with **correct indices** — index depends on whether prevLastFrame is used:
   - With prevLastFrame: 图片1=prevLastFrame, chars start at 图片2
   - Without prevLastFrame (first shot): 图片1=first char, remaining chars start at 图片2
4. Append mapping to `videoPrompt`
5. Pass `characterRefs` to `generateVideo()`

**Mapping logic (shared pattern for both handlers):**

```typescript
const initialImage = prevLastFrameUrl || allCharRefs[0].imagePath;
const characterRefs = prevLastFrameUrl ? allCharRefs : allCharRefs.slice(1);

// Build name→image mapping with correct indices
// prevLastFrameUrl present: 图片1=temporal anchor, chars start at 图片2
// no prevLastFrameUrl:       图片1=first char, remaining chars start at 图片2
const charMapping = prevLastFrameUrl
  ? allCharRefs.map((c, i) => `${c.name}=图片${i + 2}`)
  : allCharRefs.map((c, i) => `${c.name}=图片${i + 1}`);

const charRefMapping =
  charMapping.length > 0
    ? `\n角色参考对照：${charMapping.join("，")}`
    : "";
```

This correctly handles all cases:
- 1 char, no prev: `"角色A=图片1"` (char IS 图片1)
- 2 chars, no prev: `"角色A=图片1，角色B=图片2"`
- 1 char, with prev: `"角色A=图片2"` (prev lastFrame is 图片1)
- 2 chars, with prev: `"角色A=图片2，角色B=图片3"`

- [ ] **Step 1: Update `handleSingleReferenceVideo`**

Replace the `firstCharRefImage` collection and `generateVideo` call block:

```typescript
// Collect all character reference images (Toonflow pattern: all chars, not just first)
const allCharRefs = projectCharacters
  .filter((c) => !!c.referenceImage)
  .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

if (allCharRefs.length === 0) {
  return NextResponse.json(
    { error: "No character reference images available. Please generate character reference images first." },
    { status: 400 }
  );
}

// Use previous shot's lastFrameUrl for chaining; fall back to first character reference image
const allShotsForChain = await db
  .select({ id: shots.id, sequence: shots.sequence, lastFrameUrl: shots.lastFrameUrl })
  .from(shots)
  .where(eq(shots.projectId, shot.projectId))
  .orderBy(asc(shots.sequence));

const currentIdx = allShotsForChain.findIndex((s) => s.id === shotId);
const previousShot = currentIdx > 0 ? allShotsForChain[currentIdx - 1] : null;

// 图片1 = temporal chain anchor (prevLastFrame or first char)
// characterRefs = images injected as 图片2+
const initialImage = previousShot?.lastFrameUrl || allCharRefs[0].imagePath;
const characterRefs = previousShot?.lastFrameUrl ? allCharRefs : allCharRefs.slice(1);

// Toonflow mapping: correct indices based on whether prevLastFrame is used
const charMapping = previousShot?.lastFrameUrl
  ? allCharRefs.map((c, i) => `${c.name}=图片${i + 2}`)
  : allCharRefs.map((c, i) => `${c.name}=图片${i + 1}`);
const charRefMapping =
  charMapping.length > 0 ? `\n角色参考对照：${charMapping.join("，")}` : "";

console.log(
  `[SingleReferenceVideo] Shot ${shot.sequence}: initialImage=${previousShot?.lastFrameUrl ? "prev lastFrame" : "charRef"}, characterRefs=${characterRefs.length}, mapping="${charRefMapping.trim()}"`
);
```

Then build video prompt with mapping appended, and pass `characterRefs`:

```typescript
const videoPrompt =
  (shot.motionScript
    ? buildVideoPrompt({
        sceneDescription: shot.prompt || "",
        motionScript: shot.motionScript,
        cameraDirection: shot.cameraDirection || "static",
        duration: shot.duration ?? 10,
        characterDescriptions,
        dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      })
    : shot.prompt || "") + charRefMapping;

// ...inside try block:
const result = await videoProvider.generateVideo({
  initialImage,
  characterRefs,
  prompt: videoPrompt,
  duration: shot.duration ?? 10,
  ratio,
});
```

- [ ] **Step 2: Update `handleBatchReferenceVideo`**

Replace the `firstCharRefImage` collection (currently `const firstCharRefImage = projectCharacters...`) with:

```typescript
// Collect all character reference images
const allCharRefs = projectCharacters
  .filter((c) => !!c.referenceImage)
  .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

if (allCharRefs.length === 0) {
  return NextResponse.json(
    { error: "No character reference images available." },
    { status: 400 }
  );
}
```

Replace the entire `for (const shot of eligible)` loop body with:

```typescript
for (const shot of eligible) {
  // 图片1 = temporal chain anchor; 图片2+ = character refs
  const initialImage = prevLastFrameUrl || allCharRefs[0].imagePath;
  const characterRefs = prevLastFrameUrl ? allCharRefs : allCharRefs.slice(1);

  // Toonflow mapping with correct indices
  const charMapping = prevLastFrameUrl
    ? allCharRefs.map((c, i) => `${c.name}=图片${i + 2}`)
    : allCharRefs.map((c, i) => `${c.name}=图片${i + 1}`);
  const charRefMapping =
    charMapping.length > 0 ? `\n角色参考对照：${charMapping.join("，")}` : "";

  console.log(
    `[BatchReferenceVideo] Shot ${shot.sequence}: initialImage=${prevLastFrameUrl ? "prev lastFrame" : "charRef"}, characterRefs=${characterRefs.length}`
  );

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

    const videoPrompt =
      (shot.motionScript
        ? buildVideoPrompt({
            sceneDescription: shot.prompt || "",
            motionScript: shot.motionScript,
            cameraDirection: shot.cameraDirection || "static",
            duration: shot.duration ?? 10,
            characterDescriptions,
            dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          })
        : shot.prompt || "") + charRefMapping;

    const result = await videoProvider.generateVideo({
      initialImage,
      characterRefs,
      prompt: videoPrompt,
      duration: shot.duration ?? 10,
      ratio,
    });

    await db
      .update(shots)
      .set({
        referenceVideoUrl: result.filePath,
        lastFrameUrl: result.lastFrameUrl ?? null,
        status: "completed",
      })
      .where(eq(shots.id, shot.id));

    // Pass this shot's lastFrameUrl to the next shot
    prevLastFrameUrl = result.lastFrameUrl ?? null;

    console.log(`[BatchReferenceVideo] Shot ${shot.sequence} completed, lastFrameUrl=${result.lastFrameUrl ?? "none"}`);
    results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", referenceVideoUrl: result.filePath });
  } catch (err) {
    console.error(`[BatchReferenceVideo] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
    // On error, reset prevLastFrameUrl so next shot falls back to first charRef (safer)
    prevLastFrameUrl = null;
    results.push({
      shotId: shot.id,
      sequence: shot.sequence,
      status: "error",
      error: extractErrorMessage(err),
    });
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Start dev server and trigger a single reference video generation:
1. Open a project with 2+ characters that have reference images set
2. In reference mode, click "Generate Video" on a shot
3. Check server logs for:
   - `[SingleReferenceVideo] ... characterRefs=N, mapping="角色参考对照：..."` (N = chars - 1 for first shot)
   - `[Seedance] Submitting task:` or `[Kling Video] text2video: ... refs=N`
4. Verify video generates successfully and character consistency is improved

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: apply Toonflow multi-char reference injection in reference mode video generation"
```
