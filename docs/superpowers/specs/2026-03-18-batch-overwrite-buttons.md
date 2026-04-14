# Spec: Batch Overwrite Generation Buttons

**Date:** 2026-03-18
**Status:** Approved

## Goal

Add "重新生成所有" overwrite variants for batch frame and batch video generation in both keyframe mode and reference mode. Also rename the existing scene-frames overwrite button to match the new naming convention.

## Button Summary

| Location | Button (normal) | Button (overwrite — new) |
|----------|----------------|--------------------------|
| Keyframe mode — frames | 批量生成首尾帧 | 重新生成所有首尾帧 |
| Keyframe mode — videos | 批量生成视频 | 重新生成所有视频 |
| Reference mode — videos | 批量生成视频 | 重新生成所有视频 |
| Reference mode — scene frames (existing rename) | 批量生成场景参考帧 | ~~全部覆盖重新生成~~ → **重新生成所有场景帧** |

## Behavior

**Normal batch (skip completed):**
- Frames: skip shots that already have both `firstFrame` and `lastFrame`; maintain continuity chain from existing frames (see backend detail below)
- Videos (keyframe): skip shots that already have `videoUrl`
- Videos (reference): skip shots that already have `referenceVideoUrl`

**Overwrite batch (regenerate all):**
- Frames: regenerate all shots from scratch, rebuild continuity chain
- Videos (keyframe): regenerate all shots that have `firstFrame` + `lastFrame`
- Videos (reference): regenerate all shots that are not currently generating

## Backend Changes (`route.ts`)

### `batch_frame_generate`

The handler builds a continuity chain where each shot's `lastFrame` becomes the next shot's `firstFrame`. Adding a skip-completed filter must preserve this chain.

**`overwrite=false` (new default behavior — currently handler always regenerates all):**
Iterate all shots in sequence. For each shot:
- If `s.firstFrame && s.lastFrame` already exist: skip generation, but update `previousLastFrame = s.lastFrame` to maintain chain continuity for subsequent shots
- Otherwise: generate normally using `previousLastFrame` as the chain seed

**`overwrite=true` (current behavior):**
Regenerate all shots unconditionally, rebuilding the chain from scratch.

### `batch_video_generate`

- `overwrite=false` (current behavior): `filter(s.firstFrame && s.lastFrame && !s.videoUrl)`
- `overwrite=true`: `filter(s.firstFrame && s.lastFrame)` (removes `!s.videoUrl` condition)

### `batch_reference_video`

- `overwrite=false` (current behavior): `filter(s.status !== "generating" && !s.referenceVideoUrl)`
- `overwrite=true`: `filter(s.status !== "generating")` (removes `!s.referenceVideoUrl`; retains the generating guard to prevent double-generation)

## Frontend Changes (`storyboard/page.tsx`)

### New state

```typescript
const [generatingFramesOverwrite, setGeneratingFramesOverwrite] = useState(false);
const [generatingVideosOverwrite, setGeneratingVideosOverwrite] = useState(false);
```

These flags record which variant (normal vs overwrite) is currently running, enabling per-button spinner targeting.

### Updated handler signatures

```typescript
handleBatchGenerateFrames(overwrite = false)
handleBatchGenerateVideos(overwrite = false)
handleBatchGenerateReferenceVideos(overwrite = false)
```

Each handler sets its overwrite flag before calling the API and clears it afterward:
```typescript
async function handleBatchGenerateFrames(overwrite = false) {
  setGeneratingFramesOverwrite(overwrite);
  setGeneratingFrames(true);
  // ... call batch_frame_generate with payload: { overwrite }
  setGeneratingFrames(false);
  setGeneratingFramesOverwrite(false);
}
```

Same pattern for videos.

### JSX spinner conditional

Each pair of buttons uses the overwrite flag to target the spinner:

**Frames pair (keyframe mode):**
```tsx
{/* Normal */}
<Button onClick={() => handleBatchGenerateFrames(false)} disabled={anyGenerating}>
  {generatingFrames && !generatingFramesOverwrite ? <Loader2 className="animate-spin"/> : <ImageIcon/>}
  {generatingFrames && !generatingFramesOverwrite ? t("common.generating") : t("project.batchGenerateFrames")}
</Button>
{/* Overwrite */}
<Button onClick={() => handleBatchGenerateFrames(true)} disabled={anyGenerating} variant="outline">
  {generatingFrames && generatingFramesOverwrite ? <Loader2 className="animate-spin"/> : <ImageIcon/>}
  {generatingFrames && generatingFramesOverwrite ? t("common.generating") : t("project.batchGenerateFramesOverwrite")}
</Button>
```

Same conditional pattern applies to video pairs (using `generatingVideos` + `generatingVideosOverwrite`).

**Scene frames pair (reference mode — existing buttons, update label only):**
The existing `sceneFramesOverwrite` flag already handles spinner targeting for scene frames — no logic change needed there, only the i18n value update.

### New buttons placement

**Keyframe mode — frames section:**
```
[InlineModelPicker image]  [批量生成首尾帧]  [重新生成所有首尾帧]
```

**Keyframe mode — videos section:**
```
[InlineModelPicker video]  [VideoRatioPicker]  [批量生成视频]  [重新生成所有视频]
```

**Reference mode — videos section:**
```
[InlineModelPicker video]  [VideoRatioPicker]  [批量生成视频]  [重新生成所有视频]
```

**Reference mode — scene frames section (rename existing overwrite button label only):**
```
[批量生成场景参考帧]  [重新生成所有场景帧]
```

## i18n Changes (all 4 locale files)

### New keys (add under `"project"`)

| Key | zh | en | ja | ko |
|-----|----|----|----|----|
| `batchGenerateFramesOverwrite` | 重新生成所有首尾帧 | Regenerate All Frames | フレーム全再生成 | 모든 프레임 재생성 |
| `batchGenerateVideosOverwrite` | 重新生成所有视频 | Regenerate All Videos | 動画全再生成 | 모든 영상 재생성 |

Note: Both keyframe and reference mode overwrite video buttons use the same `batchGenerateVideosOverwrite` key (identical text in all locales; separate keys would be redundant).

### Existing key value update

| Key | Old value (zh) | New value (zh) | Same change in en/ja/ko |
|-----|---------------|----------------|--------------------------|
| `batchGenerateSceneFramesOverwrite` | 全部覆盖重新生成 | 重新生成所有场景帧 | Yes — update all 4 locales |

## Files Affected

| File | Change |
|------|--------|
| `src/app/api/projects/[id]/generate/route.ts` | Add `overwrite` param + chain-seed logic to `batch_frame_generate`; add `overwrite` param to `batch_video_generate` and `batch_reference_video` |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Add 2 new state flags, update 3 handlers, add 3 new overwrite buttons, fix spinner conditionals |
| `messages/zh.json` | Add 2 keys, update 1 key value |
| `messages/en.json` | Same |
| `messages/ja.json` | Same |
| `messages/ko.json` | Same |

## Non-Goals

- No changes to single-shot generation buttons
- No new DB columns or migrations
- `preview/page.tsx` is not in scope (has unrelated in-progress changes)
