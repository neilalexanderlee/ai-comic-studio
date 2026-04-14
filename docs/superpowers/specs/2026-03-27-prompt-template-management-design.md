# Prompt Template Management System — Design Spec

## Overview

Add a prompt management system that allows users to customize AI generation prompts at both global and project levels. Users can edit prompts via structured "slots" (simple mode) or full-text editing (advanced mode), with version history, preset templates, and safety validation for protected JSON structures.

## Requirements Summary

- **Granularity**: Hybrid — slot-based editing for quick changes + advanced full-text mode
- **Scope**: Global defaults + per-project overrides (project inherits global, can selectively override)
- **Recovery**: Restore to factory defaults + preset templates (built-in and user-created)
- **Entry Points**: Global settings page (`/settings/prompts`) + project settings tab
- **Editor UX**: Left-right split — slot list on left, editor + live preview on right
- **Advanced Mode**: Full-text editable with safety net — validates JSON structure changes, warns but doesn't block
- **Storage**: SQLite (backend DB), consistent with existing architecture

## Data Model

### New Tables

#### `prompt_templates` — User prompt overrides

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| userId | text NOT NULL | User identifier (fingerprint) |
| promptKey | text NOT NULL | Prompt identifier, e.g. `character_extract`, `shot_split` |
| slotKey | text | Slot identifier, e.g. `art_style_detection`. NULL = full prompt override (advanced mode) |
| scope | text NOT NULL | `global` or `project` |
| projectId | text | Associated project ID when scope=project |
| content | text NOT NULL | User-modified prompt content |
| createdAt | integer NOT NULL | Creation timestamp |
| updatedAt | integer NOT NULL | Last modified timestamp |

Unique constraint: `(userId, promptKey, slotKey, scope, projectId)`

#### `prompt_versions` — Version history

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| templateId | text FK | References prompt_templates.id |
| content | text NOT NULL | Content at this version |
| createdAt | integer NOT NULL | Version timestamp |

#### `prompt_presets` — Preset templates

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| name | text NOT NULL | Preset name, e.g. "电影级", "动漫风" |
| userId | text | NULL = built-in preset, non-NULL = user-created |
| promptKey | text NOT NULL | Which prompt this preset applies to |
| slots | text NOT NULL | JSON object `{slotKey: content}` |
| createdAt | integer NOT NULL | |

### Resolution Priority

```
Project-level override > Global override > Code default
```

When pipeline build functions request a prompt, the resolver checks:
1. `prompt_templates` with `(userId, promptKey, slotKey, scope='project', projectId)` — if found, use it
2. `prompt_templates` with `(userId, promptKey, slotKey, scope='global')` — if found, use it
3. Fall back to code default value from registry

## Prompt Registry (Code Layer)

New file: `src/lib/ai/prompts/registry.ts`

```typescript
type PromptSlot = {
  key: string;           // 'art_style_detection'
  nameKey: string;       // i18n key for slot name
  descriptionKey: string;// i18n key for description
  defaultContent: string;// Default value from code
  editable: boolean;     // false = locked (JSON format, language rules)
};

type PromptDefinition = {
  key: string;           // 'character_extract'
  nameKey: string;       // i18n key for prompt name
  category: 'script' | 'character' | 'storyboard' | 'frame' | 'video';
  slots: PromptSlot[];
  buildFullPrompt: (slotContents: Record<string, string>) => string;
};
```

Each existing prompt's system constant gets decomposed into slots. `buildFullPrompt` reassembles slot contents into the complete prompt string.

### Slot Breakdown

| Prompt (promptKey) | Editable Slots | Locked |
|---|---|---|
| `script_generate` | `role_definition`, `visual_style_section`, `character_section`, `scene_section`, `screenwriting_principles` | Output format, language rules |
| `script_parse` | `role_definition`, `parsing_rules` | JSON output format, language rules |
| `script_split` | `role_definition`, `splitting_rules`, `idea_requirements` | JSON output format |
| `character_extract` | `role_definition`, `style_detection`, `description_requirements`, `scope_rules`, `writing_rules` | JSON output format, language rules |
| `character_image` | `style_matching`, `face_detail`, `four_view_layout`, `lighting_rendering`, `consistency_rules` | Name label format |
| `shot_split` | `role_definition`, `start_end_frame_rules`, `motion_script_rules`, `video_script_rules`, `camera_directions`, `cinematography_principles`, `proportional_tiers` | JSON output format, language rules |
| `frame_generate_first` | `style_matching`, `reference_rules`, `rendering_quality`, `continuity_rules` | — |
| `frame_generate_last` | `style_matching`, `relationship_to_first`, `next_shot_readiness`, `rendering_quality` | — |
| `video_generate` | `interpolation_header`, `dialogue_format`, `frame_anchors` | — |
| `ref_video_generate` | `dialogue_format` | — |
| `ref_video_prompt` | `role_definition`, `motion_rules`, `quality_benchmark` | Language rules |
| `import_character_extract` | `role_definition`, `extraction_rules` | JSON output format, language rules |

Total: ~40+ editable slots across 12 prompts, organized in 5 categories.

## API Design

### Routes

```
# Global prompt template management
GET    /api/prompt-templates                              — List user's global overrides
GET    /api/prompt-templates/registry                     — Get prompt registry (metadata + defaults + slot definitions)
PUT    /api/prompt-templates/:promptKey                   — Save global override
DELETE /api/prompt-templates/:promptKey                   — Reset prompt to defaults

# Project-level overrides
GET    /api/projects/:id/prompt-templates                 — List project overrides
PUT    /api/projects/:id/prompt-templates/:promptKey      — Save project override
DELETE /api/projects/:id/prompt-templates/:promptKey      — Remove project override (fall back to global)

# Version history
GET    /api/prompt-templates/:promptKey/versions          — Get version history
POST   /api/prompt-templates/:promptKey/versions/:vid/restore — Restore to specific version

# Presets
GET    /api/prompt-presets                                — List presets (built-in + user)
POST   /api/prompt-presets                                — Save current config as preset
POST   /api/prompt-presets/:presetId/apply                — Apply preset
DELETE /api/prompt-presets/:presetId                      — Delete user preset

# Utilities
POST   /api/prompt-templates/preview                     — Preview final assembled prompt
POST   /api/prompt-templates/validate                    — Validate full-text edit for structural issues
```

### Request/Response Formats

**PUT save override** — supports two modes:
```typescript
// Slot mode
{ mode: 'slots', slots: { art_style_detection: '...', description_requirements: '...' } }

// Full-text mode (advanced)
{ mode: 'full', content: 'complete prompt text' }
```

**POST validate** — for full-text editing:
```typescript
// Request
{ promptKey: 'character_extract', content: 'user-edited full text' }

// Response
{ valid: true, warnings: ['JSON output format section was modified — may affect downstream parsing'] }
```

**POST preview** — live preview:
```typescript
// Request
{ promptKey: 'character_extract', slots: { art_style_detection: '...' } }

// Response
{ fullPrompt: 'assembled complete prompt', highlights: [{ start: 120, end: 250, slotKey: 'art_style_detection' }] }
```

## Pipeline Integration

Existing prompt build functions are modified minimally. A `resolvePrompt` function is injected:

```typescript
// Before: direct constant usage
const system = CHARACTER_EXTRACT_SYSTEM;

// After: resolver with override lookup
const system = await resolvePrompt('character_extract', { userId, projectId });
```

`resolvePrompt` internally:
1. Queries DB for user overrides (project-level first, then global)
2. Merges with code defaults for any slots without overrides
3. Calls `buildFullPrompt()` to assemble the final prompt
4. Returns the complete prompt string

## UI Design

### 1. Global Settings Page (`/[locale]/settings/prompts`)

Three-column layout:
- **Left column (200px)**: Prompt list grouped by category (剧本生成/角色/分镜/画面/视频). Each item shows name, key, and customization badge.
- **Middle column (170px)**: Slot list for selected prompt. Editable slots shown normally, locked slots shown with lock icon and reduced opacity. Separated by a divider.
- **Right column (flex)**: Split vertically:
  - **Top**: Editor area — textarea with the selected slot's content
  - **Bottom**: Live preview — shows the final assembled prompt with user-modified parts highlighted (coral background)

Header bar contains:
- Prompt name + customization badge
- Slot/Advanced mode toggle (tab component)
- Save button (primary) + Reset to default button (outline)

Top-level bar contains:
- Category filter pills
- Preset templates button + Reset all button

### 2. Project Settings Tab

- Toggle switch: "Use project-specific prompts" (off = use global defaults)
- When enabled: card grid (3 columns) showing all prompts
- Each card shows: icon + name + key + override status badge + slot count + action buttons
- Clicking "Edit" opens the same three-column editor (scoped to this project)
- "Use global" removes project override for that prompt

### 3. Advanced Mode

- Toggled via Slot/Advanced tab switch
- Full prompt text in a single textarea
- Protected regions (JSON output format) highlighted with amber dashed border
- On save: automatic validation checks if protected regions were modified
- If modified: warning toast with "Save anyway" + "Restore this region" actions
- Warning does not block — user can still save

### Visual Style

Follows existing STUDIO NOIR theme:
- Background: `#FAFAF8`, cards: white with `border-[--border]`
- Primary: `#E8553A` for selection states, active tabs, primary buttons
- Badges: 15% opacity backgrounds (success=green, primary=coral, muted=gray, warning=amber)
- Typography: Playfair Display headings, Karla body, JetBrains Mono for prompt content
- Border radius: `rounded-xl` buttons/inputs, `rounded-2xl` cards
- Animations: consistent with existing `animate-page-in`, hover transitions

## Preset Templates

### Built-in Presets (shipped with code)

| Name | Description | Key Differences |
|------|-------------|-----------------|
| **Default** | Current code prompts | Baseline |
| **Cinematic** | Emphasis on live-action film aesthetics | Detailed lighting/composition, stricter cinematography language, photography terminology |
| **Anime** | Optimized for anime/manga generation | Anime-oriented character descriptions, vibrant palette emphasis, cel-shading focus |
| **Minimal** | Lean prompts, save tokens | Remove verbose rhetoric, keep core instructions only, good for rapid prototyping |

### User Presets

- Save current configuration as preset from any editor page
- Option to save all prompts or just the current one
- Export/import as JSON for sharing
- Apply preset with diff preview before confirming

## DB Migration

New migration file: `drizzle/XXXX_add_prompt_templates.sql`

```sql
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt_key TEXT NOT NULL,
  slot_key TEXT,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_prompt_templates_unique
  ON prompt_templates(user_id, prompt_key, COALESCE(slot_key, ''), scope, COALESCE(project_id, ''));

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_prompt_versions_template ON prompt_versions(template_id);

CREATE TABLE IF NOT EXISTS prompt_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT,
  prompt_key TEXT NOT NULL,
  slots TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_prompt_presets_user ON prompt_presets(user_id);
```

## File Structure (New/Modified)

```
src/
  lib/
    ai/prompts/
      registry.ts                    — NEW: prompt definitions, slot metadata, buildFullPrompt functions
      resolver.ts                    — NEW: resolvePrompt() with DB lookup + fallback logic
      (existing files)               — MODIFIED: refactor constants into slot segments
    db/
      schema.ts                      — MODIFIED: add 3 new tables
  app/
    [locale]/
      settings/
        prompts/
          page.tsx                    — NEW: global prompt management page
    api/
      prompt-templates/
        route.ts                     — NEW: GET/list global overrides
        registry/route.ts            — NEW: GET registry metadata
        [promptKey]/
          route.ts                   — NEW: PUT/DELETE global override
          versions/
            route.ts                 — NEW: GET version history
            [vid]/restore/route.ts   — NEW: POST restore version
        preview/route.ts             — NEW: POST preview
        validate/route.ts            — NEW: POST validate
      prompt-presets/
        route.ts                     — NEW: GET/POST presets
        [presetId]/
          route.ts                   — NEW: DELETE preset
          apply/route.ts             — NEW: POST apply preset
      projects/[id]/
        prompt-templates/
          route.ts                   — NEW: GET project overrides
          [promptKey]/route.ts       — NEW: PUT/DELETE project override
  components/
    prompt-templates/
      prompt-editor.tsx              — NEW: main editor component (3-column layout)
      slot-list.tsx                  — NEW: slot list sidebar
      prompt-preview.tsx             — NEW: live preview pane
      advanced-editor.tsx            — NEW: full-text editor with protection
      preset-dialog.tsx              — NEW: preset management dialog
      project-prompt-cards.tsx       — NEW: project-level card grid
  stores/
    prompt-template-store.ts         — NEW: Zustand store for editor state (local only, not persisted)
messages/
  zh.json                            — MODIFIED: add prompt template i18n keys
  en.json                            — MODIFIED: add prompt template i18n keys
  ja.json                            — MODIFIED: add prompt template i18n keys
  ko.json                            — MODIFIED: add prompt template i18n keys
drizzle/
  XXXX_add_prompt_templates.sql      — NEW: migration
  meta/_journal.json                 — MODIFIED: add migration entry
```
