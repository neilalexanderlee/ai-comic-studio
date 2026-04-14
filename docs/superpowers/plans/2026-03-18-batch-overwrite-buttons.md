# Batch Overwrite Generation Buttons Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "重新生成所有" overwrite variants for batch frame and batch video generation in both keyframe and reference modes, and rename the existing scene-frames overwrite button.

**Architecture:** Three-task pipeline: (1) backend adds `overwrite` param to three handlers, (2) i18n adds two new keys and updates one value across four locale files, (3) frontend adds state flags, updates handlers, and adds overwrite buttons with per-button spinner logic.

**Tech Stack:** TypeScript, Next.js App Router, next-intl (zh/en/ja/ko), Tailwind CSS, Lucide icons

---

## File Map

| File | Change |
|------|--------|
| `src/app/api/projects/[id]/generate/route.ts` | Add `overwrite` to `handleBatchFrameGenerate` (signature + dispatcher + chain-seed logic) and `handleBatchVideoGenerate` / `handleBatchReferenceVideo` (filter logic) |
| `messages/zh.json` | Add 2 keys, update 1 value |
| `messages/en.json` | Same |
| `messages/ja.json` | Same |
| `messages/ko.json` | Same |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Add 2 state flags, update 3 handlers, add 3 overwrite buttons with spinner conditionals |

---

### Task 1: Backend — add `overwrite` param to batch handlers

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

- [ ] **Step 1: Update dispatcher for `batch_frame_generate` to forward `payload`**

Find (line ~109):
```typescript
if (action === "batch_frame_generate") {
  return handleBatchFrameGenerate(projectId, modelConfig);
}
```

Replace with:
```typescript
if (action === "batch_frame_generate") {
  return handleBatchFrameGenerate(projectId, payload, modelConfig);
}
```

- [ ] **Step 2: Update `handleBatchFrameGenerate` signature and add overwrite/chain-seed logic**

Find the function signature (line ~598):
```typescript
async function handleBatchFrameGenerate(
  projectId: string,
  modelConfig?: ModelConfig
) {
```

Replace with:
```typescript
async function handleBatchFrameGenerate(
  projectId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
```

Then find the inner loop (line ~627, the `for (let i = 0; i < allShots.length; i++)` block). Replace the entire loop with overwrite-aware logic:

```typescript
const overwrite = payload?.overwrite === true;
let previousLastFrame: string | undefined;

for (let i = 0; i < allShots.length; i++) {
  const shot = allShots[i];

  // Skip completed shots in normal mode, but advance the chain from their existing lastFrame
  if (!overwrite && shot.firstFrame && shot.lastFrame) {
    previousLastFrame = shot.lastFrame;
    results.push({
      shotId: shot.id,
      sequence: shot.sequence,
      status: "skipped",
    });
    continue;
  }

  try {
    // ... rest of existing shot generation logic unchanged
```

> Note: the `results` array type should accept `"skipped"` — change `status: string` or add `"skipped"` to the union. The existing type is already `status: string` so no change needed.

- [ ] **Step 3: Add `overwrite` support to `handleBatchVideoGenerate`**

Find the eligible filter (line ~910):
```typescript
const eligible = allShots.filter((s) => s.firstFrame && s.lastFrame && !s.videoUrl);
```

Replace with:
```typescript
const overwrite = payload?.overwrite === true;
const eligible = allShots.filter((s) =>
  s.firstFrame && s.lastFrame && (overwrite || !s.videoUrl)
);
```

- [ ] **Step 4: Add `overwrite` support to `handleBatchReferenceVideo`**

Find the eligible filter (line ~1302):
```typescript
const eligible = allShots.filter(
  (s) => s.status !== "generating" && !s.referenceVideoUrl
);
```

Replace with:
```typescript
const overwrite = payload?.overwrite === true;
const eligible = allShots.filter(
  (s) => s.status !== "generating" && (overwrite || !s.referenceVideoUrl)
);
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: add overwrite param to batch_frame_generate, batch_video_generate, batch_reference_video"
```

---

### Task 2: i18n — add keys and update scene frames overwrite label

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `messages/ja.json`
- Modify: `messages/ko.json`

- [ ] **Step 1: Update `messages/zh.json`**

Add two new keys after `batchGenerateReferenceVideos` and update `batchGenerateSceneFramesOverwrite`:

```json
// Find and update:
"batchGenerateSceneFramesOverwrite": "全部覆盖重新生成",

// Replace with:
"batchGenerateSceneFramesOverwrite": "重新生成所有场景帧",
```

Add after `batchGenerateReferenceVideos`:
```json
"batchGenerateFramesOverwrite": "重新生成所有首尾帧",
"batchGenerateVideosOverwrite": "重新生成所有视频",
```

- [ ] **Step 2: Update `messages/en.json`**

```json
// Update:
"batchGenerateSceneFramesOverwrite": "Regenerate All Scene Frames",

// Add after batchGenerateReferenceVideos:
"batchGenerateFramesOverwrite": "Regenerate All Frames",
"batchGenerateVideosOverwrite": "Regenerate All Videos",
```

- [ ] **Step 3: Update `messages/ja.json`**

```json
// Update:
"batchGenerateSceneFramesOverwrite": "シーンフレーム全再生成",

// Add after batchGenerateReferenceVideos:
"batchGenerateFramesOverwrite": "フレーム全再生成",
"batchGenerateVideosOverwrite": "動画全再生成",
```

- [ ] **Step 4: Update `messages/ko.json`**

```json
// Update:
"batchGenerateSceneFramesOverwrite": "모든 장면 프레임 재생성",

// Add after batchGenerateReferenceVideos:
"batchGenerateFramesOverwrite": "모든 프레임 재생성",
"batchGenerateVideosOverwrite": "모든 영상 재생성",
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 6: Commit**

```bash
git add messages/zh.json messages/en.json messages/ja.json messages/ko.json
git commit -m "feat: add batchGenerateFramesOverwrite and batchGenerateVideosOverwrite i18n keys"
```

---

### Task 3: Frontend — state, handlers, and overwrite buttons

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

- [ ] **Step 1: Add two new state flags**

Find the existing state declarations (lines ~91–96):
```typescript
const [generatingSceneFrames, setGeneratingSceneFrames] = useState(false);
const [sceneFramesOverwrite, setSceneFramesOverwrite] = useState(false);
```

Add two new flags directly after:
```typescript
const [generatingFramesOverwrite, setGeneratingFramesOverwrite] = useState(false);
const [generatingVideosOverwrite, setGeneratingVideosOverwrite] = useState(false);
```

- [ ] **Step 2: Update `handleBatchGenerateFrames` to accept and forward `overwrite`**

Find the function (line ~180):
```typescript
async function handleBatchGenerateFrames() {
  if (!project) return;
  if (!imageGuard()) return;
  setGeneratingFrames(true);

  try {
    const response = await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch_frame_generate",
        modelConfig: getModelConfig(),
      }),
    });
```

Replace with:
```typescript
async function handleBatchGenerateFrames(overwrite = false) {
  if (!project) return;
  if (!imageGuard()) return;
  setGeneratingFramesOverwrite(overwrite);
  setGeneratingFrames(true);

  try {
    const response = await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch_frame_generate",
        payload: { overwrite },
        modelConfig: getModelConfig(),
      }),
    });
```

And at the end of the function, before `fetchProject`, add:
```typescript
setGeneratingFramesOverwrite(false);
```

- [ ] **Step 3: Update `handleBatchGenerateVideos` to accept and forward `overwrite`**

Find the function (line ~207):
```typescript
async function handleBatchGenerateVideos() {
  if (!project) return;
  if (!videoGuard()) return;
  setGeneratingVideos(true);

  try {
    const response = await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch_video_generate",
        payload: { ratio: videoRatio },
        modelConfig: getModelConfig(),
      }),
    });
```

Replace with:
```typescript
async function handleBatchGenerateVideos(overwrite = false) {
  if (!project) return;
  if (!videoGuard()) return;
  setGeneratingVideosOverwrite(overwrite);
  setGeneratingVideos(true);

  try {
    const response = await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch_video_generate",
        payload: { ratio: videoRatio, overwrite },
        modelConfig: getModelConfig(),
      }),
    });
```

Add before `fetchProject` at end:
```typescript
setGeneratingVideosOverwrite(false);
```

- [ ] **Step 4: Update `handleBatchGenerateReferenceVideos` to accept and forward `overwrite`**

Find the function (line ~265):
```typescript
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
```

Replace with:
```typescript
async function handleBatchGenerateReferenceVideos(overwrite = false) {
  if (!project) return;
  if (!videoGuard()) return;
  setGeneratingVideosOverwrite(overwrite);
  setGeneratingVideos(true);

  try {
    const response = await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch_reference_video",
        payload: { ratio: videoRatio, overwrite },
        modelConfig: getModelConfig(),
      }),
    });
```

Add before `fetchProject` at end:
```typescript
setGeneratingVideosOverwrite(false);
```

- [ ] **Step 5: Add overwrite button to keyframe mode — frames section**

Find the existing frames button block (line ~430):
```tsx
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
      {generatingFrames
        ? t("common.generating")
        : t("project.batchGenerateFrames")}
    </Button>
  </>
)}
```

Replace with:
```tsx
{generationMode === "keyframe" && totalShots > 0 && (
  <>
    <InlineModelPicker capability="image" />
    <Button
      onClick={() => handleBatchGenerateFrames(false)}
      disabled={anyGenerating}
      variant={step2Status === "completed" ? "outline" : "default"}
      size="sm"
    >
      {generatingFrames && !generatingFramesOverwrite ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ImageIcon className="h-3.5 w-3.5" />
      )}
      {generatingFrames && !generatingFramesOverwrite
        ? t("common.generating")
        : t("project.batchGenerateFrames")}
    </Button>
    <Button
      onClick={() => handleBatchGenerateFrames(true)}
      disabled={anyGenerating}
      variant="outline"
      size="sm"
    >
      {generatingFrames && generatingFramesOverwrite ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ImageIcon className="h-3.5 w-3.5" />
      )}
      {generatingFrames && generatingFramesOverwrite
        ? t("common.generating")
        : t("project.batchGenerateFramesOverwrite")}
    </Button>
  </>
)}
```

- [ ] **Step 6: Add overwrite button to keyframe mode — videos section**

Find the batch video button (inside the `{totalShots > 0 && ...}` block, generationMode === "keyframe" branch, line ~494):
```tsx
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
```

Replace with:
```tsx
<Button
  onClick={() =>
    generationMode === "reference"
      ? handleBatchGenerateReferenceVideos(false)
      : handleBatchGenerateVideos(false)
  }
  disabled={anyGenerating || (generationMode === "reference" && !hasReferenceImages)}
  variant={step3Status === "completed" ? "outline" : "default"}
  size="sm"
>
  {generatingVideos && !generatingVideosOverwrite ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Sparkles className="h-3.5 w-3.5" />
  )}
  {generatingVideos && !generatingVideosOverwrite
    ? t("common.generating")
    : generationMode === "reference"
      ? t("project.batchGenerateReferenceVideos")
      : t("project.batchGenerateVideos")}
</Button>
<Button
  onClick={() =>
    generationMode === "reference"
      ? handleBatchGenerateReferenceVideos(true)
      : handleBatchGenerateVideos(true)
  }
  disabled={anyGenerating || (generationMode === "reference" && !hasReferenceImages)}
  variant="outline"
  size="sm"
>
  {generatingVideos && generatingVideosOverwrite ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Sparkles className="h-3.5 w-3.5" />
  )}
  {generatingVideos && generatingVideosOverwrite
    ? t("common.generating")
    : t("project.batchGenerateVideosOverwrite")}
</Button>
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/[locale]/project/[id]/storyboard/page.tsx
git commit -m "feat: add batch overwrite buttons for frames and videos in keyframe and reference modes"
```
