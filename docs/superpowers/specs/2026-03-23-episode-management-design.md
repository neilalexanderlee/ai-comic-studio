# Episode Management Design Spec

## Overview

Add episode (分集) management to AIComicBuilder. A project becomes a container for multiple episodes, each with its own script-to-video pipeline. Characters are managed at two scopes: project-level "main" characters (consistent across all episodes) and per-episode "guest" characters (auto-appended, promotable).

## Data Model

### New Table: `episodes`

| Field | Type | Description |
|-------|------|-------------|
| `id` | text PK | nanoid |
| `projectId` | text FK → projects | Parent project |
| `title` | text | Episode title |
| `sequence` | integer | Sort order |
| `idea` | text | Episode idea/concept |
| `script` | text | Episode screenplay |
| `status` | text | `draft` / `processing` / `completed` |
| `generationMode` | text | `keyframe` / `reference` |
| `finalVideoUrl` | text | Assembled video for this episode |
| `createdAt` | integer | Timestamp (consistent with existing schema convention) |
| `updatedAt` | integer | Timestamp (consistent with existing schema convention) |

### Modified: `projects`

Fields `idea`, `script`, `status`, `generationMode`, `finalVideoUrl` are **deprecated** at the project level. Code stops reading/writing them; they remain in the table for backward compatibility and can be cleaned up later.

Project becomes a pure container: `id`, `userId`, `title`, `createdAt`, `updatedAt`.

### Modified: `characters`

| New Field | Type | Description |
|-----------|------|-------------|
| `scope` | text | `main` (project-level) or `guest` (episode-level) |
| `episodeId` | text, nullable FK → episodes | null for main characters, set for guests |

- `scope = main`, `episodeId = null` → project-level, visible in all episodes
- `scope = guest`, `episodeId = <id>` → episode-level, visible only in that episode
- `episodeId` FK should have `ON DELETE CASCADE` so deleting an episode auto-removes its guest characters

### Modified: `shots`

| New Field | Type | Description |
|-----------|------|-------------|
| `episodeId` | text FK → episodes | Episode this shot belongs to |

Retains `projectId` for convenience queries.

### Modified: `storyboardVersions`

| New Field | Type | Description |
|-----------|------|-------------|
| `episodeId` | text FK → episodes | Episode this version belongs to |

Versioning is scoped per-episode. Each episode has independent storyboard versions. Version creation, selection, and switching operate within a single episode's context.

### Modified: `tasks`

| New Field | Type | Description |
|-----------|------|-------------|
| `episodeId` | text FK → episodes | Episode this task belongs to |

## Character Management

### Inheritance

Each episode sees: project-level main characters (`scope=main`, `episodeId IS NULL`) + its own guest characters (`scope=guest`, `episodeId=current`).

Query: `WHERE projectId = ? AND (episodeId IS NULL OR episodeId = ?)`

### Auto-Append on Extract

When `character_extract` runs for an episode:

1. AI extracts character list from episode script
2. Match against existing project-level characters by name (fuzzy match for variants like "小明" / "小明同学")
3. Existing match → skip (no duplicate)
4. New character → insert with `scope=guest`, `episodeId=current episode`

### Promotion

- Guest characters display a "Promote to Main" button on their card
- Promotion: set `scope=main`, `episodeId=null`
- Promoted characters become visible in all episodes going forward

### Generation Consistency

- All generation actions (frames, video prompts, videos) inject main characters' `referenceImage` + `visualHint` as global prompt context
- Guest characters are only injected for their episode's generations
- This ensures visual consistency for recurring characters across episodes

### Character Page Behavior

- **Episode list page**: "Manage Main Characters" button opens a drawer showing only `scope=main` characters
- **Episode character page** (step 2 in pipeline): Shows merged list (main + current episode guests)
  - Main characters: editable but not deletable (greyed-out delete button)
  - Guest characters: fully editable, deletable, with "Promote to Main" button
  - Deleting a guest character cascades to their dialogue lines in shots (inherited from existing FK cascade). Delete confirmation dialog should warn about this.

## Routes & Pages

### New Route

- `/[locale]/project/[id]/episodes` — Episode list page (new project home)

### Modified Routes

Existing routes gain `episodeId` segment:

- `/[locale]/project/[id]/episodes/[episodeId]/script`
- `/[locale]/project/[id]/episodes/[episodeId]/characters`
- `/[locale]/project/[id]/episodes/[episodeId]/storyboard`
- `/[locale]/project/[id]/episodes/[episodeId]/preview`

### Episode List Page (`/episodes`)

- Page title: project name
- "Manage Main Characters" button → opens character management drawer (main scope only)
- Draggable episode card list:
  - Episode title (inline editable)
  - Status badge (draft / processing / completed)
  - Thumbnail (first shot's first frame, or placeholder)
  - Click → enter 4-step pipeline for that episode
- "+ New Episode" button at bottom
- Delete button per card (with confirmation dialog)

### Navigation Changes

- `ProjectNav` (4-step tabs): unchanged, but adds a back button to return to episode list
- Dashboard → click project → episode list page (no longer goes directly to script page)

### New API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/projects/[id]/episodes` | GET | List episodes for project |
| `/api/projects/[id]/episodes` | POST | Create new episode |
| `/api/projects/[id]/episodes/[episodeId]` | PATCH | Update episode |
| `/api/projects/[id]/episodes/[episodeId]` | DELETE | Delete episode (cascade shots, guests) |
| `/api/projects/[id]/episodes/reorder` | PUT | Reorder episodes |

### Existing API Adaptation

- Shots, characters, generate APIs add `episodeId` parameter for filtering
- `POST /api/projects/[id]/generate` body includes `episodeId`
- `/api/projects/[id]/download` adds `episodeId` query param (downloads are per-episode since `finalVideoUrl` is on episodes)
- Ownership verification unchanged (project-level userId check)

### Edge Cases

- A project must always have at least one episode. The delete API refuses to delete the last episode.
- Character name matching during `character_extract` is AI-driven (the LLM decides whether a name is a variant of an existing character), not code-level string matching.

## State Management

### New: `episode-store.ts` (Zustand)

- `episodes`: episode list for current project
- `currentEpisodeId`: selected episode
- `fetchEpisodes(projectId)`: load episode list
- `createEpisode(projectId, title)`: create episode
- `deleteEpisode(episodeId)`: delete episode
- `reorderEpisodes(projectId, orderedIds)`: reorder
- `updateEpisode(episodeId, patch)`: update title etc.

### Refactored: `project-store.ts` → episode detail store

Existing `project-store` is refactored to serve episode-level data:

- `fetchProject(id)` → loads only project metadata (no shots/characters)
- New `fetchProjectCharacters(projectId)`: loads main characters for episode list page
- Remove `updateIdea`, `updateScript` (moved to episode level)

The store that powers the 4-step pipeline now scopes to a single episode:

- `episode`: current episode detail (with shots, merged characters)
- `fetchEpisode(projectId, episodeId)`: load episode + shots + characters
- `updateIdea`, `updateScript`: update current episode

**Approach**: Rename and adapt existing `project-store` rather than creating a new store, since it already has the pipeline data management logic.

## Pipeline & Task System

### Task System

- Tasks carry `episodeId` for episode association
- Task enqueueing includes `episodeId` in payload
- Worker processing logic unchanged (still queries by `taskId`)
- Status polling unchanged

### Pipeline Handler Adaptations

| Handler | Change |
|---------|--------|
| `handleScriptParse` | Reads episode's script, writes shots with `episodeId` |
| `handleCharacterExtract` | Extracts characters, deduplicates against project-level, inserts new as `guest` |
| `handleShotSplit` | Filters by `episodeId`, injects merged character list |
| `handleCharacterImage` | No essential change, queries by character id |
| Frame/video generation | Queries scoped by `episodeId`, injects main character context |
| `video_assemble` | Assembles video for single episode by `episodeId` |

### Generate Route

- `POST /api/projects/[id]/generate` accepts `episodeId` in body
- Internally queries shots/characters scoped to that episode
- Ownership verification unchanged (project userId check)

## Data Migration

Migration file: `drizzle/0010_add_episodes.sql`

### Steps (order matters)

1. **Create `episodes` table**
2. **Insert default episodes**: For each existing project, create one episode (`title='第1集'`) inheriting `idea`, `script`, `status`, `generationMode`, `finalVideoUrl` from the project
3. **Add `episodeId` to `shots`**: New column, backfill with the default episode id for each project
4. **Add `scope` + `episodeId` to `characters`**: `scope` defaults to `main`, `episodeId` defaults to null
5. **Add `episodeId` to `storyboardVersions`**: Backfill with default episode id
6. **Add `episodeId` to `tasks`**: Backfill with default episode id
7. **Do NOT drop deprecated project fields** — code stops using them, cleanup later

### Migration Safety

- Create episodes table and insert data first, before adding FK columns to other tables
- All backfills use subqueries to match project → default episode
- Existing single-episode projects continue to work seamlessly after migration
