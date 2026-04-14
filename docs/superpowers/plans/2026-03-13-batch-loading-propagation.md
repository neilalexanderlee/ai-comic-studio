# Batch Loading Propagation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a batch generation operation runs, individual card buttons show a loading state for cards that are batch targets (need generation).

**Architecture:** Pass batch loading booleans as optional props from parent pages down to card components. Each card derives an `isGenerating` boolean from its own local state OR the batch prop + eligibility check, then applies it to its generate button(s).

**Tech Stack:** React 19, TypeScript, Next.js App Router — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-13-batch-loading-propagation-design.md`

---

## Chunk 1: CharacterCard + characters page

### Task 1: Add batchGenerating prop to CharacterCard

**Files:**
- Modify: `src/components/editor/character-card.tsx`

Current interface (lines 16-23):
```tsx
interface CharacterCardProps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  referenceImage: string | null;
  onUpdate: () => void;
}
```

Current generate button (lines 108-120):
```tsx
<Button
  onClick={handleGenerateImage}
  disabled={generating}
  className="w-full"
  size="sm"
>
  {generating ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Sparkles className="h-3.5 w-3.5" />
  )}
  {generating ? t("common.generating") : t("character.generateImage")}
</Button>
```

- [ ] **Step 1: Add `batchGenerating?` to interface**

Change `CharacterCardProps` to:
```tsx
interface CharacterCardProps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  referenceImage: string | null;
  onUpdate: () => void;
  batchGenerating?: boolean;
}
```

- [ ] **Step 2: Destructure the new prop**

Change the function signature destructuring from:
```tsx
export function CharacterCard({
  id,
  projectId,
  name,
  description,
  referenceImage,
  onUpdate,
}: CharacterCardProps) {
```
to:
```tsx
export function CharacterCard({
  id,
  projectId,
  name,
  description,
  referenceImage,
  onUpdate,
  batchGenerating,
}: CharacterCardProps) {
```

- [ ] **Step 3: Derive `isGenerating` after existing state declarations**

After `const imageGuard = useModelGuard("image");` (line 39), add:
```tsx
const isGenerating = generating || (!!batchGenerating && !referenceImage);
```

- [ ] **Step 4: Update avatar shimmer condition**

The avatar area (line 82) currently shows shimmer only when `generating` is true. Change:
```tsx
) : generating ? (
  <div className="h-24 w-24 rounded-2xl animate-shimmer" />
) : (
```
to:
```tsx
) : isGenerating ? (
  <div className="h-24 w-24 rounded-2xl animate-shimmer" />
) : (
```
This ensures the shimmer also appears during batch generation for cards without an image.

- [ ] **Step 5: Apply `isGenerating` to the generate button**

The button icon and label text must also use `isGenerating` (not just `disabled`) — so the button shows a spinner during both single-card generation AND batch generation for eligible cards.

Replace the generate button JSX (lines 108-120) with:
```tsx
<Button
  onClick={handleGenerateImage}
  disabled={isGenerating}
  className="w-full"
  size="sm"
>
  {isGenerating ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Sparkles className="h-3.5 w-3.5" />
  )}
  {isGenerating ? t("common.generating") : t("character.generateImage")}
</Button>
```

- [ ] **Step 6: Run TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/character-card.tsx
git commit -m "feat: add batchGenerating prop to CharacterCard"
```

---

### Task 2: Pass batchGenerating from characters page

**Files:**
- Modify: `src/app/[locale]/project/[id]/characters/page.tsx`

Current card render (lines 150-159):
```tsx
<CharacterCard
  key={char.id}
  id={char.id}
  projectId={project.id}
  name={char.name}
  description={char.description}
  referenceImage={char.referenceImage}
  onUpdate={() => fetchProject(project.id)}
/>
```

- [ ] **Step 1: Pass batchGenerating prop**

Change the CharacterCard render to:
```tsx
<CharacterCard
  key={char.id}
  id={char.id}
  projectId={project.id}
  name={char.name}
  description={char.description}
  referenceImage={char.referenceImage}
  onUpdate={() => fetchProject(project.id)}
  batchGenerating={generatingImages}
/>
```

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Manual verification**

Start dev server (`pnpm dev`). On the Characters page with at least one character without a reference image:
1. Click "Batch Generate Turnarounds"
2. Confirm each CharacterCard without an image shows the spinning Loader2 and "Generating..." text on its button
3. Confirm CharacterCards that already have an image do NOT show loading

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/project/[id]/characters/page.tsx"
git commit -m "feat: propagate batch image loading state to CharacterCard"
```

---

## Chunk 2: ShotCard + storyboard page

### Task 3: Add batchGeneratingFrames and batchGeneratingVideo props to ShotCard

**Files:**
- Modify: `src/components/editor/shot-card.tsx`

Current interface (lines 31-47):
```tsx
interface ShotCardProps {
  id: string;
  projectId: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
  onUpdate: () => void;
}
```

There are **two** button locations in this file:

**Location A — Collapsed header** (lines 212-238):
```tsx
<Button
  size="xs"
  variant="outline"
  onClick={(e) => { e.stopPropagation(); handleGenerateFrames(); }}
  disabled={generatingFrames || generatingVideo}
>
  {generatingFrames ? (
    <Loader2 className="h-3 w-3 animate-spin" />
  ) : (
    <ImageIcon className="h-3 w-3" />
  )}
  {generatingFrames ? t("common.generating") : t("project.generateFrames")}
</Button>
{firstFrame && lastFrame && (
  <Button
    size="xs"
    onClick={(e) => { e.stopPropagation(); handleGenerateVideo(); }}
    disabled={generatingFrames || generatingVideo}
  >
    {generatingVideo ? (
      <Loader2 className="h-3 w-3 animate-spin" />
    ) : (
      <Sparkles className="h-3 w-3" />
    )}
    {generatingVideo ? t("common.generating") : t("project.generateVideo")}
  </Button>
)}
```

**Location B — Expanded panel** (lines 377-422):
```tsx
<Button
  size="sm"
  variant="outline"
  onClick={handleGenerateFrames}
  disabled={generatingFrames || generatingVideo}
>
  {generatingFrames ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <ImageIcon className="h-3.5 w-3.5" />
  )}
  {generatingFrames ? t("common.generating") : t("project.generateFrames")}
</Button>
...
<Button
  size="sm"
  onClick={handleGenerateVideo}
  disabled={generatingFrames || generatingVideo}
>
  {generatingVideo ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Sparkles className="h-3.5 w-3.5" />
  )}
  {generatingVideo ? t("common.generating") : t("project.generateVideo")}
</Button>
```

- [ ] **Step 1: Add two optional props to ShotCardProps interface**

Change `ShotCardProps` to add at the end (before the closing `}`):
```tsx
  batchGeneratingFrames?: boolean;
  batchGeneratingVideo?: boolean;
```

- [ ] **Step 2: Destructure both new props**

Add `batchGeneratingFrames` and `batchGeneratingVideo` to the function destructuring:
```tsx
export function ShotCard({
  id,
  projectId,
  sequence,
  prompt,
  startFrameDesc,
  endFrameDesc,
  motionScript,
  cameraDirection,
  duration,
  firstFrame,
  lastFrame,
  videoUrl,
  status,
  dialogues,
  onUpdate,
  batchGeneratingFrames,
  batchGeneratingVideo,
}: ShotCardProps) {
```

- [ ] **Step 3: Derive isGeneratingFrames and isGeneratingVideo after existing hook calls**

After `const videoGuard = useModelGuard("video");` (line 87), add:
```tsx
const isGeneratingFrames = generatingFrames || (!!batchGeneratingFrames && !firstFrame && !lastFrame);
const isGeneratingVideo = generatingVideo || (!!batchGeneratingVideo && !!firstFrame && !!lastFrame && !videoUrl);
```

- [ ] **Step 4: Update Location A (collapsed header) — frame button**

Replace:
```tsx
<Button
  size="xs"
  variant="outline"
  onClick={(e) => { e.stopPropagation(); handleGenerateFrames(); }}
  disabled={generatingFrames || generatingVideo}
>
  {generatingFrames ? (
    <Loader2 className="h-3 w-3 animate-spin" />
  ) : (
    <ImageIcon className="h-3 w-3" />
  )}
  {generatingFrames ? t("common.generating") : t("project.generateFrames")}
</Button>
```
with:
```tsx
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
```

- [ ] **Step 5: Update Location A (collapsed header) — video button**

Replace:
```tsx
<Button
  size="xs"
  onClick={(e) => { e.stopPropagation(); handleGenerateVideo(); }}
  disabled={generatingFrames || generatingVideo}
>
  {generatingVideo ? (
    <Loader2 className="h-3 w-3 animate-spin" />
  ) : (
    <Sparkles className="h-3 w-3" />
  )}
  {generatingVideo ? t("common.generating") : t("project.generateVideo")}
</Button>
```
with:
```tsx
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
```

- [ ] **Step 6: Update Location B (expanded panel) — frame button**

Replace:
```tsx
<Button
  size="sm"
  variant="outline"
  onClick={handleGenerateFrames}
  disabled={generatingFrames || generatingVideo}
>
  {generatingFrames ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <ImageIcon className="h-3.5 w-3.5" />
  )}
  {generatingFrames ? t("common.generating") : t("project.generateFrames")}
</Button>
```
with:
```tsx
<Button
  size="sm"
  variant="outline"
  onClick={handleGenerateFrames}
  disabled={isGeneratingFrames || isGeneratingVideo}
>
  {isGeneratingFrames ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <ImageIcon className="h-3.5 w-3.5" />
  )}
  {isGeneratingFrames ? t("common.generating") : t("project.generateFrames")}
</Button>
```

- [ ] **Step 7: Update Location B (expanded panel) — video button**

Replace:
```tsx
<Button
  size="sm"
  onClick={handleGenerateVideo}
  disabled={generatingFrames || generatingVideo}
>
  {generatingVideo ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Sparkles className="h-3.5 w-3.5" />
  )}
  {generatingVideo ? t("common.generating") : t("project.generateVideo")}
</Button>
```
with:
```tsx
<Button
  size="sm"
  onClick={handleGenerateVideo}
  disabled={isGeneratingFrames || isGeneratingVideo}
>
  {isGeneratingVideo ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Sparkles className="h-3.5 w-3.5" />
  )}
  {isGeneratingVideo ? t("common.generating") : t("project.generateVideo")}
</Button>
```

- [ ] **Step 8: Run TypeScript check**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/editor/shot-card.tsx
git commit -m "feat: add batchGeneratingFrames and batchGeneratingVideo props to ShotCard"
```

---

### Task 4: Pass batch states from storyboard page

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

Current ShotCard render (lines 368-387):
```tsx
<ShotCard
  key={shot.id}
  id={shot.id}
  projectId={project.id}
  sequence={shot.sequence}
  prompt={shot.prompt}
  startFrameDesc={shot.startFrameDesc}
  endFrameDesc={shot.endFrameDesc}
  motionScript={shot.motionScript}
  cameraDirection={shot.cameraDirection}
  duration={shot.duration}
  firstFrame={shot.firstFrame}
  lastFrame={shot.lastFrame}
  videoUrl={shot.videoUrl}
  status={shot.status}
  dialogues={shot.dialogues || []}
  onUpdate={() => fetchProject(project.id)}
/>
```

- [ ] **Step 1: Pass both batch props**

Change to:
```tsx
<ShotCard
  key={shot.id}
  id={shot.id}
  projectId={project.id}
  sequence={shot.sequence}
  prompt={shot.prompt}
  startFrameDesc={shot.startFrameDesc}
  endFrameDesc={shot.endFrameDesc}
  motionScript={shot.motionScript}
  cameraDirection={shot.cameraDirection}
  duration={shot.duration}
  firstFrame={shot.firstFrame}
  lastFrame={shot.lastFrame}
  videoUrl={shot.videoUrl}
  status={shot.status}
  dialogues={shot.dialogues || []}
  onUpdate={() => fetchProject(project.id)}
  batchGeneratingFrames={generatingFrames}
  batchGeneratingVideo={generatingVideos}
/>
```

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Manual verification**

On the Storyboard page with multiple shots:
1. Click "Batch Generate Frames" — shots without any frames should show spinning Loader2 on their frame button (both collapsed and expanded). Shots that already have frames should NOT.
2. Click "Batch Generate Videos" — shots with both frames but no video should show spinning Loader2 on their video button. Shots without frames or that already have video should NOT.

- [ ] **Step 4: Final TypeScript check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/project/[id]/storyboard/page.tsx"
git commit -m "feat: propagate batch frame/video loading state to ShotCard"
```
