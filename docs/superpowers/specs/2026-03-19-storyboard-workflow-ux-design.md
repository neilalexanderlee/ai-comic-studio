# Storyboard Workflow UX Improvements

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Three additive UX improvements to the storyboard module to reduce manual tab-switching and accordion-management friction.

---

## Problem

The storyboard workflow requires too much manual navigation:

1. **Shot editing is fragmented** — modifying a single shot requires manually expanding/collapsing 4 separate accordion sections per card. When reviewing 10–20 shots this is repetitive.
2. **Cross-module tab switching** — in reference mode, users must navigate between the Characters page and Storyboard page to manage reference images, losing their scroll position each time.
3. **No pipeline progress overview** — users cannot see at a glance which shots are blocked at which pipeline stage. They must scroll through all cards to find shots that need attention.

---

## Solution Overview

Three additive features, all on the Storyboard page. No routes are removed; the Characters page remains intact.

---

## Feature A: Shot Edit Drawer

### Behavior

- Clicking the header area of a Shot Card opens a right-side drawer (fixed width ~420px, full viewport height)
- The Shot Card list collapses to a compact "row" mode while the drawer is open
- The drawer displays all pipeline steps fully expanded (no accordion) in a single scrollable panel
- Arrow buttons at the top of the drawer navigate to the previous/next shot without closing
- Closing the drawer (× button or Escape key) returns keyboard focus to the compact row that was active
- Per-shot generate actions inside the drawer use the drawer's own local generating state; they do not set the page-level `anyGenerating` flag. However, if `anyGenerating` is already true (a batch is running), drawer generate buttons are disabled.
- The drawer receives and forwards `selectedVersionId` from `StoryboardPage` to all generate API calls, matching the same `versionId` forwarding done by the batch handlers.

### Drawer Layout

```
┌─────────────────────────────────────────────┐
│  Shot 3  ←  →                             × │
├─────────────────────────────────────────────┤
│  [Step 1: Text]                             │
│  Scene description textarea                 │
│  Start frame / End frame textareas          │
│  Motion script textarea                     │
│  Camera direction input                     │
│  Dialogues (read-only list)                 │
│  [Rewrite] button                           │
├─────────────────────────────────────────────┤
│  [Step 2: Frames]                           │
│  Thumbnail pair (or scene ref frame)        │
│  [Generate] / [Regenerate] buttons          │
├─────────────────────────────────────────────┤
│  [Step 3: Video Prompt]                     │
│  Editable textarea (monospace)              │
│  [Generate] / [Regenerate] buttons          │
├─────────────────────────────────────────────┤
│  [Step 4: Video]                            │
│  Video player thumbnail                     │
│  [Generate] / [Regenerate] buttons          │
└─────────────────────────────────────────────┘
```

### Shot List in Compact Mode

When the drawer is open, Shot Cards in the list switch to a compact single-line row:

```
[1] [thumb][thumb][video-thumb]  Scene description...  ●●○○
[2] ...
```

Clicking a row switches the drawer to that shot.

### Components

- New component: `src/components/editor/shot-drawer.tsx`
- `ShotCard` gains an `onOpenDrawer` prop and an `isCompact` prop
- `StoryboardPage` manages `openDrawerShotId: string | null` state

### Data Flow

The drawer reads from the same `project.shots` array already in the Zustand store. Mutations (`patchShot`, generate actions) use the same existing API calls as the card. After mutation, `onUpdate()` triggers `fetchProject` which refreshes the store and re-renders the drawer.

---

## Feature B: Characters Inline Panel

### Behavior

- A collapsible panel appears at the top of the Storyboard control block, above the batch operation rows
- The panel shows all project characters as compact thumbnail cards with their reference image status
- "Generate reference image" uses the `single_character_image` generate action (same as `CharacterCard`) — the inline panel includes an `InlineModelPicker` for the image capability. There is no separate file-upload path; image generation is the only action exposed inline.
- When in reference mode and any character lacks a reference image, the panel auto-expands on page mount; this condition takes precedence over the localStorage-persisted collapsed state (i.e., condition overrides stored value at mount time only — if the user collapses it manually, it stays collapsed until next page mount where the condition re-evaluates).
- Collapse/expand state is persisted to `localStorage` under key `charPanel:${projectId}`
- A "→ Edit in Characters page" link at the panel footer uses the locale-aware absolute path: `/${locale}/project/${projectId}/characters` (mirrors `project-nav.tsx` pattern)

### Panel Layout

```
┌─────────────────────────────────────────────┐
│  👥 Characters  [reference mode badge]   ▲  │
├─────────────────────────────────────────────┤
│  [Aria ✓]  [Marcus ⚠ Generate]  [Elder ✓]  │
│  [InlineModelPicker image]                  │
│                     → Edit in Characters    │
└─────────────────────────────────────────────┘
```

### Components

- New component: `src/components/editor/characters-inline-panel.tsx`
- Does not reuse `CharacterCard` directly (that card is too large); implements its own compact character thumbnail row
- Calls `POST /api/projects/[id]/generate` with `action: "single_character_image"` for generation
- `StoryboardPage` renders this panel inside the control block

### Data Flow

Reads `project.characters` from the store. Generate calls use `apiFetch` with `action: "single_character_image"`. After any mutation, calls `fetchProject` to refresh.

---

## Feature C: Pipeline Kanban View

### Behavior

- A view toggle (List | Kanban) appears in the Storyboard page header, right side
- Kanban view replaces the shot card list with a 4-column horizontal board
- Each column header shows shot count and a "Batch Generate (N)" button
- Shot mini-cards show: sequence number, scene description snippet, and thumbnail if available
- Clicking a shot mini-card opens the Feature A drawer
- View preference is persisted to `localStorage` under key `storyboardView:${projectId}`
- The batch operation control panel (rows 1–4) is hidden in kanban view; batching is done per-column

### Column Assignment Logic

Computed using the same `generationMode`-aware logic as the existing `storyboard/page.tsx`:

| Column | Condition |
|---|---|
| Needs Frames | `!hasFrame` where `hasFrame = !!(sceneRefFrame \|\| firstFrame \|\| lastFrame)` |
| Needs Prompt | `hasFrame && !hasVideoPrompt` |
| Needs Video | `hasVideoPrompt && !hasVideo` |
| Done | `hasVideo` |

`hasVideo` is `generationMode`-aware: in `reference` mode it checks `referenceVideoUrl`; in `keyframe` mode it checks `videoUrl`. This matches `shotsWithVideo` in the existing page code (lines 67–70).

### Column Batch Actions

Batch button handlers are conditioned on `generationMode`, mirroring the existing `handleAutoRun` logic:

| Column | keyframe mode handler | reference mode handler |
|---|---|---|
| Needs Frames | `handleBatchGenerateFrames` | `handleBatchGenerateSceneFrames` |
| Needs Prompt | `handleBatchGenerateVideoPrompts` | `handleBatchGenerateVideoPrompts` |
| Needs Video | `handleBatchGenerateVideos` | `handleBatchGenerateReferenceVideos` |
| Done | — | — |

### Components

- New component: `src/components/editor/shot-kanban.tsx`
- `StoryboardPage` manages `viewMode: "list" | "kanban"` state (localStorage persisted)
- Kanban receives all batch handlers and `anyGenerating` from `StoryboardPage` as props

---

## i18n Keys

All new strings must be added to all four locale files (`en`, `zh`, `ja`, `ko`):

| Key (under `project.*`) | English value |
|---|---|
| `charactersPanel` | Characters |
| `charactersPanelEdit` | Edit in Characters page |
| `viewList` | List |
| `viewKanban` | Kanban |
| `kanbanNeedsFrames` | Needs Frames |
| `kanbanNeedsPrompt` | Needs Prompt |
| `kanbanNeedsVideo` | Needs Video |
| `kanbanDone` | Done |
| `kanbanBatchGenerate` | Generate ({count}) |

---

## Implementation Constraints

- No new API routes required — all features use existing endpoints
- No schema changes required
- No new Zustand stores — all state lives in component state or `localStorage`
- Existing `ShotCard` accordion behavior remains fully intact in list view

---

## File Change Summary

| File | Change |
|---|---|
| `src/components/editor/shot-drawer.tsx` | New — full shot edit drawer |
| `src/components/editor/characters-inline-panel.tsx` | New — inline character panel |
| `src/components/editor/shot-kanban.tsx` | New — kanban board view |
| `src/components/editor/shot-card.tsx` | Add `isCompact` prop + `onOpenDrawer` prop |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Wire up drawer state, inline panel, view toggle |
| `messages/en.json` | New i18n keys |
| `messages/zh.json` | New i18n keys |
| `messages/ja.json` | New i18n keys |
| `messages/ko.json` | New i18n keys |
