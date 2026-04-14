# Video Prompt Smooth Motion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate abrupt camera movements in generated videos by adding a concise `videoScript` field and restructuring the video generation prompt with explicit frame anchors.

**Architecture:** Add a `videoScript` column to `shots` (nullable, backward-compatible). Populate it during `shot_split` and `single_shot_rewrite`. Replace the current dense `motionScript + Camera: direction` video prompt pattern with a structured prompt: smooth-interpolation header + `videoScript` + `cameraDirection` + frame anchors + dialogue. Apply to all four video generation handlers (keyframe and reference modes).

**Tech Stack:** TypeScript, Next.js App Router, SQLite + Drizzle ORM (`better-sqlite3`), Drizzle migrations (auto-run via `runMigrations()` in `src/lib/bootstrap.ts`)

---

### Task 1: DB migration — add `videoScript` column

**Files:**
- Create: `drizzle/0006_add_video_script.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Create migration SQL file**

Create `drizzle/0006_add_video_script.sql`:
```sql
ALTER TABLE shots ADD COLUMN video_script TEXT;
```

- [ ] **Step 2: Register migration in journal**

In `drizzle/meta/_journal.json`, append to the `"entries"` array:
```json
{
  "idx": 6,
  "version": "6",
  "when": 1774100000000,
  "tag": "0006_add_video_script",
  "breakpoints": true
}
```

- [ ] **Step 3: Add field to Drizzle schema**

In `src/lib/db/schema.ts`, inside the `shots` table definition, add after `sceneRefFrame`:
```typescript
videoScript: text("video_script"),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | head -20
```
Expected: no errors related to schema.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0006_add_video_script.sql drizzle/meta/_journal.json src/lib/db/schema.ts
git commit -m "feat: add videoScript column to shots table"
```

---

### Task 2: Update `shot-split.ts` — add `videoScript` to system prompt

**Files:**
- Modify: `src/lib/ai/prompts/shot-split.ts`

The `SHOT_SPLIT_SYSTEM` constant needs `videoScript` added to the output JSON spec, with a bad/good example pair so the LLM learns the correct terse format.

- [ ] **Step 1: Add `videoScript` to the JSON schema block**

In `src/lib/ai/prompts/shot-split.ts`, find the JSON array spec block (around line 6–22). Add `videoScript` after `motionScript`:

```typescript
// Find:
    "motionScript": "Complete action script describing what happens from first frame to last frame",

// After it add:
    "videoScript": "Concise 1-2 sentence motion description for video generation model (see requirements below)",
```

- [ ] **Step 2: Add `videoScript` requirements section**

After the `=== motionScript requirements ===` section (after line ~53), add a new section:

```
=== videoScript requirements ===
- PURPOSE: feeds directly into the video generation model (Kling, etc.) — optimized for smooth interpolation
- FORMAT: 1-2 sentences max. "[character action]. Camera [start state], smoothly [movement] to [end state]."
- RULES: No time-segmented timestamps. No physics details. No multi-layer descriptions. Only core motion intent and camera arc.
- LANGUAGE: Same language as the screenplay (same rule as motionScript)
- BAD (too dense, has timestamps): "0-2s: The iron beast plants its right foreleg with a bone-shaking thud, spider-web cracks radiating outward; camera low-angle wide, slowly tilting up. 2-4s: ..."
- GOOD (concise, no timestamps): "机械巨兽抬爪猛击地面，碎石四溅。摄像机从低角度广角平滑上仰至中景。"
- GOOD (English): "The mechanical beast slams its claw down as debris scatters. Camera smoothly tilts up from low-angle wide to mid-shot."
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/prompts/shot-split.ts
git commit -m "feat: add videoScript field to shot-split system prompt"
```

---

### Task 3: Rewrite `buildVideoPrompt` in `video-generate.ts`

**Files:**
- Modify: `src/lib/ai/prompts/video-generate.ts`

Replace the current function entirely. The new function keeps `sceneDescription` and `characterDescriptions` in the signature (they are already unused — keeping them avoids touching call sites before Task 4) but does not include them in output. The primary motion source switches from `motionScript` to `videoScript`.

- [ ] **Step 1: Rewrite the function**

Replace the entire content of `src/lib/ai/prompts/video-generate.ts` with:

```typescript
export function buildVideoPrompt(params: {
  videoScript: string;
  cameraDirection: string;
  startFrameDesc?: string;
  endFrameDesc?: string;
  sceneDescription?: string;       // kept for call-site compatibility, not used in output
  duration?: number;
  characterDescriptions?: string;  // kept for call-site compatibility, not used in output
  dialogues?: Array<{ characterName: string; text: string }>;
}): string {
  const lines: string[] = [];

  lines.push(`Smoothly interpolate from the first frame to the last frame.`);
  lines.push(``);
  lines.push(`[MOTION]`);
  lines.push(params.videoScript);
  lines.push(``);
  lines.push(`[CAMERA]`);
  lines.push(params.cameraDirection);

  const hasStart = !!params.startFrameDesc;
  const hasEnd = !!params.endFrameDesc;
  if (hasStart || hasEnd) {
    lines.push(``);
    lines.push(`[FRAME ANCHORS]`);
    if (hasStart) lines.push(`Opening frame: ${params.startFrameDesc}`);
    if (hasEnd) lines.push(`Closing frame: ${params.endFrameDesc}`);
  }

  if (params.dialogues?.length) {
    lines.push(``);
    lines.push(`[DIALOGUE]`);
    for (const d of params.dialogues) {
      lines.push(`- ${d.characterName} says: "${d.text}"`);
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | head -20
```
Expected: no errors. The old `motionScript` param is removed; existing call sites will fail type-check — that is expected and will be fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/prompts/video-generate.ts
git commit -m "feat: rewrite buildVideoPrompt with frame anchors and videoScript"
```

---

### Task 4: Update `generate/route.ts` — shot-split and shot-rewrite handlers

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

Two handlers need updating in this task: `handleShotSplitStream` (persist `videoScript` from parsed JSON) and `handleSingleShotRewrite` (generate and persist `videoScript`).

- [ ] **Step 1: Update `handleShotSplitStream` — extend parsed type and persist**

Find the `parsedShots` type definition inside `onFinish` (around line 451). Add `videoScript` to the type:

```typescript
// Find:
const parsedShots = JSON.parse(extractJSON(text)) as Array<{
  sequence: number;
  sceneDescription: string;
  startFrame: string;
  endFrame: string;
  motionScript: string;
  duration: number;
  dialogues: Array<{ character: string; text: string }>;
  cameraDirection?: string;
}>;

// Replace with:
const parsedShots = JSON.parse(extractJSON(text)) as Array<{
  sequence: number;
  sceneDescription: string;
  startFrame: string;
  endFrame: string;
  motionScript: string;
  videoScript?: string;
  duration: number;
  dialogues: Array<{ character: string; text: string }>;
  cameraDirection?: string;
}>;
```

- [ ] **Step 2: Persist `videoScript` when inserting shots**

Find the `db.insert(shots).values({...})` call (around line 464). Add `videoScript`:

```typescript
// Find:
await db.insert(shots).values({
  id: shotId,
  projectId,
  sequence: shot.sequence,
  prompt: shot.sceneDescription,
  startFrameDesc: shot.startFrame,
  endFrameDesc: shot.endFrame,
  motionScript: shot.motionScript,
  cameraDirection: shot.cameraDirection || "static",
  duration: shot.duration,
});

// Replace with:
await db.insert(shots).values({
  id: shotId,
  projectId,
  sequence: shot.sequence,
  prompt: shot.sceneDescription,
  startFrameDesc: shot.startFrame,
  endFrameDesc: shot.endFrame,
  motionScript: shot.motionScript,
  videoScript: shot.videoScript ?? null,
  cameraDirection: shot.cameraDirection || "static",
  duration: shot.duration,
});
```

- [ ] **Step 3: Update `handleSingleShotRewrite` — add `videoScript` to rewrite prompt**

Find the inline rewrite prompt string (around line 535). Add `videoScript` to the input and output:

```typescript
// Find the prompt string starting with:
const prompt = `You are a storyboard director. Rewrite the text fields for a single shot...

Current shot (sequence ${shot.sequence}):
- Scene description: ${shot.prompt || ""}
- Start frame: ${shot.startFrameDesc || ""}
- End frame: ${shot.endFrameDesc || ""}
- Motion script: ${shot.motionScript || ""}
- Camera direction: ${shot.cameraDirection || "static"}
- Duration: ${shot.duration}s

// Replace with:
const prompt = `You are a storyboard director. Rewrite the text fields for a single shot so the descriptions are vivid, safe for AI image generation, and free of any potentially sensitive content.

Current shot (sequence ${shot.sequence}):
- Scene description: ${shot.prompt || ""}
- Start frame: ${shot.startFrameDesc || ""}
- End frame: ${shot.endFrameDesc || ""}
- Motion script: ${shot.motionScript || ""}
- Video script: ${shot.videoScript || ""}
- Camera direction: ${shot.cameraDirection || "static"}
- Duration: ${shot.duration}s
```

- [ ] **Step 4: Add `videoScript` to the rewrite output schema**

Find the `Return ONLY a JSON object` block in the same prompt. Add `videoScript`:

```typescript
// Find:
Return ONLY a JSON object (no markdown fences) with these fields:
{
  "prompt": "rewritten scene description",
  "startFrameDesc": "rewritten start frame description",
  "endFrameDesc": "rewritten end frame description",
  "motionScript": "rewritten motion script in time-segmented format (0-Xs: ... Xs-Ys: ...)",
  "cameraDirection": "camera direction (keep original or adjust)"
}

// Replace with:
Return ONLY a JSON object (no markdown fences) with these fields:
{
  "prompt": "rewritten scene description",
  "startFrameDesc": "rewritten start frame description",
  "endFrameDesc": "rewritten end frame description",
  "motionScript": "rewritten motion script in time-segmented format (0-Xs: ... Xs-Ys: ...)",
  "videoScript": "rewritten concise video model prompt: 1-2 sentences, no timestamps, just core motion and camera arc",
  "cameraDirection": "camera direction (keep original or adjust)"
}
```

- [ ] **Step 5: Update the `parsed` type and `db.update` in `handleSingleShotRewrite`**

Find the `parsed` type declaration (around line 564):

```typescript
// Find:
const parsed = JSON.parse(extractJSON(text)) as {
  prompt: string;
  startFrameDesc: string;
  endFrameDesc: string;
  motionScript: string;
  cameraDirection: string;
};

// Replace with:
const parsed = JSON.parse(extractJSON(text)) as {
  prompt: string;
  startFrameDesc: string;
  endFrameDesc: string;
  motionScript: string;
  videoScript?: string;
  cameraDirection: string;
};
```

Find the `db.update(shots).set({...})` call (around line 573):

```typescript
// Find:
await db
  .update(shots)
  .set({
    prompt: parsed.prompt,
    startFrameDesc: parsed.startFrameDesc,
    endFrameDesc: parsed.endFrameDesc,
    motionScript: parsed.motionScript,
    cameraDirection: parsed.cameraDirection,
  })
  .where(eq(shots.id, shotId));

// Replace with:
await db
  .update(shots)
  .set({
    prompt: parsed.prompt,
    startFrameDesc: parsed.startFrameDesc,
    endFrameDesc: parsed.endFrameDesc,
    motionScript: parsed.motionScript,
    videoScript: parsed.videoScript ?? null,
    cameraDirection: parsed.cameraDirection,
  })
  .where(eq(shots.id, shotId));
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: persist videoScript in shot-split and shot-rewrite handlers"
```

---

### Task 5: Update `generate/route.ts` — all four video generation handlers

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

Update `handleSingleVideoGenerate`, `handleBatchVideoGenerate`, `handleSingleReferenceVideo`, and `handleBatchReferenceVideo` to use the new `buildVideoPrompt` signature. The old `motionScript` param is replaced by `videoScript` (with fallback chain: `videoScript ?? motionScript ?? prompt`). Add `startFrameDesc` and `endFrameDesc` params.

**Fallback helper** — define once near the top of each handler block or as a local inline expression:
```typescript
const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
```

- [ ] **Step 1: Update `handleSingleVideoGenerate`**

Find the `videoPrompt` construction block (around line 856):

```typescript
// Find:
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

// Replace with:
const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
const videoPrompt = buildVideoPrompt({
  videoScript,
  cameraDirection: shot.cameraDirection || "static",
  startFrameDesc: shot.startFrameDesc ?? undefined,
  endFrameDesc: shot.endFrameDesc ?? undefined,
  duration: shot.duration ?? 10,
  dialogues: dialogueList.length > 0 ? dialogueList : undefined,
});
```

- [ ] **Step 2: Update `handleBatchVideoGenerate`**

Find the `videoPrompt` construction block inside the `for (const shot of eligible)` loop (around line 942):

```typescript
// Find:
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

// Replace with:
const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
const videoPrompt = buildVideoPrompt({
  videoScript,
  cameraDirection: shot.cameraDirection || "static",
  startFrameDesc: shot.startFrameDesc ?? undefined,
  endFrameDesc: shot.endFrameDesc ?? undefined,
  duration: shot.duration ?? 10,
  dialogues: dialogueList.length > 0 ? dialogueList : undefined,
});
```

- [ ] **Step 3: Update `handleSingleReferenceVideo`**

Find the `videoPrompt` construction block (around line 1239):

```typescript
// Find:
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

// Replace with:
const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
const videoPrompt = buildVideoPrompt({
  videoScript,
  cameraDirection: shot.cameraDirection || "static",
  startFrameDesc: shot.startFrameDesc ?? undefined,
  endFrameDesc: shot.endFrameDesc ?? undefined,
  duration: shot.duration ?? 10,
  dialogues: dialogueList.length > 0 ? dialogueList : undefined,
});
```

- [ ] **Step 4: Update `handleBatchReferenceVideo`**

Find the `videoPrompt` construction block inside the `for (const shot of eligible)` loop (around line 1381):

```typescript
// Find:
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

// Replace with:
const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
const videoPrompt = buildVideoPrompt({
  videoScript,
  cameraDirection: shot.cameraDirection || "static",
  startFrameDesc: shot.startFrameDesc ?? undefined,
  endFrameDesc: shot.endFrameDesc ?? undefined,
  duration: shot.duration ?? 10,
  dialogues: dialogueList.length > 0 ? dialogueList : undefined,
});
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: use videoScript with frame anchors in all video generation handlers"
```

---

### Task 6: Smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm dev
```

- [ ] **Step 2: Verify migration ran**

Check server startup logs — should see migration `0006_add_video_script` applied without errors.

- [ ] **Step 3: Manual verification checklist**

Open a project and:
1. Run **shot split** on a script → confirm shots are created without errors; `videoScript` field will be `null` for now (model generates it after Task 2 prompt change is live)
2. Run **single video generate** on a shot with an existing `motionScript` → verify the request succeeds (fallback chain works)
3. Optionally run a new shot split → inspect the DB to confirm `videoScript` is being populated with a short 1-2 sentence string

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git add -p
git commit -m "fix: cleanup after video prompt smooth motion implementation"
```
