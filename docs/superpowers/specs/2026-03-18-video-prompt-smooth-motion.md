# Spec: Video Prompt Smooth Motion Optimization

**Date:** 2026-03-18
**Status:** Approved

## Problem

First-last frame video generation produces abrupt, unnatural camera movements. Root causes:

1. **Conflicting camera instructions** — `buildVideoPrompt` outputs both `motionScript` (which embeds per-segment camera descriptions like "camera slams to ground-level") and a separate `Camera: {cameraDirection}` line. Video models receive contradictory instructions.
2. **No start/end state bridging** — The video prompt doesn't tell the model "start from this visual state, end at this visual state." The model guesses the interpolation path.
3. **`motionScript` is too dense for video models** — The 50–80 word time-segmented format is great for human storyboard reading but produces noise for video generation models like Kling.

**Note:** `sceneDescription` and `characterDescriptions` are already accepted but unused in the current `buildVideoPrompt` implementation (they do not appear in the output). This spec makes their handling explicit.

## Solution

Three coordinated changes applied to both keyframe mode and reference mode.

---

### 1. New `videoScript` field (shot_split → DB → video prompt)

**What it is:** A concise 1–2 sentence motion description optimized for video generation models. Written alongside `motionScript` during shot splitting. Format:

> `"[character action summary]. Camera [starting state], smoothly [movement type] to [ending state]."`

**Language rule:** `videoScript` follows the same language rule as `motionScript` — it must be in the same language as the screenplay. Non-English screenplays produce non-English `videoScript`. Only `cameraDirection` stays English.

**What it is NOT:** No time-segmented timestamps, no physics details, no multi-layer descriptions. Just the core motion intent and camera arc.

**Bad example (don't write this):**
> `"0-2s: The iron beast plants its right foreleg with a bone-shaking thud, spider-web cracks radiating six meters outward, camera low-angle wide, slowly tilting up. 2-4s: ..."`

**Good example (write this):**
> `"机械巨兽抬爪猛击地面，四周碎石飞溅。摄像机从低角度广角平滑上仰至中景。"`
> or in English: `"The mechanical beast slams its claw into the ground as debris flies outward. Camera smoothly tilts up from low-angle wide to mid-shot."`

**`motionScript` is unchanged** — still stored in DB, still displayed in the storyboard editor for human reading/editing. Removed only from the video generation prompt.

**Null fallback:** For shots created before this migration where `videoScript` is null, `buildVideoPrompt` falls back to `motionScript`. If both are null, falls back to `shot.prompt`.

---

### 2. Restructured `buildVideoPrompt`

New signature:
```typescript
buildVideoPrompt(params: {
  videoScript: string;              // replaces motionScript as primary motion description
  cameraDirection: string;
  startFrameDesc?: string;          // injected from shot.startFrameDesc
  endFrameDesc?: string;            // injected from shot.endFrameDesc
  sceneDescription?: string;        // kept but not output (reserved for future use)
  duration?: number;
  characterDescriptions?: string;   // kept but not output (characters visible in frames)
  dialogues?: Array<{ characterName: string; text: string }>;
})
```

`sceneDescription` and `characterDescriptions` are kept in the signature to avoid breaking call sites but are intentionally not included in the prompt output — character appearance is already communicated via the visual frames, and scene context is covered by `startFrameDesc`/`endFrameDesc`.

New output structure:
```
Smoothly interpolate from the first frame to the last frame.

[MOTION]
{videoScript}

[CAMERA]
{cameraDirection}

[FRAME ANCHORS]
Opening frame: {startFrameDesc}
Closing frame: {endFrameDesc}

[DIALOGUE]
- {characterName} says: "{text}"
```

- `[DIALOGUE]` section is omitted if no dialogues.
- `[FRAME ANCHORS]` section: if both `startFrameDesc` and `endFrameDesc` are absent, the section is omitted. If only one is present, render only that line (e.g., `Opening frame: ...` without `Closing frame:`).

---

### 3. Route and DB changes

**DB migration:** `drizzle/0006_add_video_script.sql` — add nullable `videoScript TEXT` column to `shots` table.

**`SHOT_SPLIT_SYSTEM` prompt:** Add `videoScript` to the output JSON spec with the format requirements and bad/good example pair above.

**`handleShotSplit` handler:** Extract `videoScript` from parsed JSON and persist to DB.

**`handleSingleShotRewrite` handler:** Add `videoScript` to the rewrite prompt's input fields and expected output schema. Persist `videoScript` on update.

**`handleSingleVideoGenerate` / `handleBatchVideoGenerate`:** Pass `videoScript` (with fallback logic), `startFrameDesc`, `endFrameDesc` from the shot record into `buildVideoPrompt`.

**`handleSingleReferenceVideo` / `handleBatchReferenceVideo`:** Same change — these also call `buildVideoPrompt` and have the same abrupt-camera problem. Include in scope.

---

## Files Affected

| File | Change |
|------|--------|
| `drizzle/0006_add_video_script.sql` | New migration: add `videoScript` column to `shots` |
| `drizzle/meta/_journal.json` | Add migration entry for index 6 |
| `src/lib/db/schema.ts` | Add `videoScript` field to `shots` table definition |
| `src/lib/ai/prompts/shot-split.ts` | Add `videoScript` to `SHOT_SPLIT_SYSTEM` JSON spec + bad/good example |
| `src/lib/ai/prompts/video-generate.ts` | Rewrite `buildVideoPrompt` with new signature and output structure |
| `src/app/api/projects/[id]/generate/route.ts` | Update: shot-split handler, shot-rewrite handler, single/batch video handlers, single/batch reference video handlers |

## Non-Goals

- No changes to `buildFirstFramePrompt` or `buildLastFramePrompt`
- No changes to `motionScript` format in `SHOT_SPLIT_SYSTEM`
- No UI changes — `videoScript` is backend-only
- No changes to scene frame generation (`buildSceneFramePrompt`)
