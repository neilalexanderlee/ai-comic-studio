# Rich Storyboard Pipeline Redesign

## Problem

The current pipeline produces stiff, unnatural video transitions because:
1. Each shot's `prompt` is a static scene description — no temporal arc
2. First/last frame prompts share the same `shotPrompt`, with only a vague "be different" instruction for the last frame
3. Video generation sends a static description to Seedance — no motion/camera guidance
4. `cameraDirection` is stored but not effectively used in video generation

## Solution: "Rich Storyboard" (方案 A)

Extend the shot data structure so each shot contains a complete narrative script with explicit first/last frame descriptions, motion script, and camera instructions. Then use these specific fields in frame and video generation.

## Design

### 1. Shot Data Structure

**New fields added to `shots` table:**

| Field | Type | Purpose |
|-------|------|---------|
| `startFrameDesc` | text | Detailed first frame description (character positions, poses, expressions, composition, lighting) |
| `endFrameDesc` | text | Detailed last frame description (end state after action completes) |
| `motionScript` | text | Complete action script from start to end (character movements, emotional changes) |

**Existing field changes:**

| Field | Change |
|-------|--------|
| `prompt` | Repurposed as scene/environment description (environment, lighting, mood, color palette) |
| `cameraDirection` | Kept, but shot_split prompt demands more precise instructions |

**Schema change:**
```typescript
export const shots = sqliteTable("shots", {
  // ...existing fields...
  prompt: text("prompt").default(""),              // Now: scene/environment description
  startFrameDesc: text("start_frame_desc"),        // NEW: first frame description
  endFrameDesc: text("end_frame_desc"),            // NEW: last frame description
  motionScript: text("motion_script"),             // NEW: action script
  cameraDirection: text("camera_direction").default("static"),
  // ...rest unchanged...
});
```

### 2. Shot Split Prompt Redesign

The shot_split prompt output format expands to:

```json
[
  {
    "sequence": 1,
    "sceneDescription": "Scene/environment description (setting, lighting, mood, color palette)",
    "startFrame": "Detailed first frame: character positions, poses, expressions, camera framing, composition",
    "endFrame": "Detailed last frame: where characters end up, final expressions, camera position after movement",
    "motionScript": "What happens between start and end: character actions, movements, emotional changes",
    "cameraDirection": "slow push in",
    "duration": 8,
    "dialogues": [{ "character": "Name", "text": "dialogue" }]
  }
]
```

**Key prompt requirements:**
- `startFrame` and `endFrame` must each be self-sufficient for image generation (include composition, character details, lighting)
- `endFrame` must be designed to work as the next shot's starting point (stable state, complete composition)
- `motionScript` describes the full action arc (not just "character moves" but how, why, and the emotional progression)
- Difference between `startFrame` and `endFrame` should be proportional to shot duration (5s = subtle change, 15s = significant change)
- Adjacent shots must consider visual continuity — `endFrame` of shot N should logically connect to `startFrame` of shot N+1

### 3. Frame Generation Prompt Redesign

#### First Frame (buildFirstFramePrompt)

Inputs change from `shotPrompt` to `sceneDescription` + `startFrameDesc`:

```
=== SCENE ENVIRONMENT ===
{sceneDescription}

=== FRAME DESCRIPTION ===
{startFrameDesc}                    ← replaces generic shotPrompt

=== CHARACTER DESCRIPTIONS ===
{characterDescriptions}

=== CONTINUITY REQUIREMENT === (if not first shot)
Previous shot's last frame attached as reference.
- Maintain visual continuity from previous shot's end state
- Consistent character outfits, proportions, lighting
- Natural position transition

=== STYLE/RENDERING ===
(existing style rule and rendering instructions preserved)
```

#### Last Frame (buildLastFramePrompt)

Inputs change from `shotPrompt` + "be different" to `sceneDescription` + `endFrameDesc`:

```
=== SCENE ENVIRONMENT ===
{sceneDescription}

=== FRAME DESCRIPTION ===
{endFrameDesc}                      ← replaces shotPrompt + vague "be different"

=== CHARACTER DESCRIPTIONS ===
{characterDescriptions}

=== RELATIONSHIP TO FIRST FRAME ===
First frame attached as reference.
- Same environment, lighting, color palette
- Identical character appearance
- Character positions and expressions changed per frame description

=== AS NEXT SHOT'S STARTING POINT ===
This frame will be reused as the next shot's opening frame. Ensure:
- Stable state, not mid-motion
- Complete composition that works as standalone frame

=== STYLE/RENDERING ===
(existing instructions preserved)
```

**Key improvement:** No more "must be different" — the exact difference is defined by `endFrameDesc`, which was planned during shot splitting.

### 4. Video Generation Prompt Redesign

New `buildVideoPrompt` function in `src/lib/ai/prompts/video-generate.ts`:

```typescript
export function buildVideoPrompt(params: {
  sceneDescription: string;
  motionScript: string;
  cameraDirection: string;
}): string {
  return `Camera movement: ${params.cameraDirection}

Action: ${params.motionScript}

Scene: ${params.sceneDescription}

Generate a smooth, cinematic video transition from the first frame to the last frame.
The camera movement should be steady and natural.
Character movements should be fluid and match the action description.
Maintain consistent lighting, color grading, and visual style throughout.`;
}
```

**Before:** Seedance receives "Close-up shot of Maya in warehouse..."
**After:** Seedance receives camera movement + action script + scene context

### 5. Pipeline Changes

#### video-generate.ts
- Read new fields (`motionScript`, `cameraDirection`) from shot record
- Use `buildVideoPrompt()` to construct the prompt
- Pass scene description as the `prompt` field renamed to use `sceneDescription`

#### frame-generate.ts
- Read `startFrameDesc`, `endFrameDesc`, `sceneDescription` from shot record
- Pass to updated `buildFirstFramePrompt` and `buildLastFramePrompt`
- Continuity chain preserved: previous shot's last frame still passed as reference

#### shot-split.ts
- Rewrite `SHOT_SPLIT_SYSTEM` to demand the new JSON format
- Emphasize that `endFrame` must be suitable as next shot's first frame
- Emphasize proportional difference based on duration

#### API route (generate/route.ts)
- Update shot creation logic to save new fields from AI response
- Map `sceneDescription` → `prompt`, `startFrame` → `startFrameDesc`, `endFrame` → `endFrameDesc`, `motionScript` → `motionScript`

### 6. Continuity Chain (Preserved)

```
Shot 1: firstFrame(startFrameDesc) → lastFrame(endFrameDesc)
Shot 2: firstFrame = Shot1.lastFrame → lastFrame(endFrameDesc)
Shot 3: firstFrame = Shot2.lastFrame → lastFrame(endFrameDesc)
...
```

The chain is preserved. The key improvement is that each `endFrameDesc` is now explicitly designed to be a valid starting point for the next shot.

### 7. Files to Modify

1. `src/lib/db/schema.ts` — Add 3 new columns
2. `src/lib/ai/prompts/shot-split.ts` — Rewrite system prompt and builder
3. `src/lib/ai/prompts/frame-generate.ts` — Update both prompt builders
4. `src/lib/ai/prompts/video-generate.ts` — New file, buildVideoPrompt
5. `src/lib/pipeline/frame-generate.ts` — Use new fields
6. `src/lib/pipeline/video-generate.ts` — Use buildVideoPrompt
7. `src/app/api/projects/[id]/generate/route.ts` — Save new fields
8. `src/components/editor/shot-card.tsx` — Display new fields (optional)
9. Database migration — Add new columns
