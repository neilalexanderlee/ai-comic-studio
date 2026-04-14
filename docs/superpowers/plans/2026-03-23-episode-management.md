# Episode Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add episode (分集) management so a project contains multiple episodes, each with its own script-to-video pipeline, while maintaining character consistency across episodes.

**Architecture:** Insert an `episodes` layer between `projects` and `shots`. Projects become containers for episodes and main characters. Each episode owns its script, shots, status, and video output. Characters have a `scope` field (`main`/`guest`) determining visibility. Existing routes shift under `/episodes/[episodeId]/`. A new episode list page serves as the project home.

**Tech Stack:** Next.js 16 (App Router), SQLite + Drizzle ORM, Zustand, next-intl, Tailwind CSS v4, ulid

**Spec:** `docs/superpowers/specs/2026-03-23-episode-management-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `drizzle/0010_add_episodes.sql` | Migration: episodes table, alter characters/shots/storyboardVersions/tasks |
| `src/stores/episode-store.ts` | Zustand store for episode list CRUD |
| `src/app/api/projects/[id]/episodes/route.ts` | GET/POST episodes |
| `src/app/api/projects/[id]/episodes/[episodeId]/route.ts` | GET/PATCH/DELETE single episode |
| `src/app/api/projects/[id]/episodes/reorder/route.ts` | PUT reorder episodes |
| `src/app/[locale]/project/[id]/episodes/page.tsx` | Episode list page (project home) |
| `src/components/editor/episode-card.tsx` | Episode card component |
| `src/components/editor/episode-dialog.tsx` | Create/edit episode dialog |
| `src/app/[locale]/project/[id]/episodes/[episodeId]/layout.tsx` | Episode-level layout (loads episode data, renders ProjectNav) |
| `src/app/[locale]/project/[id]/episodes/[episodeId]/script/page.tsx` | Re-exports ScriptEditor |
| `src/app/[locale]/project/[id]/episodes/[episodeId]/characters/page.tsx` | Characters page with scope support |
| `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx` | Re-exports storyboard |
| `src/app/[locale]/project/[id]/episodes/[episodeId]/preview/page.tsx` | Re-exports preview |

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add `episodes` table, add `scope`+`episodeId` to characters, add `episodeId` to shots/storyboardVersions/tasks |
| `drizzle/meta/_journal.json` | Add migration 0010 entry |
| `src/stores/project-store.ts` | Refactor to load episode-scoped data; add `episodeId` param to `fetchProject` |
| `src/components/editor/project-nav.tsx` | Accept `episodeId` prop, update href paths, add back-to-episodes link |
| `src/app/[locale]/project/[id]/layout.tsx` | Remove ProjectNav (moved to episode layout); only load project metadata |
| `src/components/project-card.tsx` | Change link target from `/script` to `/episodes` |
| `src/app/api/projects/[id]/route.ts` | GET returns episodes list; PATCH stops updating idea/script (deprecated at project level) |
| `src/app/api/projects/[id]/characters/route.ts` | Add `scope`+`episodeId` filtering |
| `src/app/api/projects/[id]/generate/route.ts` | Accept `episodeId` in body, scope queries |
| `src/lib/pipeline/character-extract.ts` | Deduplicate against project-level characters, insert with scope+episodeId |
| `src/lib/pipeline/shot-split.ts` | Write `episodeId` on created shots |
| `messages/zh.json`, `messages/en.json`, `messages/ja.json`, `messages/ko.json` | Add episode i18n keys |

---

## Task 1: Database Migration

**Files:**
- Create: `drizzle/0010_add_episodes.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Write migration SQL**

Create `drizzle/0010_add_episodes.sql`:

```sql
-- 1. Create episodes table
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  idea TEXT DEFAULT '',
  script TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  generation_mode TEXT NOT NULL DEFAULT 'keyframe',
  final_video_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2. Insert default episode for each existing project
INSERT INTO episodes (id, project_id, title, sequence, idea, script, status, generation_mode, final_video_url, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  p.id,
  '第1集',
  1,
  COALESCE(p.idea, ''),
  COALESCE(p.script, ''),
  p.status,
  p.generation_mode,
  p.final_video_url,
  CAST(strftime('%s', 'now') AS INTEGER),
  CAST(strftime('%s', 'now') AS INTEGER)
FROM projects p;

-- 3. Add episode_id to shots and backfill
ALTER TABLE shots ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;

UPDATE shots SET episode_id = (
  SELECT e.id FROM episodes e WHERE e.project_id = shots.project_id LIMIT 1
);

-- 4. Add scope and episode_id to characters
ALTER TABLE characters ADD COLUMN scope TEXT NOT NULL DEFAULT 'main';
ALTER TABLE characters ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;

-- 5. Add episode_id to storyboard_versions and backfill
ALTER TABLE storyboard_versions ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;

UPDATE storyboard_versions SET episode_id = (
  SELECT e.id FROM episodes e WHERE e.project_id = storyboard_versions.project_id LIMIT 1
);

-- 6. Add episode_id to tasks and backfill
ALTER TABLE tasks ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;

UPDATE tasks SET episode_id = (
  SELECT e.id FROM episodes e WHERE e.project_id = tasks.project_id LIMIT 1
);
```

- [ ] **Step 2: Update migration journal**

Add entry to `drizzle/meta/_journal.json` entries array:

```json
{
  "idx": 10,
  "version": "6",
  "when": 1774500000000,
  "tag": "0010_add_episodes",
  "breakpoints": true
}
```

- [ ] **Step 3: Update Drizzle schema**

Modify `src/lib/db/schema.ts` — add `episodes` table definition after `projects`, add new columns to existing tables:

```typescript
// Add after projects table definition:
export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sequence: integer("sequence").notNull(),
  idea: text("idea").default(""),
  script: text("script").default(""),
  status: text("status", {
    enum: ["draft", "processing", "completed"],
  })
    .notNull()
    .default("draft"),
  generationMode: text("generation_mode", { enum: ["keyframe", "reference"] })
    .notNull()
    .default("keyframe"),
  finalVideoUrl: text("final_video_url"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Add to characters table:
//   scope: text("scope").notNull().default("main"),
//   episodeId: text("episode_id").references(() => episodes.id, { onDelete: "cascade" }),

// Add to shots table:
//   episodeId: text("episode_id").references(() => episodes.id, { onDelete: "cascade" }),

// Add to storyboardVersions table:
//   episodeId: text("episode_id").references(() => episodes.id, { onDelete: "cascade" }),

// Add to tasks table:
//   episodeId: text("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
```

- [ ] **Step 4: Verify migration runs**

Run: `pnpm dev` (migrations auto-run on server start via `src/lib/bootstrap.ts`)
Expected: Server starts without errors, `episodes` table exists with backfilled data.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0010_add_episodes.sql drizzle/meta/_journal.json src/lib/db/schema.ts
git commit -m "feat: add episodes table and migrate existing data"
```

---

## Task 2: Episode API Routes

**Files:**
- Create: `src/app/api/projects/[id]/episodes/route.ts`
- Create: `src/app/api/projects/[id]/episodes/[episodeId]/route.ts`
- Create: `src/app/api/projects/[id]/episodes/reorder/route.ts`
- Modify: `src/app/api/projects/[id]/route.ts`

- [ ] **Step 1: Create episodes list/create route**

Create `src/app/api/projects/[id]/episodes/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes } from "@/lib/db/schema";
import { eq, asc, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { ulid } from "ulid";

async function resolveProject(id: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return project ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  return NextResponse.json(result);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as { title: string };

  // Get next sequence number
  const existing = await db
    .select({ sequence: episodes.sequence })
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  const nextSeq = existing.length > 0
    ? existing[existing.length - 1].sequence + 1
    : 1;

  const episodeId = ulid();
  const [created] = await db
    .insert(episodes)
    .values({
      id: episodeId,
      projectId: id,
      title: body.title,
      sequence: nextSeq,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 2: Create single episode route**

Create `src/app/api/projects/[id]/episodes/[episodeId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots, characters, dialogues, storyboardVersions } from "@/lib/db/schema";
import { eq, asc, and, or, isNull, desc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

async function resolveProjectAndEpisode(projectId: string, episodeId: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) return null;

  const [episode] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  if (!episode) return null;

  return { project, episode };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  const resolved = await resolveProjectAndEpisode(id, episodeId, userId);
  if (!resolved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { episode } = resolved;

  // Fetch versions for this episode
  const allVersions = await db
    .select()
    .from(storyboardVersions)
    .where(eq(storyboardVersions.episodeId, episodeId))
    .orderBy(desc(storyboardVersions.versionNum));

  const url = new URL(request.url);
  const versionId = url.searchParams.get("versionId") ?? allVersions[0]?.id;

  // Fetch merged characters: main (project-level) + guest (this episode)
  const episodeCharacters = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.projectId, id),
        or(isNull(characters.episodeId), eq(characters.episodeId, episodeId))
      )
    );

  // Fetch shots for this episode + version
  const episodeShots = versionId
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.episodeId, episodeId), eq(shots.versionId, versionId)))
        .orderBy(asc(shots.sequence))
    : await db
        .select()
        .from(shots)
        .where(eq(shots.episodeId, episodeId))
        .orderBy(asc(shots.sequence));

  // Enrich shots with dialogues
  const enrichedShots = await Promise.all(
    episodeShots.map(async (shot) => {
      const shotDialogues = await db
        .select({
          id: dialogues.id,
          text: dialogues.text,
          characterId: dialogues.characterId,
          characterName: characters.name,
          sequence: dialogues.sequence,
        })
        .from(dialogues)
        .innerJoin(characters, eq(dialogues.characterId, characters.id))
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));
      return { ...shot, dialogues: shotDialogues };
    })
  );

  return NextResponse.json({
    ...episode,
    characters: episodeCharacters,
    shots: enrichedShots,
    versions: allVersions.map((v) => ({
      id: v.id,
      label: v.label,
      versionNum: v.versionNum,
      createdAt: v.createdAt instanceof Date ? Math.floor(v.createdAt.getTime() / 1000) : v.createdAt,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  const resolved = await resolveProjectAndEpisode(id, episodeId, userId);
  if (!resolved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    title: string;
    idea: string;
    script: string;
    status: "draft" | "processing" | "completed";
    generationMode: "keyframe" | "reference";
  }>;

  const [updated] = await db
    .update(episodes)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.idea !== undefined && { idea: body.idea }),
      ...(body.script !== undefined && { script: body.script }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.generationMode !== undefined && { generationMode: body.generationMode }),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  const resolved = await resolveProjectAndEpisode(id, episodeId, userId);
  if (!resolved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Prevent deleting the last episode
  const count = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.projectId, id));

  if (count.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last episode" },
      { status: 400 }
    );
  }

  await db.delete(episodes).where(eq(episodes.id, episodeId));
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Create reorder route**

Create `src/app/api/projects/[id]/episodes/reorder/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { orderedIds } = (await request.json()) as { orderedIds: string[] };

  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(episodes)
      .set({ sequence: i + 1, updatedAt: new Date() })
      .where(and(eq(episodes.id, orderedIds[i]), eq(episodes.projectId, id)));
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Update project GET route to include episodes**

Modify `src/app/api/projects/[id]/route.ts`:
- In the GET handler, after fetching the project, also fetch episodes
- Add episodes array to the response JSON
- Keep existing characters/shots/versions logic for backward compat (will be removed in Task 5)

Add after `const project = await resolveProject(id, userId);` check:

```typescript
import { episodes } from "@/lib/db/schema";
// ... in GET handler, before return:
const projectEpisodes = await db
  .select()
  .from(episodes)
  .where(eq(episodes.projectId, id))
  .orderBy(asc(episodes.sequence));

// Add to response:
return NextResponse.json({
  ...project,
  episodes: projectEpisodes,
  characters: projectCharacters,
  shots: enrichedShots,
  versions: allVersions.map(/* ... existing ... */),
});
```

- [ ] **Step 5: Verify API routes work**

Run: `pnpm dev`
Test with curl:
```bash
# List episodes
curl http://localhost:3000/api/projects/<PROJECT_ID>/episodes -H "x-user-id: <UID>"

# Create episode
curl -X POST http://localhost:3000/api/projects/<PROJECT_ID>/episodes \
  -H "Content-Type: application/json" -H "x-user-id: <UID>" \
  -d '{"title":"第2集"}'
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/\[id\]/episodes/ src/app/api/projects/\[id\]/route.ts
git commit -m "feat: add episode CRUD API routes"
```

---

## Task 3: Episode Store

**Files:**
- Create: `src/stores/episode-store.ts`
- Modify: `src/stores/project-store.ts`

- [ ] **Step 1: Create episode list store**

Create `src/stores/episode-store.ts`:

```typescript
import { create } from "zustand";
import { apiFetch } from "@/lib/api-fetch";

export interface Episode {
  id: string;
  projectId: string;
  title: string;
  sequence: number;
  idea: string;
  script: string;
  status: string;
  generationMode: "keyframe" | "reference";
  finalVideoUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

interface EpisodeStore {
  episodes: Episode[];
  loading: boolean;
  fetchEpisodes: (projectId: string) => Promise<void>;
  createEpisode: (projectId: string, title: string) => Promise<Episode>;
  deleteEpisode: (projectId: string, episodeId: string) => Promise<void>;
  updateEpisode: (projectId: string, episodeId: string, patch: Partial<Episode>) => Promise<void>;
  reorderEpisodes: (projectId: string, orderedIds: string[]) => Promise<void>;
}

export const useEpisodeStore = create<EpisodeStore>((set) => ({
  episodes: [],
  loading: false,

  fetchEpisodes: async (projectId) => {
    set({ loading: true });
    const res = await apiFetch(`/api/projects/${projectId}/episodes`);
    const data = await res.json();
    set({ episodes: data, loading: false });
  },

  createEpisode: async (projectId, title) => {
    const res = await apiFetch(`/api/projects/${projectId}/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const episode = await res.json();
    set((state) => ({ episodes: [...state.episodes, episode] }));
    return episode;
  },

  deleteEpisode: async (projectId, episodeId) => {
    await apiFetch(`/api/projects/${projectId}/episodes/${episodeId}`, {
      method: "DELETE",
    });
    set((state) => ({
      episodes: state.episodes.filter((e) => e.id !== episodeId),
    }));
  },

  updateEpisode: async (projectId, episodeId, patch) => {
    await apiFetch(`/api/projects/${projectId}/episodes/${episodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    set((state) => ({
      episodes: state.episodes.map((e) =>
        e.id === episodeId ? { ...e, ...patch } : e
      ),
    }));
  },

  reorderEpisodes: async (projectId, orderedIds) => {
    await apiFetch(`/api/projects/${projectId}/episodes/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    set((state) => ({
      episodes: orderedIds
        .map((id, i) => {
          const ep = state.episodes.find((e) => e.id === id);
          return ep ? { ...ep, sequence: i + 1 } : null;
        })
        .filter(Boolean) as Episode[],
    }));
  },
}));
```

- [ ] **Step 2: Refactor project-store to support episode-level data**

Modify `src/stores/project-store.ts`:

1. Add `episodeId` to the `fetchProject` signature
2. Change the fetch URL to use the episode endpoint when `episodeId` is provided
3. Add `scope` to the `Character` interface
4. Keep backward compat: if no episodeId, fall back to project-level fetch

Key changes:

```typescript
interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
  visualHint?: string | null;
  scope?: string;       // "main" | "guest"
  episodeId?: string | null;
}

interface Project {
  id: string;
  title: string;
  idea: string;
  script: string;
  status: string;
  finalVideoUrl: string | null;
  generationMode: "keyframe" | "reference";
  characters: Character[];
  shots: Shot[];
  versions: StoryboardVersion[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  currentEpisodeId: string | null;
  fetchProject: (id: string, episodeId?: string, versionId?: string) => Promise<void>;
  updateIdea: (idea: string) => void;
  updateScript: (script: string) => void;
  setProject: (project: Project) => void;
}

// In the store implementation:
fetchProject: async (id: string, episodeId?: string, versionId?: string) => {
  if (!get().project) set({ loading: true });

  let url: string;
  if (episodeId) {
    url = `/api/projects/${id}/episodes/${episodeId}`;
    if (versionId) url += `?versionId=${versionId}`;
  } else {
    url = `/api/projects/${id}`;
    if (versionId) url += `?versionId=${versionId}`;
  }

  const res = await apiFetch(url);
  const data = await res.json();
  set({ project: data, loading: false, currentEpisodeId: episodeId ?? null });
},
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/episode-store.ts src/stores/project-store.ts
git commit -m "feat: add episode store and refactor project store for episode support"
```

---

## Task 4: Episode List Page & Components

**Files:**
- Create: `src/app/[locale]/project/[id]/episodes/page.tsx`
- Create: `src/components/editor/episode-card.tsx`
- Create: `src/components/editor/episode-dialog.tsx`
- Modify: `src/app/[locale]/project/[id]/layout.tsx`
- Modify: `src/components/project-card.tsx`

- [ ] **Step 1: Create episode card component**

Create `src/components/editor/episode-card.tsx`:

```typescript
"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Trash2, Edit2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EpisodeCardProps {
  id: string;
  projectId: string;
  title: string;
  sequence: number;
  status: string;
  onDelete: () => void;
  onEdit: () => void;
}

export function EpisodeCard({
  id,
  projectId,
  title,
  sequence,
  status,
  onDelete,
  onEdit,
}: EpisodeCardProps) {
  const locale = useLocale();
  const t = useTranslations();
  const [showMenu, setShowMenu] = useState(false);

  const statusColors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    processing: "bg-amber-100 text-amber-700",
    completed: "bg-emerald-100 text-emerald-700",
  };

  return (
    <div className="group relative flex items-center gap-3 rounded-2xl border border-[--border-subtle] bg-white p-4 transition-all hover:shadow-md">
      <div className="flex h-8 w-8 cursor-grab items-center justify-center text-[--text-muted] opacity-0 transition-opacity group-hover:opacity-100">
        <GripVertical className="h-4 w-4" />
      </div>

      <Link
        href={`/${locale}/project/${projectId}/episodes/${id}/script`}
        className="flex flex-1 items-center gap-4"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
          {sequence}
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-[--text-primary]">{title}</h3>
          <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium", statusColors[status] || statusColors.draft)}>
            {t(`dashboard.projectStatus.${status}`)}
          </span>
        </div>
      </Link>

      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setShowMenu(!showMenu)}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
        {showMenu && (
          <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-xl border border-[--border-subtle] bg-white py-1 shadow-lg">
            <button
              onClick={() => { onEdit(); setShowMenu(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[--text-secondary] hover:bg-[--surface]"
            >
              <Edit2 className="h-3.5 w-3.5" />
              {t("episode.edit")}
            </button>
            <button
              onClick={() => { onDelete(); setShowMenu(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create episode dialog component**

Create `src/components/editor/episode-dialog.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface EpisodeDialogProps {
  onSubmit: (title: string) => Promise<void>;
  initialTitle?: string;
  trigger?: React.ReactNode;
}

export function EpisodeDialog({ onSubmit, initialTitle = "", trigger }: EpisodeDialogProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    await onSubmit(title.trim());
    setSubmitting(false);
    setTitle("");
    setOpen(false);
  }

  return (
    <>
      <div onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" />
            {t("episode.create")}
          </Button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-semibold text-[--text-primary]">
              {initialTitle ? t("episode.edit") : t("episode.create")}
            </h3>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("episode.titlePlaceholder")}
              className="mt-4 w-full rounded-xl border border-[--border-subtle] bg-[--surface] px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !title.trim()}>
                {t("common.confirm")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Create episode list page**

Create `src/app/[locale]/project/[id]/episodes/page.tsx`:

```typescript
"use client";

import { useEffect, use } from "react";
import { useEpisodeStore } from "@/stores/episode-store";
import { EpisodeCard } from "@/components/editor/episode-card";
import { EpisodeDialog } from "@/components/editor/episode-dialog";
import { useTranslations } from "next-intl";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function EpisodesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const t = useTranslations();
  const { episodes, loading, fetchEpisodes, createEpisode, deleteEpisode, updateEpisode } =
    useEpisodeStore();

  useEffect(() => {
    fetchEpisodes(projectId);
  }, [projectId, fetchEpisodes]);

  async function handleCreate(title: string) {
    await createEpisode(projectId, title);
    toast.success(t("episode.created"));
  }

  async function handleDelete(episodeId: string) {
    if (episodes.length <= 1) {
      toast.error(t("episode.cannotDeleteLast"));
      return;
    }
    if (!confirm(t("episode.deleteConfirm"))) return;
    await deleteEpisode(projectId, episodeId);
    toast.success(t("common.delete"));
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="animate-page-in space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("episode.title")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {episodes.length} {t("episode.count")}
            </p>
          </div>
        </div>
        <EpisodeDialog onSubmit={handleCreate} />
      </div>

      {episodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Layers className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("episode.noEpisodes")}
          </h3>
          <div className="mt-6">
            <EpisodeDialog onSubmit={handleCreate} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {episodes.map((ep) => (
            <EpisodeCard
              key={ep.id}
              id={ep.id}
              projectId={projectId}
              title={ep.title}
              sequence={ep.sequence}
              status={ep.status}
              onDelete={() => handleDelete(ep.id)}
              onEdit={() => {
                const newTitle = prompt(t("episode.editTitle"), ep.title);
                if (newTitle && newTitle !== ep.title) {
                  updateEpisode(projectId, ep.id, { title: newTitle });
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update project layout — remove ProjectNav for episode list**

Modify `src/app/[locale]/project/[id]/layout.tsx`:
- Remove `<ProjectNav>` from this layout (it will move to the episode-level layout in Task 5)
- Keep the top bar header with project title and back arrow

The layout now only shows the header bar and renders children (which will be either the episodes list page or the episode-level layout with ProjectNav).

```typescript
// Remove the ProjectNav import and usage
// Remove: import { ProjectNav } from "@/components/editor/project-nav";
// Change the body to:
<div className="flex flex-1 overflow-hidden">
  <main className="flex-1 overflow-y-auto bg-[--surface] p-6 pb-24 lg:pb-6">
    {children}
  </main>
</div>
```

- [ ] **Step 5: Update ProjectCard link target**

Modify `src/components/project-card.tsx`:
Change the link from `/${locale}/project/${id}/script` to `/${locale}/project/${id}/episodes`.

- [ ] **Step 6: Verify episode list page**

Run: `pnpm dev`
Navigate to a project. Should see the episode list with the migrated "第1集".
Create a new episode, verify it appears.

- [ ] **Step 7: Commit**

```bash
git add src/app/\[locale\]/project/\[id\]/episodes/page.tsx \
  src/components/editor/episode-card.tsx \
  src/components/editor/episode-dialog.tsx \
  src/app/\[locale\]/project/\[id\]/layout.tsx \
  src/components/project-card.tsx
git commit -m "feat: add episode list page and components"
```

---

## Task 5: Episode-Level Layout & Route Migration

**Files:**
- Create: `src/app/[locale]/project/[id]/episodes/[episodeId]/layout.tsx`
- Create: `src/app/[locale]/project/[id]/episodes/[episodeId]/script/page.tsx`
- Create: `src/app/[locale]/project/[id]/episodes/[episodeId]/characters/page.tsx`
- Create: `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx`
- Create: `src/app/[locale]/project/[id]/episodes/[episodeId]/preview/page.tsx`
- Modify: `src/components/editor/project-nav.tsx`

- [ ] **Step 1: Create episode-level layout**

Create `src/app/[locale]/project/[id]/episodes/[episodeId]/layout.tsx`:

```typescript
"use client";

import { useEffect, use } from "react";
import { useProjectStore } from "@/stores/project-store";
import { ProjectNav } from "@/components/editor/project-nav";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export default function EpisodeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; episodeId: string }>;
}) {
  const { id, episodeId } = use(params);
  const t = useTranslations("common");
  const { project, loading, fetchProject } = useProjectStore();

  useEffect(() => {
    fetchProject(id, episodeId);
  }, [id, episodeId, fetchProject]);

  if (loading || !project) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="ml-2 text-sm text-[--text-muted]">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <ProjectNav projectId={id} episodeId={episodeId} />
      <main className="flex-1 overflow-y-auto bg-[--surface] p-6 pb-24 lg:pb-6">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create episode-level page files**

These pages re-export existing components. The data loading is handled by the episode layout (fetchProject with episodeId).

Create `src/app/[locale]/project/[id]/episodes/[episodeId]/script/page.tsx`:
```typescript
import { ScriptEditor } from "@/components/editor/script-editor";
export default function EpisodeScriptPage() {
  return <ScriptEditor />;
}
```

Create `src/app/[locale]/project/[id]/episodes/[episodeId]/characters/page.tsx`:
```typescript
// Copy the existing characters/page.tsx content as-is.
// It already reads from useProjectStore which now loads episode-scoped data.
// Will be enhanced in Task 7 to show scope badges.
export { default } from "@/app/[locale]/project/[id]/characters/page";
```

NOTE: If re-export doesn't work with Next.js App Router, copy the full file content instead.

Create `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx`:
```typescript
export { default } from "@/app/[locale]/project/[id]/storyboard/page";
```

Create `src/app/[locale]/project/[id]/episodes/[episodeId]/preview/page.tsx`:
```typescript
export { default } from "@/app/[locale]/project/[id]/preview/page";
```

- [ ] **Step 3: Update ProjectNav to accept episodeId**

Modify `src/components/editor/project-nav.tsx`:

```typescript
interface ProjectNavProps {
  projectId: string;
  episodeId: string;  // Now required
}

// Update tabs to use episode-scoped paths:
const tabs = [
  { key: "script", href: `/${locale}/project/${projectId}/episodes/${episodeId}/script`, num: 1 },
  { key: "characters", href: `/${locale}/project/${projectId}/episodes/${episodeId}/characters`, num: 2 },
  { key: "storyboard", href: `/${locale}/project/${projectId}/episodes/${episodeId}/storyboard`, num: 3 },
  { key: "preview", href: `/${locale}/project/${projectId}/episodes/${episodeId}/preview`, num: 4 },
] as const;

// Add a "Back to Episodes" link above the workflow tabs:
<Link
  href={`/${locale}/project/${projectId}/episodes`}
  className="flex items-center gap-2 px-3 py-2 text-xs text-[--text-muted] hover:text-[--text-primary]"
>
  <ArrowLeft className="h-3 w-3" />
  {t("episode.backToList")}
</Link>
```

- [ ] **Step 4: Verify episode workflow**

Run: `pnpm dev`
From the episode list, click on an episode → should enter 4-step workflow.
Navigate between Script/Characters/Storyboard/Preview tabs.
Click "Back to Episodes" → should return to episode list.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/project/\[id\]/episodes/\[episodeId\]/ \
  src/components/editor/project-nav.tsx
git commit -m "feat: add episode-level layout and route migration"
```

---

## Task 6: Generate Route & Pipeline Adaptation

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`
- Modify: `src/lib/pipeline/character-extract.ts`
- Modify: `src/lib/pipeline/shot-split.ts`

- [ ] **Step 1: Update generate route to accept episodeId**

Modify `src/app/api/projects/[id]/generate/route.ts`:

In the POST handler, extract `episodeId` from the request body alongside `action` and `modelConfig`. When querying shots or characters, filter by episodeId. When creating new shots or versions, set the `episodeId` field.

Key changes throughout the file:
- Add `episodeId` to the destructured body: `const { action, modelConfig, episodeId, ... } = body;`
- When reading `project.script` for generation, read from the episode instead:
  ```typescript
  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    // Use episode.script, episode.idea, episode.generationMode instead of project fields
  }
  ```
- When querying shots: add `eq(shots.episodeId, episodeId)` to the where clause
- When inserting shots: include `episodeId` in the values
- When creating storyboard versions: include `episodeId`
- When enqueuing tasks: include `episodeId` in the payload
- When querying characters for generation context: use merged query `or(isNull(characters.episodeId), eq(characters.episodeId, episodeId))`

- [ ] **Step 2: Update character-extract pipeline handler**

Modify `src/lib/pipeline/character-extract.ts`:

Add deduplication against existing project characters and scope assignment:

```typescript
export async function handleCharacterExtract(task: Task) {
  const payload = task.payload as {
    projectId: string;
    episodeId?: string;
    screenplay: string;
    modelConfig?: ModelConfigPayload;
  };

  const ai = resolveAIProvider(payload.modelConfig);
  const result = await ai.generateText(
    buildCharacterExtractPrompt(payload.screenplay),
    { systemPrompt: CHARACTER_EXTRACT_SYSTEM, temperature: 0.5 }
  );

  const extracted = JSON.parse(result) as Array<{
    name: string;
    description: string;
    visualHint?: string;
  }>;

  // Fetch existing project-level characters for AI-driven deduplication
  const existingChars = await db
    .select()
    .from(characters)
    .where(and(
      eq(characters.projectId, payload.projectId),
      eq(characters.scope, "main")
    ));

  // Use the LLM to decide which extracted characters are variants of existing ones.
  // Pass existing character names to the prompt and ask the AI to return only truly new characters.
  // This handles fuzzy variants like "小明" vs "小明同学".
  let newCharacters = extracted;
  if (existingChars.length > 0) {
    const existingNames = existingChars.map((c) => c.name);
    const dedupeResult = await ai.generateText(
      `Existing characters: ${JSON.stringify(existingNames)}\n\nNewly extracted characters: ${JSON.stringify(extracted.map(c => c.name))}\n\nReturn a JSON array of ONLY the truly new character names that are NOT variants or aliases of existing characters. Consider nicknames, shortened names, and honorific variations as the same character.`,
      { systemPrompt: "You are a character deduplication assistant. Return only a JSON array of strings.", temperature: 0 }
    );
    const newNames = new Set(JSON.parse(dedupeResult) as string[]);
    newCharacters = extracted.filter((c) => newNames.has(c.name));
  }

  const created = [];
  for (const char of newCharacters) {

    const id = ulid();
    const [record] = await db
      .insert(characters)
      .values({
        id,
        projectId: payload.projectId,
        name: char.name,
        description: char.description,
        visualHint: char.visualHint ?? "",
        scope: payload.episodeId ? "guest" : "main",
        episodeId: payload.episodeId ?? null,
      })
      .returning();
    created.push(record);
  }

  return { characters: created };
}
```

- [ ] **Step 3: Update shot-split pipeline handler**

Modify `src/lib/pipeline/shot-split.ts`:

Add `episodeId` to the task payload and include it when inserting shots:

```typescript
// In the payload type, add: episodeId?: string
// When inserting shots, add: episodeId: payload.episodeId ?? null
```

- [ ] **Step 4: Update client-side generate calls to include episodeId**

In the storyboard page and characters page, the `apiFetch` calls to `/api/projects/${project.id}/generate` need to include `episodeId` in the body.

Since the project-store now tracks `currentEpisodeId`, add it to generate calls:

```typescript
// In characters page and storyboard page, update generate calls:
body: JSON.stringify({
  action: "character_extract",
  modelConfig: getModelConfig(),
  episodeId: useProjectStore.getState().currentEpisodeId,
}),
```

- [ ] **Step 5: Verify generation pipeline**

Run: `pnpm dev`
Enter an episode, go to Characters page, click "Extract Characters".
Verify characters are created with correct scope and episodeId.
Create a second episode, extract characters — verify deduplication works.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/\[id\]/generate/route.ts \
  src/lib/pipeline/character-extract.ts \
  src/lib/pipeline/shot-split.ts \
  src/app/\[locale\]/project/\[id\]/episodes/\[episodeId\]/characters/page.tsx \
  src/app/\[locale\]/project/\[id\]/episodes/\[episodeId\]/storyboard/page.tsx
git commit -m "feat: adapt generate route and pipeline for episode support"
```

---

## Task 7: Character Scope UI

**Files:**
- Modify: `src/app/[locale]/project/[id]/episodes/[episodeId]/characters/page.tsx`
- Modify: `src/components/editor/character-card.tsx`

- [ ] **Step 1: Add scope badge and promote button to CharacterCard**

Modify `src/components/editor/character-card.tsx`:

Add props: `scope?: string`, `onPromote?: () => void`

In the card UI:
- Show a badge: "主要角色" for `main`, "客串角色" for `guest`
- If `scope === "guest"`, show a "Promote to Main" button
- If `scope === "main"`, disable the delete button (grey it out)

- [ ] **Step 2: Update episode characters page to pass scope props**

If re-exporting from the old page doesn't work, create a full characters page at the episode path that:
- Reads characters from `useProjectStore` (which now includes scope)
- Passes `scope` and `onPromote` to each `CharacterCard`
- Implements `onPromote` by calling `PATCH /api/projects/${projectId}/characters/${charId}` with `{ scope: "main", episodeId: null }`

- [ ] **Step 3: Update characters API to support scope updates**

Modify `src/app/api/projects/[id]/characters/[characterId]/route.ts`:
- Add `scope` and `episodeId` to the accepted PATCH body fields
- When `scope` is set to `"main"`, also set `episodeId` to `null`
- Allow updating a character's scope from `guest` to `main` (promotion)

- [ ] **Step 4: Verify**

Run: `pnpm dev`
In an episode's characters page:
- Main characters show "主要角色" badge, delete is disabled
- Guest characters show "客串角色" badge with "Promote" button
- Clicking promote changes the character to main scope

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/character-card.tsx \
  src/app/\[locale\]/project/\[id\]/episodes/\[episodeId\]/characters/page.tsx \
  src/app/api/projects/\[id\]/characters/\[characterId\]/route.ts
git commit -m "feat: add character scope UI with promote-to-main support"
```

---

## Task 8: i18n Keys

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `messages/ja.json`
- Modify: `messages/ko.json`

- [ ] **Step 1: Add episode i18n keys to all locale files**

Add the following keys under a new `"episode"` section:

**zh.json:**
```json
"episode": {
  "title": "分集管理",
  "count": "集",
  "create": "新建分集",
  "edit": "编辑分集",
  "editTitle": "输入新标题",
  "titlePlaceholder": "输入分集标题...",
  "noEpisodes": "还没有分集，点击上方按钮创建一个吧",
  "deleteConfirm": "确定要删除这一集吗？该集的所有分镜和客串角色将被删除。",
  "cannotDeleteLast": "无法删除最后一集",
  "created": "分集已创建",
  "backToList": "返回分集列表",
  "mainCharacter": "主要角色",
  "guestCharacter": "客串角色",
  "promoteToMain": "提升为主要角色"
}
```

**en.json:**
```json
"episode": {
  "title": "Episodes",
  "count": "episodes",
  "create": "New Episode",
  "edit": "Edit Episode",
  "editTitle": "Enter new title",
  "titlePlaceholder": "Enter episode title...",
  "noEpisodes": "No episodes yet. Click the button above to create one.",
  "deleteConfirm": "Are you sure you want to delete this episode? All shots and guest characters will be removed.",
  "cannotDeleteLast": "Cannot delete the last episode",
  "created": "Episode created",
  "backToList": "Back to Episodes",
  "mainCharacter": "Main Character",
  "guestCharacter": "Guest Character",
  "promoteToMain": "Promote to Main"
}
```

**ja.json:**
```json
"episode": {
  "title": "エピソード管理",
  "count": "エピソード",
  "create": "新規エピソード",
  "edit": "エピソード編集",
  "editTitle": "新しいタイトルを入力",
  "titlePlaceholder": "エピソードタイトルを入力...",
  "noEpisodes": "エピソードがまだありません。上のボタンをクリックして作成してください。",
  "deleteConfirm": "このエピソードを削除しますか？すべてのショットとゲストキャラクターが削除されます。",
  "cannotDeleteLast": "最後のエピソードは削除できません",
  "created": "エピソードが作成されました",
  "backToList": "エピソード一覧に戻る",
  "mainCharacter": "メインキャラクター",
  "guestCharacter": "ゲストキャラクター",
  "promoteToMain": "メインに昇格"
}
```

**ko.json:**
```json
"episode": {
  "title": "에피소드 관리",
  "count": "에피소드",
  "create": "새 에피소드",
  "edit": "에피소드 편집",
  "editTitle": "새 제목 입력",
  "titlePlaceholder": "에피소드 제목을 입력하세요...",
  "noEpisodes": "아직 에피소드가 없습니다. 위 버튼을 클릭하여 만드세요.",
  "deleteConfirm": "이 에피소드를 삭제하시겠습니까? 모든 샷과 게스트 캐릭터가 삭제됩니다.",
  "cannotDeleteLast": "마지막 에피소드는 삭제할 수 없습니다",
  "created": "에피소드가 생성되었습니다",
  "backToList": "에피소드 목록으로 돌아가기",
  "mainCharacter": "메인 캐릭터",
  "guestCharacter": "게스트 캐릭터",
  "promoteToMain": "메인으로 승격"
}
```

- [ ] **Step 2: Commit**

```bash
git add messages/
git commit -m "feat: add episode management i18n keys for all locales"
```

---

## Task 9: Cleanup Old Routes & Final Integration

**Files:**
- Remove or redirect: `src/app/[locale]/project/[id]/script/page.tsx`
- Remove or redirect: `src/app/[locale]/project/[id]/characters/page.tsx`
- Remove or redirect: `src/app/[locale]/project/[id]/storyboard/page.tsx`
- Remove or redirect: `src/app/[locale]/project/[id]/preview/page.tsx`

- [ ] **Step 1: Redirect old routes to episode list**

Convert each old page to a redirect. For example, `src/app/[locale]/project/[id]/script/page.tsx`:

```typescript
import { redirect } from "next/navigation";

export default async function LegacyScriptPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  redirect(`/${locale}/project/${id}/episodes`);
}
```

Apply the same redirect pattern to characters, storyboard, and preview pages.

- [ ] **Step 2: End-to-end verification**

Run: `pnpm dev`

Verify full flow:
1. Dashboard → click project → see episode list with "第1集"
2. Create "第2集" → appears in list
3. Click episode → enter 4-step workflow
4. Script page works, can edit idea/script
5. Characters page shows scope badges
6. Extract characters in episode 2 → deduplication works against episode 1's characters
7. New characters appear as "guest" with promote button
8. Storyboard page works with episode-scoped shots
9. Back button returns to episode list
10. Old URLs (e.g., `/project/xxx/script`) redirect to episodes
11. Delete episode works (but not the last one)

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/project/\[id\]/script/ \
  src/app/\[locale\]/project/\[id\]/characters/ \
  src/app/\[locale\]/project/\[id\]/storyboard/ \
  src/app/\[locale\]/project/\[id\]/preview/
git commit -m "feat: redirect legacy routes to episode list"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Database migration | schema.ts, 0010_add_episodes.sql |
| 2 | Episode API routes | 3 new API route files |
| 3 | Episode & project stores | episode-store.ts, project-store.ts |
| 4 | Episode list page & components | episodes/page.tsx, episode-card, episode-dialog |
| 5 | Episode-level layout & route migration | episode layout, 4 page files, project-nav |
| 6 | Generate route & pipeline adaptation | generate route, character-extract, shot-split |
| 7 | Character scope UI | character-card, characters page |
| 8 | i18n keys | 4 locale files |
| 9 | Cleanup old routes & integration test | 4 legacy page redirects |
