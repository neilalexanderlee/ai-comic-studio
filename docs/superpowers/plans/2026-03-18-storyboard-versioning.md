# Storyboard Versioning Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every "生成分镜" click creates a new version; users switch between versions with all data and file paths fully isolated per version.

**Architecture:** New `storyboard_versions` table with `version_id` FK on `shots`. Provider factory threads a version-scoped `uploadDir` into all image/video providers. Frontend holds selected version in React state and passes `versionId` in all batch operation payloads.

**Tech Stack:** TypeScript, Next.js 16 App Router, Drizzle ORM (SQLite), Zustand, Tailwind CSS, shadcn/ui Select

---

## File Map

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `storyboardVersions` table; add `versionId` to `shots` |
| `drizzle/0007_add_storyboard_versions.sql` | Migration SQL |
| `drizzle/meta/_journal.json` | Migration journal entry |
| `src/lib/ai/provider-factory.ts` | Add optional `uploadDir` to `createAIProvider`, `createVideoProvider`, `resolveImageProvider`, `resolveVideoProvider` |
| `src/app/api/projects/[id]/route.ts` | Filter shots by `?versionId`; add `versions` array to response |
| `src/app/api/projects/[id]/generate/route.ts` | `shot_split`: create version record; single handlers: version-scoped uploadDir; batch handlers: `versionId` filter + version-scoped uploadDir |
| `src/lib/pipeline/video-generate.ts` | Fetch version label; version-scoped uploadDir |
| `src/stores/project-store.ts` | Add `StoryboardVersion` type; `versions` on `Project`; update `fetchProject` signature |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Version state, `useEffect`, switcher UI, `versionId` in batch payloads |
| `src/app/[locale]/project/[id]/preview/page.tsx` | Read `versionId` from `useSearchParams`; call `fetchProject(id, versionId)` |

---

### Task 1: DB Schema + Migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0007_add_storyboard_versions.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Add `storyboardVersions` table and `versionId` to `shots` in schema.ts**

In `src/lib/db/schema.ts`, add after the `characters` table definition and before `shots`:

```typescript
export const storyboardVersions = sqliteTable("storyboard_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  versionNum: integer("version_num").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

In the `shots` table definition, add after `videoScript`:

```typescript
  versionId: text("version_id").references(() => storyboardVersions.id, {
    onDelete: "cascade",
  }),
```

- [ ] **Step 2: Create migration file `drizzle/0007_add_storyboard_versions.sql`**

```sql
-- 1. Create the new table
CREATE TABLE storyboard_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  version_num INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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
  p.created_at AS created_at
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

- [ ] **Step 3: Add journal entry to `drizzle/meta/_journal.json`**

Add to the `"entries"` array (after the `0006_add_video_script` entry):

```json
{
  "idx": 7,
  "version": "6",
  "when": 1774200000000,
  "tag": "0007_add_storyboard_versions",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0007_add_storyboard_versions.sql drizzle/meta/_journal.json
git commit -m "feat: add storyboard_versions table and version_id to shots"
```

---

### Task 2: Provider Factory — `uploadDir` Threading

**Files:**
- Modify: `src/lib/ai/provider-factory.ts`

- [ ] **Step 1: Add `uploadDir` param to `createAIProvider`**

Find `createAIProvider(config: ProviderConfig)` and replace with:

```typescript
export function createAIProvider(config: ProviderConfig, uploadDir?: string): AIProvider {
  switch (config.protocol) {
    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingImageProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported AI protocol: ${config.protocol}`);
  }
}
```

- [ ] **Step 2: Add `uploadDir` param to `createVideoProvider`**

Find `createVideoProvider(config: ProviderConfig)` and replace with:

```typescript
export function createVideoProvider(config: ProviderConfig, uploadDir?: string): VideoProvider {
  switch (config.protocol) {
    case "seedance":
      return new SeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new VeoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingVideoProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}
```

- [ ] **Step 3: Update `resolveImageProvider` and `resolveVideoProvider` signatures**

Replace:
```typescript
export function resolveImageProvider(modelConfig?: ModelConfigPayload): AIProvider {
  if (modelConfig?.image) {
    return createAIProvider(modelConfig.image);
  }
  return getAIProvider();
}

export function resolveVideoProvider(modelConfig?: ModelConfigPayload): VideoProvider {
  if (modelConfig?.video) {
    return createVideoProvider(modelConfig.video);
  }
  return getVideoProvider();
}
```

With:
```typescript
export function resolveImageProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): AIProvider {
  if (modelConfig?.image) {
    return createAIProvider(modelConfig.image, uploadDir);
  }
  return getAIProvider(uploadDir);
}

export function resolveVideoProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): VideoProvider {
  if (modelConfig?.video) {
    return createVideoProvider(modelConfig.video, uploadDir);
  }
  return getVideoProvider(uploadDir);
}
```

Also update `getAIProvider` and `getVideoProvider` to accept optional `uploadDir` and pass it to the provider constructor. This ensures the fallback path (when no per-request `modelConfig` is provided) also writes files to the version-scoped directory:

```typescript
export function getAIProvider(uploadDir?: string): AIProvider {
  // existing env-var-based config logic, but pass uploadDir to constructor:
  return new SomeProvider({ ...existingConfig, ...(uploadDir && { uploadDir }) });
}
```

(The exact implementation depends on how `getAIProvider`/`getVideoProvider` is currently written — read the file and apply the same `...(uploadDir && { uploadDir })` spread pattern used in `createAIProvider`.)

Note: `resolveAIProvider` (text-only) does NOT get `uploadDir` — it writes no files.

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/provider-factory.ts
git commit -m "feat: add optional uploadDir param to createAIProvider, createVideoProvider, resolveImageProvider, resolveVideoProvider"
```

---

### Task 3: GET /api/projects/[id] — Version-Aware

**Files:**
- Modify: `src/app/api/projects/[id]/route.ts`

- [ ] **Step 1: Add `storyboardVersions` to imports**

Find the import line:
```typescript
import { projects, characters, shots, dialogues } from "@/lib/db/schema";
```

Replace with:
```typescript
import { projects, characters, shots, dialogues, storyboardVersions } from "@/lib/db/schema";
```

Also add `desc` to the drizzle imports:
```typescript
import { eq, asc, and, desc } from "drizzle-orm";
```

- [ ] **Step 2: Read `versionId` from query params and query versions**

In the `GET` handler, after `const project = await resolveProject(id, userId);` and the 404 check, add:

```typescript
  const url = new URL(request.url);
  const versionId = url.searchParams.get("versionId") ?? undefined;

  // Fetch all versions for this project (newest first)
  const allVersions = await db
    .select()
    .from(storyboardVersions)
    .where(eq(storyboardVersions.projectId, id))
    .orderBy(desc(storyboardVersions.versionNum));

  // Resolve which version to show shots for
  const resolvedVersionId = versionId ?? allVersions[0]?.id;
```

- [ ] **Step 3: Filter shots by version**

Replace the current shots query:
```typescript
  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, id))
    .orderBy(asc(shots.sequence));
```

With:
```typescript
  const projectShots = resolvedVersionId
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, id), eq(shots.versionId, resolvedVersionId)))
        .orderBy(asc(shots.sequence))
    : [];
```

- [ ] **Step 4: Add `versions` to the response**

Replace the final `return NextResponse.json(...)`:
```typescript
  return NextResponse.json({
    ...project,
    characters: projectCharacters,
    shots: enrichedShots,
  });
```

With:
```typescript
  return NextResponse.json({
    ...project,
    characters: projectCharacters,
    shots: enrichedShots,
    versions: allVersions.map((v) => ({
      id: v.id,
      label: v.label,
      versionNum: v.versionNum,
      createdAt: v.createdAt instanceof Date ? Math.floor(v.createdAt.getTime() / 1000) : v.createdAt,
    })),
  });
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/[id]/route.ts
git commit -m "feat: filter shots by versionId and include versions array in GET /api/projects/[id]"
```

---

### Task 4: `handleShotSplitStream` — Create Version, Bind Shots

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

- [ ] **Step 1: Add `storyboardVersions` to imports**

Find the schema import line and add `storyboardVersions`:
```typescript
import { projects, shots, characters, dialogues, tasks, storyboardVersions } from "@/lib/db/schema";
```

Also add `path` import near the top of the file (after existing imports):
```typescript
import path from "path";
```

- [ ] **Step 2: Create version record and bind shots in `handleShotSplitStream`**

In `handleShotSplitStream`, inside the `onFinish` callback, before the `for (const shot of parsedShots)` loop, add version creation:

```typescript
        // Create a new version record
        const [maxVersionRow] = await db
          .select({ maxNum: storyboardVersions.versionNum })
          .from(storyboardVersions)
          .where(eq(storyboardVersions.projectId, projectId))
          .orderBy(desc(storyboardVersions.versionNum))
          .limit(1);
        const nextVersionNum = (maxVersionRow?.maxNum ?? 0) + 1;
        const today = new Date();
        const dateStr = today.getUTCFullYear().toString() +
          String(today.getUTCMonth() + 1).padStart(2, "0") +
          String(today.getUTCDate()).padStart(2, "0");
        const versionLabel = `${dateStr}-V${nextVersionNum}`;
        const versionId = ulid();
        await db.insert(storyboardVersions).values({
          id: versionId,
          projectId,
          label: versionLabel,
          versionNum: nextVersionNum,
          createdAt: new Date(),
        });
```

Then in the `db.insert(shots).values({...})` call, add `versionId`:
```typescript
          await db.insert(shots).values({
            id: shotId,
            projectId,
            versionId,        // ← add this line
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

Also add `desc` to the drizzle imports if not already present:
```typescript
import { eq, and, asc, desc, lt, gt, max } from "drizzle-orm";
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: shot_split creates storyboard version and binds shots to it"
```

---

### Task 5: Single Generation Handlers — Version-Scoped `uploadDir`

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

All four single handlers (`handleSingleFrameGenerate`, `handleSingleVideoGenerate`, `handleSingleSceneFrame`, `handleSingleReferenceVideo`) follow the same pattern: they fetch a shot by `shotId`; the shot has `versionId`; get the version label; build `versionedUploadDir`; pass to `resolveImageProvider` / `resolveVideoProvider`.

**Helper pattern** (add once near the top of the file, after imports):

```typescript
async function getVersionedUploadDir(versionId: string | null | undefined): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({ label: storyboardVersions.label, projectId: storyboardVersions.projectId })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(process.env.UPLOAD_DIR || "./uploads", "projects", version.projectId, version.label);
}
```

- [ ] **Step 1: Update `handleSingleFrameGenerate`**

After fetching `shot`, add:
```typescript
  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
```

Change:
```typescript
  const ai = resolveImageProvider(modelConfig);
```
To:
```typescript
  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
```

Also fix the `previousShot` and `nextShot` queries to scope to the same version:

```typescript
  // previousShot — same version only
  const [previousShot] = await db
    .select()
    .from(shots)
    .where(and(
      eq(shots.projectId, projectId),
      eq(shots.versionId, shot.versionId!),
      lt(shots.sequence, shot.sequence)
    ))
    .orderBy(desc(shots.sequence))
    .limit(1);

  const [nextShot] = await db
    .select()
    .from(shots)
    .where(and(
      eq(shots.projectId, projectId),
      eq(shots.versionId, shot.versionId!),
      gt(shots.sequence, shot.sequence)
    ))
    .orderBy(asc(shots.sequence))
    .limit(1);
```

- [ ] **Step 2: Update `handleSingleVideoGenerate`**

After fetching `shot`, add:
```typescript
  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
```

Change:
```typescript
  const videoProvider = resolveVideoProvider(modelConfig);
```
To:
```typescript
  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
```

- [ ] **Step 3: Update `handleSingleSceneFrame`**

Find where `resolveImageProvider(modelConfig)` is called for scene frame generation. After fetching the shot, add `getVersionedUploadDir` and pass to `resolveImageProvider`.

Same pattern: `const ai = resolveImageProvider(modelConfig, await getVersionedUploadDir(shot.versionId));`

- [ ] **Step 4: Update `handleSingleReferenceVideo`**

Same pattern: after fetching `shot`, get `versionedUploadDir`, pass to `resolveVideoProvider`.

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: single generation handlers use version-scoped uploadDir"
```

---

### Task 6: Batch Generation Handlers — `versionId` Filter + Version-Scoped `uploadDir`

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`
- Modify: `src/lib/pipeline/video-generate.ts`

All four batch handlers (`handleBatchFrameGenerate`, `handleBatchVideoGenerate`, `handleBatchSceneFrame`, `handleBatchReferenceVideo`) need to:
1. Read `versionId` from `payload`
2. Filter `allShots` by `versionId`
3. Fetch the version label once
4. Pass `versionedUploadDir` to the provider

- [ ] **Step 1: Update `handleBatchFrameGenerate`**

After the existing checks, replace the shots query:
```typescript
  // OLD:
  const allShots = await db.select().from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  // NEW:
  const batchVersionId = payload?.versionId as string | undefined;
  const allShots = await db.select().from(shots)
    .where(batchVersionId
      ? and(eq(shots.projectId, projectId), eq(shots.versionId, batchVersionId))
      : eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";
```

Change:
```typescript
  const ai = resolveImageProvider(modelConfig);
```
To:
```typescript
  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
```

- [ ] **Step 2: Update `handleBatchVideoGenerate`**

Same pattern: read `batchVersionId` from payload, filter shots, get `versionedUploadDir`, pass to `resolveVideoProvider`.

```typescript
  const batchVersionId = payload?.versionId as string | undefined;
  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";
  // ...
  const overwrite = payload?.overwrite === true;
  const eligible = allShots.filter((s) =>
    s.firstFrame && s.lastFrame && (overwrite || !s.videoUrl)
  );
```

(Where `allShots` is now filtered by `batchVersionId`.)

Pass `versionedUploadDir` to `resolveVideoProvider`.

- [ ] **Step 3: Update `handleBatchSceneFrame` and `handleBatchReferenceVideo`**

Same pattern for both.

- [ ] **Step 4: Update `pipeline/video-generate.ts`**

First, add `path` and `storyboardVersions` to the imports at the top of the file:

```typescript
import path from "path";
import { shots, characters, storyboardVersions } from "@/lib/db/schema";
```

Add the helper (since pipeline can't import from route.ts, define it at the top of the file):
```typescript
async function getVersionedUploadDirFromPipeline(versionId: string | null | undefined): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({ label: storyboardVersions.label, projectId: storyboardVersions.projectId })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(process.env.UPLOAD_DIR || "./uploads", "projects", version.projectId, version.label);
}
```

After fetching `shot`, replace:
```typescript
  const videoProvider = resolveVideoProvider(payload.modelConfig);
```
With:
```typescript
  const versionedUploadDir = await getVersionedUploadDirFromPipeline(shot.versionId);
  const videoProvider = resolveVideoProvider(payload.modelConfig, versionedUploadDir);
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts src/lib/pipeline/video-generate.ts
git commit -m "feat: batch handlers filter by versionId and use version-scoped uploadDir"
```

---

### Task 7: `project-store.ts` — `StoryboardVersion` Type + `fetchProject` Update

**Files:**
- Modify: `src/stores/project-store.ts`

- [ ] **Step 1: Add `StoryboardVersion` type and `versions` to `Project`**

Add after existing interfaces (before `interface ProjectStore`):

```typescript
export type StoryboardVersion = {
  id: string;
  label: string;
  versionNum: number;
  createdAt: number;
};
```

In `interface Project`, add:
```typescript
  versions: StoryboardVersion[];
```

- [ ] **Step 2: Update `fetchProject` signature and implementation**

In `interface ProjectStore`, change:
```typescript
  fetchProject: (id: string) => Promise<void>;
```
To:
```typescript
  fetchProject: (id: string, versionId?: string) => Promise<void>;
```

In the store implementation, change:
```typescript
  fetchProject: async (id: string) => {
    set({ loading: true });
    const res = await apiFetch(`/api/projects/${id}`);
    const data = await res.json();
    set({ project: data, loading: false });
  },
```
To:
```typescript
  fetchProject: async (id: string, versionId?: string) => {
    set({ loading: true });
    const url = `/api/projects/${id}${versionId ? `?versionId=${versionId}` : ""}`;
    const res = await apiFetch(url);
    const data = await res.json();
    set({ project: data, loading: false });
  },
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 4: Commit**

```bash
git add src/stores/project-store.ts
git commit -m "feat: add StoryboardVersion type, versions to Project, versionId param to fetchProject"
```

---

### Task 8: Storyboard Page — Version State, Switcher UI, Batch `versionId` Payloads

**Files:**
- Modify: `src/app/[locale]/project/[id]/storyboard/page.tsx`

- [ ] **Step 1: Add `Select` imports and `StoryboardVersion` import**

Add to the existing shadcn imports at the top:
```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StoryboardVersion } from "@/stores/project-store";
```

- [ ] **Step 2: Add version state and `useEffect`**

After the existing `useState` declarations (around the `generatingSceneFrames` block), add:

```typescript
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<StoryboardVersion[]>([]);
```

Add a `useEffect` that syncs `versions` from `project.versions` and auto-selects the latest when first loaded:

```typescript
  useEffect(() => {
    if (!project?.versions) return;
    setVersions(project.versions);
    // Use functional update to avoid stale closure on selectedVersionId
    // without adding it to the dep array (which causes a race condition
    // when null-reset is called before fetchProject resolves)
    setSelectedVersionId((current) => {
      if (current === null && project.versions!.length > 0) {
        return project.versions![0].id;
      }
      return current;
    });
  }, [project?.versions]);
```

- [ ] **Step 3: Add `versionId` to all batch operation payloads**

In each of the four batch handlers (`handleBatchGenerateFrames`, `handleBatchGenerateVideos`, `handleBatchGenerateSceneFrames`, `handleBatchGenerateReferenceVideos`), add `versionId: selectedVersionId` to the `payload` object in the request body.

For example, in `handleBatchGenerateFrames`:
```typescript
      body: JSON.stringify({
        action: "batch_frame_generate",
        payload: { overwrite, versionId: selectedVersionId },
        modelConfig: getModelConfig(),
      }),
```

Apply the same to the other three batch handlers.

- [ ] **Step 4: After `handleGenerateShots` completes, call `fetchProject` without versionId (loads latest)**

The current code already calls `await fetchProject(project.id)` after shot split completes. This is correct — it fetches the latest version, and the `useEffect` from Step 2 will auto-set `selectedVersionId` to `project.versions[0].id`.

Reset `selectedVersionId` to `null` before the fetch so the `useEffect` re-initialises it to the new latest:

```typescript
    setGenerating(false);
    setSelectedVersionId(null);   // ← add this before fetchProject
    await fetchProject(project.id);
```

- [ ] **Step 5: Update the Step 1 "generate shots" button row with the version switcher**

Find the "生成分镜" `<Button>` in the Step 1 section of the JSX. It's inside the controls row. After the button, add the version switcher:

```tsx
{versions.length > 0 && (
  <Select
    value={selectedVersionId ?? ""}
    onValueChange={(v) => {
      setSelectedVersionId(v);
      fetchProject(project!.id, v);
    }}
  >
    <SelectTrigger size="sm" className="w-36">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {versions.map((v) => (
        <SelectItem key={v.id} value={v.id}>
          {v.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

- [ ] **Step 6: Add or update the preview navigation link with `versionId` query param**

Search for `preview` in the storyboard page file. If a `<Link>` or router push to the preview page already exists, update its href to include `?versionId=${selectedVersionId}`. If no preview link exists yet, create one in the Step 2 controls row (near the "生成分镜" button area) with:

```tsx
<Link
  href={`/${locale}/project/${project!.id}/preview${selectedVersionId ? `?versionId=${selectedVersionId}` : ""}`}
>
  {t("previewButton")}  {/* use existing i18n key or add one */}
</Link>
```

Check what existing navigation to preview looks like in `preview/page.tsx` or any back-navigation links to understand if a button already exists elsewhere in the project UI. If a link already exists on the storyboard page, simply update its href.

- [ ] **Step 7: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 8: Commit**

```bash
git add src/app/[locale]/project/[id]/storyboard/page.tsx
git commit -m "feat: storyboard page version switcher, version state, and versionId in batch payloads"
```

---

### Task 9: Preview Page — `versionId` from Query Params

**Files:**
- Modify: `src/app/[locale]/project/[id]/preview/page.tsx`

The preview page is a `"use client"` component using `useProjectStore`. The layout (`layout.tsx`) calls `fetchProject(id)` on mount (loads latest version). The preview page needs to re-fetch with the specific `versionId` when one is present in the URL.

- [ ] **Step 1: Add `useSearchParams` and `useParams` imports**

The preview page already imports from React. Add:
```typescript
import { useSearchParams, useParams } from "next/navigation";
```

- [ ] **Step 2: Read `versionId` and re-fetch when present**

Inside `PreviewPage`, add after existing hooks:

```typescript
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const versionId = searchParams.get("versionId");

  useEffect(() => {
    if (versionId && params?.id) {
      fetchProject(params.id, versionId);
    }
  }, [versionId, params?.id, fetchProject]);
```

This re-fetches with the specific version when the URL contains `versionId`, overriding whatever the layout loaded.

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder && pnpm tsc --noEmit 2>&1 | grep -v node_modules
```

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/project/[id]/preview/page.tsx
git commit -m "feat: preview page reads versionId from query params and refetches versioned shots"
```
