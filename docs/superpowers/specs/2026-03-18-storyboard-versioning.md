# Spec: Storyboard Versioning

**Date:** 2026-03-18
**Status:** Approved

## Goal

Every click of "生成分镜" saves the result as a new version. Users can switch between versions and perform all generation operations (frames, videos, scene frames) independently within each version. Data and file storage are fully isolated by version.

## Version Label Format

`YYYYMMDD-Vx` where `x` is a per-project incrementing integer starting at 1.
Example: `20260318-V1`, `20260318-V2`, `20260319-V3`.

---

## Data Model

### New Table: `storyboard_versions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT | Primary key (CUID) |
| `project_id` | TEXT | FK → `projects.id` (CASCADE DELETE) |
| `label` | TEXT | e.g. `"20260318-V1"` |
| `version_num` | INT | Increments per project (1, 2, 3…) |
| `created_at` | INT | Unix timestamp in seconds (`mode: "timestamp"`, same as `projects.created_at`) |

### `shots` Table: New Column

| Column | Type | Notes |
|--------|------|-------|
| `version_id` | TEXT | FK → `storyboard_versions.id` (CASCADE DELETE), nullable |

`CASCADE DELETE` on `version_id` is intentional: if a version record is deleted, all its shots are also deleted. Version deletion is out of scope for this feature, so this cascade acts as a safety mechanism for future cleanup only.

### No changes to `projects` table

The active version is tracked purely in frontend state (React `useState`), not persisted server-side.

### Migration

Migration `0007_add_storyboard_versions.sql`:

```sql
-- 1. Create the new table
CREATE TABLE storyboard_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  version_num INTEGER NOT NULL,
  created_at INTEGER NOT NULL  -- Unix seconds, same mode as projects.created_at
);

-- 2. Add version_id to shots (nullable for backwards compatibility)
ALTER TABLE shots ADD COLUMN version_id TEXT REFERENCES storyboard_versions(id) ON DELETE CASCADE;

-- 3. Backfill: create a V1 version for each project that already has shots
INSERT INTO storyboard_versions (id, project_id, label, version_num, created_at)
SELECT
  lower(hex(randomblob(16))) AS id,
  p.id AS project_id,
  strftime('%Y%m%d', datetime(p.created_at, 'unixepoch')) || '-V1' AS label,
  1 AS version_num,
  p.created_at AS created_at  -- copy seconds directly
FROM projects p
WHERE EXISTS (SELECT 1 FROM shots s WHERE s.project_id = p.id);

-- 4. Assign existing shots to their project's V1 version
UPDATE shots
SET version_id = (
  SELECT sv.id FROM storyboard_versions sv
  WHERE sv.project_id = shots.project_id AND sv.version_num = 1
)
WHERE version_id IS NULL;
```

---

## Version Lifecycle

### Creating a New Version (shot_split)

1. Query `MAX(version_num)` for the project → N (0 if no versions exist yet).
2. Create `storyboard_versions` record: `version_num = N+1`, `label = "YYYYMMDD-V{N+1}"` (today's date UTC).
3. Insert all new shots with `version_id` pointing to the new record.
4. **Do not delete old shots.** All previous versions remain intact.

The `handleShotSplitStream` function returns a streaming text response (`result.toTextStreamResponse()`). No JSON metadata is returned in the stream. The frontend discovers the new version by calling `fetchProject()` (no `versionId`) after the stream completes — the API returns the latest version by default, and the frontend initialises `selectedVersionId` from `versions[0].id`.

### Switching Versions

Pure frontend state update — no API write. Frontend calls `fetchProject(project.id, versionId)` with the selected `versionId` to load that version's shots.

### Default Version on Page Load

`fetchProject()` with no `versionId` returns the version with the highest `version_num` (latest). If no versions exist (no storyboard generated yet), returns empty shots array and empty `versions` array.

---

## File Path Isolation

### Current Path Structure

All providers write files under a shared `uploadDir` (default `./uploads`), using subdirectories:
- Images/frames: `{uploadDir}/frames/{ulid}.png`
- Videos: `{uploadDir}/videos/{ulid}.mp4`
- Reference images: `{uploadDir}/images/{ulid}.png`

### New Path Structure

Files are written to a version-scoped subdirectory:
- Images/frames: `{baseUploadDir}/projects/{projectId}/{versionLabel}/frames/{ulid}.png`
- Videos: `{baseUploadDir}/projects/{projectId}/{versionLabel}/videos/{ulid}.mp4`
- Reference images: `{baseUploadDir}/projects/{projectId}/{versionLabel}/images/{ulid}.png`

### Implementation Mechanism

All provider classes (`GeminiProvider`, `OpenAIProvider`, `KlingImageProvider`, `KlingVideoProvider`, `VeoProvider`, `SeedanceProvider`) already accept `uploadDir` as a constructor parameter. The fix threads a version-scoped `uploadDir` through the provider factory:

**`provider-factory.ts`** — add optional `uploadDir` param to `createAIProvider`, `createVideoProvider`, `resolveImageProvider`, `resolveVideoProvider`. `resolveAIProvider` (text-only, no file writes) does **not** need `uploadDir`.

```typescript
export function resolveImageProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): AIProvider
export function resolveVideoProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): VideoProvider
```

Each function passes `uploadDir` into the provider constructor when instantiating.

**In all generation handlers** (`route.ts` + `pipeline/video-generate.ts`): before calling `resolveImageProvider` / `resolveVideoProvider`, obtain the version label and build the scoped upload dir:

```typescript
// Fetch versionLabel for the shot being processed
const [version] = await db
  .select({ label: storyboardVersions.label })
  .from(storyboardVersions)
  .where(eq(storyboardVersions.id, shot.version_id!));
const versionLabel = version?.label ?? "unversioned";

const versionedUploadDir = path.join(
  process.env.UPLOAD_DIR || "./uploads",
  "projects", projectId, versionLabel
);

const ai = resolveImageProvider(modelConfig, versionedUploadDir);
// or
const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
```

For batch handlers, the version label is fetched once outside the loop (all shots in a batch share the same version).

---

## API Changes

### `GET /api/projects/[id]`

New optional query parameter: `?versionId=<id>`

- **With `versionId`**: Return shots where `shots.version_id = versionId`.
- **Without `versionId`**: Return shots for the latest version (highest `version_num`). If no versions exist, return empty shots array.
- **Response body additions:**
  ```json
  {
    "versions": [
      { "id": "...", "label": "20260318-V2", "versionNum": 2, "createdAt": 1742300000 },
      { "id": "...", "label": "20260318-V1", "versionNum": 1, "createdAt": 1742200000 }
    ]
  }
  ```
  `createdAt` is Unix seconds (10-digit), matching the `mode: "timestamp"` storage in SQLite.
  Always returned (even when requesting a specific `versionId`), ordered by `version_num` descending (newest first).

### `POST /api/projects/[id]/generate` — `shot_split` action

No change to response format (still a streaming text response). Frontend learns the new version from the subsequent `fetchProject()` call.

### No new endpoints needed for version switching

Version switching is a frontend-only state change followed by `GET /api/projects/[id]?versionId=xxx`.

---

## Frontend Changes

### `src/stores/project-store.ts`

New type:
```typescript
export type StoryboardVersion = {
  id: string;
  label: string;
  versionNum: number;
  createdAt: number;
};
```

`Project` type additions:
```typescript
versions: StoryboardVersion[];   // all versions, newest first
```

**`fetchProject` signature update** — add optional `versionId` second param:
```typescript
// Before:
fetchProject: (id: string) => Promise<void>
// After:
fetchProject: (id: string, versionId?: string) => Promise<void>
```

The implementation passes `versionId` as a query param:
```typescript
fetchProject: async (id: string, versionId?: string) => {
  set({ loading: true });
  const url = `/api/projects/${id}${versionId ? `?versionId=${versionId}` : ""}`;
  const res = await apiFetch(url);
  const data = await res.json();
  set({ project: data, loading: false });
},
```

All existing call sites `fetchProject(project.id)` remain valid (versionId defaults to undefined).

### `src/app/[locale]/project/[id]/storyboard/page.tsx`

**New state:**
```typescript
const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
const [versions, setVersions] = useState<StoryboardVersion[]>([]);
```

`versions` is populated from `project.versions` whenever `project` changes in the store (via a `useEffect` watching `project`). If `selectedVersionId` is null when versions arrive, initialise it to `project.versions[0]?.id ?? null`.

**After `handleGenerateShots` stream completes:** Call `fetchProject(project.id)` with no `versionId` (fetches latest). The new version will appear as `project.versions[0]`; the `useEffect` auto-sets `selectedVersionId` to it.

**When switching versions:** Call `fetchProject(project.id, versionId)` to load that version's shots, then set `selectedVersionId`.

**Version switcher component** — placed in the Step 1 controls row, immediately after the "生成分镜" button:

```tsx
{versions.length > 0 && (
  <Select value={selectedVersionId ?? ""} onValueChange={(v) => {
    setSelectedVersionId(v);
    fetchProject(project!.id, v);
  }}>
    <SelectTrigger size="sm" className="w-36">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {versions.map((v) => (
        <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

Hidden when `versions.length === 0` (no storyboard generated yet).

### Preview Page

`src/app/[locale]/project/[id]/preview/page.tsx` reads `versionId` from URL query param (`searchParams.get("versionId")`), passes it when fetching project shots via `apiFetch`. The storyboard page appends `?versionId={selectedVersionId}` to the preview navigation link.

---

## Files Affected

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `storyboard_versions` table; add `version_id` to `shots` |
| `drizzle/0007_add_storyboard_versions.sql` | Migration SQL (see Data Model section) |
| `drizzle/meta/_journal.json` | Add migration entry for `0007` |
| `src/app/api/projects/[id]/route.ts` | Filter shots by `versionId` query param; include `versions` array in response |
| `src/app/api/projects/[id]/generate/route.ts` | `shot_split`: create version record, bind shots to it; all generation handlers fetch version label and pass version-scoped `uploadDir` to providers |
| `src/lib/ai/provider-factory.ts` | Add optional `uploadDir` param to `createAIProvider`, `createVideoProvider`, `resolveImageProvider`, `resolveVideoProvider` |
| `src/lib/pipeline/video-generate.ts` | Fetch version label from DB; pass version-scoped `uploadDir` to provider |
| `src/stores/project-store.ts` | Add `StoryboardVersion` type; add `versions: StoryboardVersion[]` to `Project` type |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Version state, switcher UI, `fetchProject(versionId?)`, navigation to preview |
| `src/app/[locale]/project/[id]/preview/page.tsx` | Read `versionId` from query params; pass to `apiFetch` |

## Non-Goals

- No server-side persistence of "current version" on the project record.
- No version deletion UI (versions accumulate; cleanup is a future concern).
- No version renaming or descriptions.
- No merging of versions.
- Single-shot rewrite (`single_shot_rewrite`) and individual shot field edits operate on the shot's existing `version_id` — no version branching. No code changes needed for these handlers.
