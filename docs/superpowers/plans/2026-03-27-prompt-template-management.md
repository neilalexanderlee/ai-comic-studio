# Prompt Template Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to customize AI generation prompts via a slot-based editor with global/project-level overrides, version history, preset templates, and a full-text advanced editor with safety validation.

**Architecture:** New DB tables store user prompt overrides. A registry decomposes each prompt into editable slots. A resolver merges overrides with code defaults at generation time. Frontend provides a three-column editor (prompt list → slot list → editor + preview) on a new settings page, plus project-level override cards.

**Tech Stack:** SQLite/Drizzle ORM, Next.js App Router API routes, React/Zustand, Tailwind CSS, next-intl

---

## File Structure

```
NEW FILES:
  src/lib/ai/prompts/registry.ts          — Prompt definitions, slot metadata, buildFullPrompt per prompt
  src/lib/ai/prompts/resolver.ts          — resolvePrompt() with DB lookup + fallback
  src/lib/ai/prompts/presets.ts           — Built-in preset definitions (cinematic, anime, minimal)
  src/app/api/prompt-templates/route.ts   — GET list, POST create global overrides
  src/app/api/prompt-templates/registry/route.ts — GET registry metadata
  src/app/api/prompt-templates/[promptKey]/route.ts — PUT/DELETE global override
  src/app/api/prompt-templates/[promptKey]/versions/route.ts — GET versions
  src/app/api/prompt-templates/[promptKey]/versions/[vid]/restore/route.ts — POST restore
  src/app/api/prompt-templates/preview/route.ts — POST preview assembled prompt
  src/app/api/prompt-templates/validate/route.ts — POST validate full-text edit
  src/app/api/prompt-presets/route.ts     — GET/POST presets
  src/app/api/prompt-presets/[presetId]/route.ts — DELETE preset
  src/app/api/prompt-presets/[presetId]/apply/route.ts — POST apply
  src/app/api/projects/[id]/prompt-templates/route.ts — GET project overrides
  src/app/api/projects/[id]/prompt-templates/[promptKey]/route.ts — PUT/DELETE project override
  src/app/[locale]/settings/prompts/page.tsx — Global prompt settings page
  src/components/prompt-templates/prompt-editor.tsx — Main 3-column editor
  src/components/prompt-templates/slot-list.tsx — Slot list sidebar
  src/components/prompt-templates/prompt-preview.tsx — Live preview pane
  src/components/prompt-templates/advanced-editor.tsx — Full-text editor with protection
  src/components/prompt-templates/preset-dialog.tsx — Preset management dialog
  src/components/prompt-templates/project-prompt-cards.tsx — Project-level card grid
  src/stores/prompt-template-store.ts     — Zustand store for editor UI state
  drizzle/0014_add_prompt_templates.sql   — Migration

MODIFIED FILES:
  src/lib/db/schema.ts                    — Add 3 new tables
  drizzle/meta/_journal.json              — Add migration entry
  src/lib/pipeline/character-extract.ts   — Use resolvePrompt
  src/lib/pipeline/shot-split.ts          — Use resolvePrompt
  src/lib/pipeline/script-parse.ts        — Use resolvePrompt
  src/lib/pipeline/character-image.ts     — Use resolvePrompt
  src/lib/pipeline/video-generate.ts      — Use resolvePrompt
  src/app/api/projects/[id]/generate/route.ts — Use resolvePrompt at all call sites
  src/app/api/projects/[id]/import/characters/route.ts — Use resolvePrompt
  src/app/api/projects/[id]/import/split/route.ts — Use resolvePrompt
  src/app/api/projects/[id]/upload-script/route.ts — Use resolvePrompt
  src/components/editor/character-card.tsx — Use resolvePrompt via API
  messages/zh.json                        — Add promptTemplates namespace
  messages/en.json                        — Add promptTemplates namespace
  messages/ja.json                        — Add promptTemplates namespace
  messages/ko.json                        — Add promptTemplates namespace
```

---

### Task 1: Database Schema & Migration

**Files:**
- Create: `drizzle/0014_add_prompt_templates.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Create migration SQL**

Create `drizzle/0014_add_prompt_templates.sql`:

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_templates_unique
  ON prompt_templates(user_id, prompt_key, COALESCE(slot_key, ''), scope, COALESCE(project_id, ''));

CREATE INDEX IF NOT EXISTS idx_prompt_templates_user_scope
  ON prompt_templates(user_id, scope);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_template
  ON prompt_versions(template_id);

CREATE TABLE IF NOT EXISTS prompt_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT,
  prompt_key TEXT NOT NULL,
  slots TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_presets_user
  ON prompt_presets(user_id);
```

- [ ] **Step 2: Add journal entry**

Add to `drizzle/meta/_journal.json` entries array:

```json
{
  "idx": 14,
  "version": "6",
  "when": 1774900000000,
  "tag": "0014_add_prompt_templates",
  "breakpoints": true
}
```

- [ ] **Step 3: Add Drizzle schema definitions**

Add to `src/lib/db/schema.ts` after the existing table definitions:

```typescript
export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  promptKey: text("prompt_key").notNull(),
  slotKey: text("slot_key"),
  scope: text("scope", { enum: ["global", "project"] }).notNull().default("global"),
  projectId: text("project_id"),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptVersions = sqliteTable("prompt_versions", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => promptTemplates.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptPresets = sqliteTable("prompt_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  userId: text("user_id"),
  promptKey: text("prompt_key").notNull(),
  slots: text("slots", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

- [ ] **Step 4: Verify migration runs**

```bash
pnpm dev
```

Check console for migration success. Verify tables exist by checking no errors on startup.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0014_add_prompt_templates.sql drizzle/meta/_journal.json src/lib/db/schema.ts
git commit -m "feat: add prompt_templates, prompt_versions, prompt_presets tables"
```

---

### Task 2: Prompt Registry — Define Slot Decomposition

**Files:**
- Create: `src/lib/ai/prompts/registry.ts`

This is the core file that decomposes each prompt into editable slots. Each prompt's system constant gets split into segments, with `buildFullPrompt` reassembling them.

- [ ] **Step 1: Create registry types and helper**

Create `src/lib/ai/prompts/registry.ts`:

```typescript
export type PromptSlot = {
  key: string;
  nameKey: string;
  descriptionKey: string;
  defaultContent: string;
  editable: boolean;
};

export type PromptCategory = "script" | "character" | "storyboard" | "frame" | "video";

export type PromptDefinition = {
  key: string;
  nameKey: string;
  category: PromptCategory;
  slots: PromptSlot[];
  buildFullPrompt: (slotContents: Record<string, string>) => string;
};

function slot(
  key: string,
  nameKey: string,
  descriptionKey: string,
  defaultContent: string,
  editable = true
): PromptSlot {
  return { key, nameKey, descriptionKey, defaultContent, editable };
}
```

- [ ] **Step 2: Define script_generate prompt slots**

Decompose `SCRIPT_GENERATE_SYSTEM` into slots. Add to `registry.ts`:

```typescript
const scriptGenerateDef: PromptDefinition = {
  key: "script_generate",
  nameKey: "promptTemplates.prompts.scriptGenerate",
  category: "script",
  slots: [
    slot(
      "role_definition",
      "promptTemplates.slots.roleDefinition",
      "promptTemplates.slots.roleDefinitionDesc",
      `You are an award-winning screenwriter with expertise in visual storytelling for short-form animated content. Your scripts are renowned for cinematic pacing, vivid imagery, and emotionally resonant dialogue.\n\nYour task: transform a brief creative idea into a polished, production-ready screenplay optimized for AI-generated animation (each scene = one 5–15 second animated shot).`
    ),
    slot(
      "visual_style_section",
      "promptTemplates.slots.visualStyleSection",
      "promptTemplates.slots.visualStyleSectionDesc",
      `=== 1. VISUAL STYLE ===\nDeclare the overall art direction at the very top. This section defines the visual identity for the entire project. Include:\n- Art style: realistic live-action / photorealistic CG / anime / 2D cartoon / watercolor / pixel art / etc. (respect user's preference if specified, e.g., "真人" = realistic live-action style)\n- Color palette: overall tone (warm, cold, desaturated, vibrant), dominant colors\n- Era & aesthetic: modern, retro, futuristic, fantasy medieval, etc.\n- Mood & atmosphere: cinematic noir, lighthearted comedy, epic adventure, etc.`
    ),
    slot(
      "character_section",
      "promptTemplates.slots.characterSection",
      "promptTemplates.slots.characterSectionDesc",
      `=== 2. CHARACTERS ===\nFor EVERY named character, provide a detailed visual description block:\n  CHARACTER_NAME\n  - Appearance: gender, age, height/build, face features, skin tone, hair (color, style, length)\n  - Outfit: specific clothing with materials and colors (e.g., "worn brown leather jacket, faded indigo jeans, white sneakers")\n  - Distinctive features: scars, glasses, tattoos, accessories, etc.\n  - Personality in motion: how they carry themselves (posture, gait, habitual gestures)`
    ),
    slot(
      "scene_section",
      "promptTemplates.slots.sceneSection",
      "promptTemplates.slots.sceneSectionDesc",
      `=== 3. SCENES ===\nProfessional screenplay notation:\n- SCENE headers: "SCENE [N] — [INT/EXT]. [LOCATION] — [TIME OF DAY]"\n- Parenthetical stage directions for each scene describing:\n  • Camera framing (close-up, wide shot, over-the-shoulder, etc.)\n  • Character blocking and movement\n  • Key environmental details (lighting, weather, props, architecture, colors)\n  • Emotional beat of the scene\n- Character dialogue:\n  CHARACTER NAME\n  (delivery direction)\n  "Dialogue text"`
    ),
    slot(
      "screenwriting_principles",
      "promptTemplates.slots.screenwritingPrinciples",
      "promptTemplates.slots.screenwritingPrinciplesDesc",
      `Screenwriting principles:\n- Open with a HOOK — a striking visual or intriguing moment that demands attention\n- Every scene must serve the story: advance plot, reveal character, or build tension\n- "Show, don't tell" — favor visual storytelling over exposition\n- Dialogue should feel natural; subtext > on-the-nose statements\n- Build a clear three-act structure: SETUP → CONFRONTATION → RESOLUTION\n- End with emotional payoff — surprise, catharsis, or a powerful image\n- Scale the number of scenes to match the target duration specified in the idea. If the idea specifies a target duration (e.g. "目标时长：10分钟"), calculate scenes accordingly: ~1 scene per 30-60 seconds of screen time. A 10-minute episode needs 10-20 scenes, NOT 4-8.\n- Each scene description must be visually specific enough for an AI image generator to produce a frame (describe colors, spatial relationships, lighting quality)\n- Scene descriptions should be consistent with the declared VISUAL STYLE (e.g., if "realistic", describe photographic details; if "anime", describe anime-specific aesthetics)`
    ),
    slot(
      "output_format",
      "promptTemplates.slots.outputFormat",
      "promptTemplates.slots.outputFormatDesc",
      `Output format — the screenplay MUST contain these sections IN ORDER:\n\nDo NOT output JSON. Do NOT use markdown code fences. Output plain screenplay text only.`,
      false // locked
    ),
    slot(
      "language_rules",
      "promptTemplates.slots.languageRules",
      "promptTemplates.slots.languageRulesDesc",
      `CRITICAL LANGUAGE RULE: You MUST write the entire screenplay in the SAME LANGUAGE as the user's input. If the user writes in Chinese, output the screenplay entirely in Chinese. If in English, output in English. This applies to ALL sections below.`,
      false // locked
    ),
  ],
  buildFullPrompt: (slots) => {
    return [
      slots.role_definition,
      "",
      slots.language_rules,
      "",
      slots.output_format,
      "",
      slots.visual_style_section,
      "",
      slots.character_section,
      "",
      slots.scene_section,
      "",
      slots.screenwriting_principles,
    ].join("\n");
  },
};
```

- [ ] **Step 3: Define remaining prompt slots**

Continue in `registry.ts` — add definitions for all 12 prompts. Each follows the same pattern: decompose the system constant into meaningful sections, mark JSON/language sections as `editable: false`, and provide a `buildFullPrompt` function. For brevity, the pattern is identical to Step 2. The key prompts to decompose:

- `script_parse` — slots: `role_definition`, `parsing_rules`, locked: `output_format`, `language_rules`
- `script_split` — slots: `role_definition`, `splitting_rules`, `idea_requirements`, locked: `output_format`, `language_rules`
- `character_extract` — slots: `role_definition`, `style_detection`, `description_requirements`, `scope_rules`, `writing_rules`, locked: `output_format`, `language_rules`
- `import_character_extract` — slots: `role_definition`, `extraction_rules`, locked: `output_format`, `language_rules`
- `character_image` — slots: `style_matching`, `face_detail`, `four_view_layout`, `lighting_rendering`, `consistency_rules`, locked: `name_label`
- `shot_split` — slots: `role_definition`, `start_end_frame_rules`, `motion_script_rules`, `video_script_rules`, `camera_directions`, `cinematography_principles`, `proportional_tiers`, locked: `output_format`, `language_rules`
- `frame_generate_first` — all editable: `style_matching`, `reference_rules`, `rendering_quality`, `continuity_rules`
- `frame_generate_last` — all editable: `style_matching`, `relationship_to_first`, `next_shot_readiness`, `rendering_quality`
- `video_generate` — all editable: `interpolation_header`, `dialogue_format`, `frame_anchors`
- `ref_video_generate` — all editable: `dialogue_format`
- `ref_video_prompt` — slots: `role_definition`, `motion_rules`, `quality_benchmark`, locked: `language_rules`

Each definition must include the **exact default content** copied from the current prompt file, and the `buildFullPrompt` function must reassemble them in the correct order to produce the same output as the current constants.

- [ ] **Step 4: Export the registry**

```typescript
export const PROMPT_REGISTRY: PromptDefinition[] = [
  scriptGenerateDef,
  scriptParseDef,
  scriptSplitDef,
  characterExtractDef,
  importCharacterExtractDef,
  characterImageDef,
  shotSplitDef,
  frameGenerateFirstDef,
  frameGenerateLastDef,
  videoGenerateDef,
  refVideoGenerateDef,
  refVideoPromptDef,
];

export const PROMPT_REGISTRY_MAP = new Map(
  PROMPT_REGISTRY.map((def) => [def.key, def])
);

export function getPromptDefinition(key: string): PromptDefinition | undefined {
  return PROMPT_REGISTRY_MAP.get(key);
}

export function getDefaultSlotContents(def: PromptDefinition): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const slot of def.slots) {
    contents[slot.key] = slot.defaultContent;
  }
  return contents;
}
```

- [ ] **Step 5: Verify registry produces identical prompts**

For each prompt, verify that `buildFullPrompt(getDefaultSlotContents(def))` produces the same output as the current system constant. Do this by temporarily adding a comparison in a scratch file or by visual inspection.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/prompts/registry.ts
git commit -m "feat: add prompt registry with slot decomposition for all 12 prompts"
```

---

### Task 3: Prompt Resolver

**Files:**
- Create: `src/lib/ai/prompts/resolver.ts`

- [ ] **Step 1: Create resolver**

Create `src/lib/ai/prompts/resolver.ts`:

```typescript
import { db } from "@/lib/db";
import { promptTemplates } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  getPromptDefinition,
  getDefaultSlotContents,
} from "./registry";

interface ResolveOptions {
  userId: string;
  projectId?: string;
}

/**
 * Resolve a prompt's system content by merging:
 *   project-level overrides > global overrides > code defaults
 */
export async function resolvePrompt(
  promptKey: string,
  options: ResolveOptions
): Promise<string> {
  const def = getPromptDefinition(promptKey);
  if (!def) {
    throw new Error(`Unknown prompt key: ${promptKey}`);
  }

  const slotContents = getDefaultSlotContents(def);

  // Check for full-prompt override first (advanced mode, slotKey = null)
  const fullOverrides = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, options.userId),
        eq(promptTemplates.promptKey, promptKey),
        isNull(promptTemplates.slotKey)
      )
    );

  // Find project-level full override, then global
  const projectFull = fullOverrides.find(
    (o) => o.scope === "project" && o.projectId === options.projectId
  );
  const globalFull = fullOverrides.find((o) => o.scope === "global");

  if (options.projectId && projectFull) {
    return projectFull.content;
  }
  if (globalFull) {
    return globalFull.content;
  }

  // No full override — resolve slot by slot
  const slotOverrides = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, options.userId),
        eq(promptTemplates.promptKey, promptKey)
      )
    );

  for (const slot of def.slots) {
    // Project-level slot override
    if (options.projectId) {
      const projectSlot = slotOverrides.find(
        (o) =>
          o.slotKey === slot.key &&
          o.scope === "project" &&
          o.projectId === options.projectId
      );
      if (projectSlot) {
        slotContents[slot.key] = projectSlot.content;
        continue;
      }
    }
    // Global slot override
    const globalSlot = slotOverrides.find(
      (o) => o.slotKey === slot.key && o.scope === "global"
    );
    if (globalSlot) {
      slotContents[slot.key] = globalSlot.content;
    }
  }

  return def.buildFullPrompt(slotContents);
}

/**
 * Resolve a prompt for build functions that take params (frame, video, character image).
 * Returns the slot contents so the caller can pass them to the build function.
 */
export async function resolveSlotContents(
  promptKey: string,
  options: ResolveOptions
): Promise<Record<string, string>> {
  const def = getPromptDefinition(promptKey);
  if (!def) {
    throw new Error(`Unknown prompt key: ${promptKey}`);
  }

  const slotContents = getDefaultSlotContents(def);

  const overrides = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, options.userId),
        eq(promptTemplates.promptKey, promptKey)
      )
    );

  for (const slot of def.slots) {
    if (options.projectId) {
      const projectSlot = overrides.find(
        (o) =>
          o.slotKey === slot.key &&
          o.scope === "project" &&
          o.projectId === options.projectId
      );
      if (projectSlot) {
        slotContents[slot.key] = projectSlot.content;
        continue;
      }
    }
    const globalSlot = overrides.find(
      (o) => o.slotKey === slot.key && o.scope === "global"
    );
    if (globalSlot) {
      slotContents[slot.key] = globalSlot.content;
    }
  }

  return slotContents;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai/prompts/resolver.ts
git commit -m "feat: add prompt resolver with project > global > default priority"
```

---

### Task 4: Pipeline Integration — Replace Direct Prompt Usage

**Files:**
- Modify: `src/lib/pipeline/character-extract.ts`
- Modify: `src/lib/pipeline/shot-split.ts`
- Modify: `src/lib/pipeline/script-parse.ts`
- Modify: `src/lib/pipeline/character-image.ts`
- Modify: `src/lib/pipeline/video-generate.ts`
- Modify: `src/app/api/projects/[id]/generate/route.ts`
- Modify: `src/app/api/projects/[id]/import/characters/route.ts`
- Modify: `src/app/api/projects/[id]/import/split/route.ts`
- Modify: `src/app/api/projects/[id]/upload-script/route.ts`

The key change is replacing direct imports of system constants (e.g. `CHARACTER_EXTRACT_SYSTEM`) with calls to `resolvePrompt()`. The userId needs to be threaded through from the API route to the pipeline handler.

- [ ] **Step 1: Update pipeline handlers**

For each pipeline handler, the pattern is:

**Before** (e.g. `character-extract.ts`):
```typescript
import { CHARACTER_EXTRACT_SYSTEM, buildCharacterExtractPrompt } from "@/lib/ai/prompts/character-extract";
// ...
const result = await ai.generateText(
  buildCharacterExtractPrompt(payload.screenplay),
  { systemPrompt: CHARACTER_EXTRACT_SYSTEM, temperature: 0.5 }
);
```

**After**:
```typescript
import { buildCharacterExtractPrompt } from "@/lib/ai/prompts/character-extract";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
// ...
const systemPrompt = await resolvePrompt("character_extract", {
  userId: payload.userId ?? "",
  projectId: payload.projectId,
});
const result = await ai.generateText(
  buildCharacterExtractPrompt(payload.screenplay),
  { systemPrompt, temperature: 0.5 }
);
```

Apply this pattern to:
- `src/lib/pipeline/character-extract.ts` — replace `CHARACTER_EXTRACT_SYSTEM`
- `src/lib/pipeline/shot-split.ts` — replace `SHOT_SPLIT_SYSTEM`
- `src/lib/pipeline/script-parse.ts` — replace `SCRIPT_PARSE_SYSTEM`

**Note**: `userId` must be added to the task payload when enqueuing tasks. Check each enqueue call site in `generate/route.ts` and add `userId` to the payload.

- [ ] **Step 2: Update generate route**

`src/app/api/projects/[id]/generate/route.ts` uses prompts directly in many places. For each usage:

1. `SCRIPT_GENERATE_SYSTEM` (line ~253) → `await resolvePrompt("script_generate", { userId, projectId: id })`
2. `SCRIPT_PARSE_SYSTEM` (line ~314) → `await resolvePrompt("script_parse", { userId, projectId: id })`
3. `CHARACTER_EXTRACT_SYSTEM` (line ~385) → `await resolvePrompt("character_extract", { userId, projectId: id })`
4. `REF_VIDEO_PROMPT_SYSTEM` (lines ~1745, ~1923, ~2134, ~2213) → `await resolvePrompt("ref_video_prompt", { userId, projectId: id })`

For build functions (frame, video, character image), the prompts don't have system constants — they are pure template functions. These will be handled in a later step by having the registry's `buildFullPrompt` control the template sections.

Add `import { resolvePrompt } from "@/lib/ai/prompts/resolver"` at the top and get `userId` from `getUserIdFromRequest(request)` which is already available.

- [ ] **Step 3: Update import routes**

- `src/app/api/projects/[id]/import/characters/route.ts` — replace `IMPORT_CHARACTER_EXTRACT_SYSTEM` with `await resolvePrompt("import_character_extract", { userId, projectId: id })`
- `src/app/api/projects/[id]/import/split/route.ts` — replace `SCRIPT_SPLIT_SYSTEM` with `await resolvePrompt("script_split", { userId, projectId: id })`
- `src/app/api/projects/[id]/upload-script/route.ts` — replace `SCRIPT_SPLIT_SYSTEM` with `await resolvePrompt("script_split", { userId, projectId: id })`

- [ ] **Step 4: Verify by running the app**

```bash
pnpm dev
```

Create a project and run a generation to verify prompts still work correctly with default values (no overrides exist yet).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/ src/app/api/projects/
git commit -m "feat: integrate prompt resolver into pipeline and API routes"
```

---

### Task 5: API Routes — CRUD for Prompt Templates

**Files:**
- Create: `src/app/api/prompt-templates/route.ts`
- Create: `src/app/api/prompt-templates/registry/route.ts`
- Create: `src/app/api/prompt-templates/[promptKey]/route.ts`
- Create: `src/app/api/prompt-templates/preview/route.ts`
- Create: `src/app/api/prompt-templates/validate/route.ts`
- Create: `src/app/api/projects/[id]/prompt-templates/route.ts`
- Create: `src/app/api/projects/[id]/prompt-templates/[promptKey]/route.ts`

- [ ] **Step 1: Create registry endpoint**

Create `src/app/api/prompt-templates/registry/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { PROMPT_REGISTRY } from "@/lib/ai/prompts/registry";

export async function GET() {
  const registry = PROMPT_REGISTRY.map((def) => ({
    key: def.key,
    nameKey: def.nameKey,
    category: def.category,
    slots: def.slots.map((s) => ({
      key: s.key,
      nameKey: s.nameKey,
      descriptionKey: s.descriptionKey,
      defaultContent: s.defaultContent,
      editable: s.editable,
    })),
  }));
  return NextResponse.json(registry);
}
```

- [ ] **Step 2: Create global templates list & save endpoints**

Create `src/app/api/prompt-templates/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  const templates = await db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.userId, userId), eq(promptTemplates.scope, "global")));
  return NextResponse.json(templates);
}
```

- [ ] **Step 3: Create per-prompt PUT/DELETE endpoint**

Create `src/app/api/prompt-templates/[promptKey]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, promptVersions } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ promptKey: string }> }
) {
  const { promptKey } = await params;
  const userId = getUserIdFromRequest(request);
  const body = await request.json() as {
    mode: "slots" | "full";
    slots?: Record<string, string>;
    content?: string;
  };

  const def = getPromptDefinition(promptKey);
  if (!def) {
    return NextResponse.json({ error: "Unknown prompt" }, { status: 404 });
  }

  if (body.mode === "full") {
    // Upsert full-prompt override (slotKey = null)
    const existing = await db
      .select()
      .from(promptTemplates)
      .where(
        and(
          eq(promptTemplates.userId, userId),
          eq(promptTemplates.promptKey, promptKey),
          isNull(promptTemplates.slotKey),
          eq(promptTemplates.scope, "global")
        )
      );

    if (existing.length > 0) {
      // Save version before updating
      await db.insert(promptVersions).values({
        id: ulid(),
        templateId: existing[0].id,
        content: existing[0].content,
      });
      await db
        .update(promptTemplates)
        .set({ content: body.content!, updatedAt: new Date() })
        .where(eq(promptTemplates.id, existing[0].id));
    } else {
      await db.insert(promptTemplates).values({
        id: ulid(),
        userId,
        promptKey,
        slotKey: null,
        scope: "global",
        projectId: null,
        content: body.content!,
      });
    }
  } else {
    // Upsert each slot
    for (const [slotKey, content] of Object.entries(body.slots ?? {})) {
      const existing = await db
        .select()
        .from(promptTemplates)
        .where(
          and(
            eq(promptTemplates.userId, userId),
            eq(promptTemplates.promptKey, promptKey),
            eq(promptTemplates.slotKey, slotKey),
            eq(promptTemplates.scope, "global")
          )
        );

      if (existing.length > 0) {
        await db.insert(promptVersions).values({
          id: ulid(),
          templateId: existing[0].id,
          content: existing[0].content,
        });
        await db
          .update(promptTemplates)
          .set({ content, updatedAt: new Date() })
          .where(eq(promptTemplates.id, existing[0].id));
      } else {
        await db.insert(promptTemplates).values({
          id: ulid(),
          userId,
          promptKey,
          slotKey,
          scope: "global",
          projectId: null,
          content,
        });
      }
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ promptKey: string }> }
) {
  const { promptKey } = await params;
  const userId = getUserIdFromRequest(request);

  await db
    .delete(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.promptKey, promptKey),
        eq(promptTemplates.scope, "global")
      )
    );

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Create preview endpoint**

Create `src/app/api/prompt-templates/preview/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getPromptDefinition, getDefaultSlotContents } from "@/lib/ai/prompts/registry";

export async function POST(request: Request) {
  const body = await request.json() as {
    promptKey: string;
    slots: Record<string, string>;
  };

  const def = getPromptDefinition(body.promptKey);
  if (!def) {
    return NextResponse.json({ error: "Unknown prompt" }, { status: 404 });
  }

  const defaults = getDefaultSlotContents(def);
  const merged = { ...defaults, ...body.slots };
  const fullPrompt = def.buildFullPrompt(merged);

  // Calculate highlights — find where each modified slot appears in the full prompt
  const highlights: Array<{ start: number; end: number; slotKey: string }> = [];
  for (const [slotKey, content] of Object.entries(body.slots)) {
    const idx = fullPrompt.indexOf(content);
    if (idx !== -1) {
      highlights.push({ start: idx, end: idx + content.length, slotKey });
    }
  }

  return NextResponse.json({ fullPrompt, highlights });
}
```

- [ ] **Step 5: Create validate endpoint**

Create `src/app/api/prompt-templates/validate/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getPromptDefinition, getDefaultSlotContents } from "@/lib/ai/prompts/registry";

export async function POST(request: Request) {
  const body = await request.json() as {
    promptKey: string;
    content: string;
  };

  const def = getPromptDefinition(body.promptKey);
  if (!def) {
    return NextResponse.json({ error: "Unknown prompt" }, { status: 404 });
  }

  const warnings: string[] = [];
  const defaults = getDefaultSlotContents(def);

  // Check if locked slots' content is preserved
  for (const slot of def.slots) {
    if (!slot.editable) {
      if (!body.content.includes(defaults[slot.key])) {
        warnings.push(
          `Protected section "${slot.nameKey}" was modified. This may cause downstream parsing failures.`
        );
      }
    }
  }

  return NextResponse.json({ valid: warnings.length === 0, warnings });
}
```

- [ ] **Step 6: Create project-level override endpoints**

Create `src/app/api/projects/[id]/prompt-templates/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const templates = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.scope, "project"),
        eq(promptTemplates.projectId, id)
      )
    );
  return NextResponse.json(templates);
}
```

Create `src/app/api/projects/[id]/prompt-templates/[promptKey]/route.ts` — same pattern as global but with `scope: "project"` and `projectId: id`. PUT and DELETE handlers mirror the global versions with the project scope.

- [ ] **Step 7: Verify API routes work**

```bash
pnpm dev
```

Test with curl:
```bash
# Get registry
curl http://localhost:3000/api/prompt-templates/registry

# Save a slot override
curl -X PUT http://localhost:3000/api/prompt-templates/script_generate \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user" \
  -d '{"mode":"slots","slots":{"role_definition":"Custom role..."}}'

# Preview
curl -X POST http://localhost:3000/api/prompt-templates/preview \
  -H "Content-Type: application/json" \
  -d '{"promptKey":"script_generate","slots":{"role_definition":"Custom role..."}}'
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/prompt-templates/ src/app/api/projects/
git commit -m "feat: add prompt template CRUD API routes with preview and validation"
```

---

### Task 6: API Routes — Version History & Presets

**Files:**
- Create: `src/app/api/prompt-templates/[promptKey]/versions/route.ts`
- Create: `src/app/api/prompt-templates/[promptKey]/versions/[vid]/restore/route.ts`
- Create: `src/app/api/prompt-presets/route.ts`
- Create: `src/app/api/prompt-presets/[presetId]/route.ts`
- Create: `src/app/api/prompt-presets/[presetId]/apply/route.ts`
- Create: `src/lib/ai/prompts/presets.ts`

- [ ] **Step 1: Create version history endpoint**

Create `src/app/api/prompt-templates/[promptKey]/versions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, promptVersions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ promptKey: string }> }
) {
  const { promptKey } = await params;
  const userId = getUserIdFromRequest(request);

  // Get all template IDs for this user/prompt
  const templates = await db
    .select({ id: promptTemplates.id, slotKey: promptTemplates.slotKey })
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.promptKey, promptKey)
      )
    );

  const templateIds = templates.map((t) => t.id);
  if (templateIds.length === 0) {
    return NextResponse.json([]);
  }

  // Get all versions for these templates
  const versions = [];
  for (const tmpl of templates) {
    const tmplVersions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.templateId, tmpl.id))
      .orderBy(desc(promptVersions.createdAt));
    versions.push(
      ...tmplVersions.map((v) => ({ ...v, slotKey: tmpl.slotKey }))
    );
  }

  return NextResponse.json(versions);
}
```

- [ ] **Step 2: Create version restore endpoint**

Create `src/app/api/prompt-templates/[promptKey]/versions/[vid]/restore/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates, promptVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ promptKey: string; vid: string }> }
) {
  const { vid } = await params;
  getUserIdFromRequest(request); // auth check

  const [version] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.id, vid));

  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  // Get current template content for version history
  const [template] = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.id, version.templateId));

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Save current as a version before restoring
  await db.insert(promptVersions).values({
    id: ulid(),
    templateId: template.id,
    content: template.content,
  });

  // Restore
  await db
    .update(promptTemplates)
    .set({ content: version.content, updatedAt: new Date() })
    .where(eq(promptTemplates.id, template.id));

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Create built-in presets definition**

Create `src/lib/ai/prompts/presets.ts`:

```typescript
import type { PromptCategory } from "./registry";

export interface BuiltInPreset {
  id: string;
  name: string;
  nameKey: string;
  descriptionKey: string;
  promptKey: string;
  slots: Record<string, string>;
}

// Built-in presets will be populated as prompt content is finalized.
// For now, provide the structure. The actual preset content for "cinematic",
// "anime", and "minimal" variants will be added per-prompt in a follow-up.
export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  // These will be filled in with actual alternative prompt content.
  // Example structure:
  // {
  //   id: "builtin-cinematic-character_extract",
  //   name: "Cinematic",
  //   nameKey: "promptTemplates.presets.cinematic",
  //   descriptionKey: "promptTemplates.presets.cinematicDesc",
  //   promptKey: "character_extract",
  //   slots: { role_definition: "...", style_detection: "..." },
  // },
];
```

- [ ] **Step 4: Create preset API endpoints**

Create `src/app/api/prompt-presets/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptPresets } from "@/lib/db/schema";
import { eq, or, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { BUILT_IN_PRESETS } from "@/lib/ai/prompts/presets";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);

  // User presets from DB
  const userPresets = await db
    .select()
    .from(promptPresets)
    .where(eq(promptPresets.userId, userId));

  // Combine with built-in presets
  const builtIn = BUILT_IN_PRESETS.map((p) => ({
    ...p,
    userId: null,
    createdAt: null,
    isBuiltIn: true,
  }));

  return NextResponse.json([...builtIn, ...userPresets.map((p) => ({ ...p, isBuiltIn: false }))]);
}

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request);
  const body = await request.json() as {
    name: string;
    promptKey: string;
    slots: Record<string, string>;
  };

  const [preset] = await db
    .insert(promptPresets)
    .values({
      id: ulid(),
      name: body.name,
      userId,
      promptKey: body.promptKey,
      slots: body.slots as unknown as Record<string, unknown>,
    })
    .returning();

  return NextResponse.json(preset, { status: 201 });
}
```

Create `src/app/api/prompt-presets/[presetId]/route.ts` (DELETE) and `src/app/api/prompt-presets/[presetId]/apply/route.ts` (POST — applies preset slots as overrides using the same upsert logic as the PUT endpoint).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/prompt-templates/ src/app/api/prompt-presets/ src/lib/ai/prompts/presets.ts
git commit -m "feat: add version history, restore, and preset API routes"
```

---

### Task 7: i18n — Add Translation Keys

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `messages/ja.json`
- Modify: `messages/ko.json`

- [ ] **Step 1: Add Chinese translations**

Add `promptTemplates` namespace to `messages/zh.json`:

```json
"promptTemplates": {
  "title": "提示词管理",
  "subtitle": "管理 AI 生成流程中的提示词模板",
  "categories": {
    "all": "全部",
    "script": "剧本生成",
    "character": "角色",
    "storyboard": "分镜",
    "frame": "画面",
    "video": "视频"
  },
  "prompts": {
    "scriptGenerate": "剧本生成",
    "scriptParse": "剧本解析",
    "scriptSplit": "剧本分集",
    "characterExtract": "角色提取",
    "importCharacterExtract": "导入角色提取",
    "characterImage": "角色设计图",
    "shotSplit": "分镜拆分",
    "frameGenerateFirst": "首帧生成",
    "frameGenerateLast": "尾帧生成",
    "videoGenerate": "视频生成",
    "refVideoGenerate": "参考视频生成",
    "refVideoPrompt": "视频提示词生成"
  },
  "editor": {
    "slotMode": "插槽",
    "advancedMode": "高级",
    "edit": "编辑",
    "preview": "实时预览 — 最终提示词",
    "save": "保存",
    "resetDefault": "恢复默认",
    "resetAll": "全部恢复默认",
    "modified": "已修改",
    "customized": "已自定义",
    "usingGlobal": "使用全局",
    "overridden": "已覆盖",
    "unsavedChanges": "有未保存修改",
    "locked": "不可编辑",
    "protectedWarning": "修改受保护区域可能导致生成失败",
    "structureChanged": "检测到关键结构变更",
    "structureChangedDesc": "您修改了 \"{section}\" 区域的结构定义。这可能导致下游解析失败。",
    "saveAnyway": "仍然保存",
    "restoreSection": "恢复此区域"
  },
  "project": {
    "useProjectPrompts": "使用项目专属提示词",
    "useProjectPromptsDesc": "关闭时使用全局默认配置，开启后可针对此项目自定义",
    "customize": "自定义",
    "useGlobal": "用全局",
    "slotsCount": "{count} 个插槽",
    "modifiedCount": "{count} 个已修改"
  },
  "presets": {
    "title": "预设模板",
    "builtIn": "内置",
    "userCreated": "自定义",
    "apply": "应用",
    "saveAs": "保存为预设",
    "delete": "删除",
    "cinematic": "电影级",
    "cinematicDesc": "强调写实电影感",
    "anime": "动漫风",
    "animeDesc": "优化动漫/漫画生成",
    "minimal": "简洁高效",
    "minimalDesc": "精简提示词，节省 token"
  },
  "versions": {
    "title": "版本历史",
    "restore": "恢复",
    "current": "当前"
  }
}
```

- [ ] **Step 2: Add English translations**

Add the equivalent `promptTemplates` namespace to `messages/en.json` with English values.

- [ ] **Step 3: Add Japanese and Korean translations**

Add minimal translations to `messages/ja.json` and `messages/ko.json` (can be refined later).

- [ ] **Step 4: Commit**

```bash
git add messages/
git commit -m "feat: add prompt template i18n keys for zh/en/ja/ko"
```

---

### Task 8: Zustand Store for Editor UI State

**Files:**
- Create: `src/stores/prompt-template-store.ts`

- [ ] **Step 1: Create the store**

Create `src/stores/prompt-template-store.ts`:

```typescript
import { create } from "zustand";

interface SlotMeta {
  key: string;
  nameKey: string;
  descriptionKey: string;
  defaultContent: string;
  editable: boolean;
}

interface PromptMeta {
  key: string;
  nameKey: string;
  category: string;
  slots: SlotMeta[];
}

interface PromptTemplateStore {
  // Registry data (fetched from server)
  registry: PromptMeta[];
  setRegistry: (registry: PromptMeta[]) => void;

  // Current selection
  selectedPromptKey: string | null;
  selectedSlotKey: string | null;
  selectPrompt: (key: string) => void;
  selectSlot: (key: string) => void;

  // Editor state
  mode: "slots" | "advanced";
  setMode: (mode: "slots" | "advanced") => void;

  // Slot editing
  editedSlots: Record<string, Record<string, string>>; // promptKey -> slotKey -> content
  setSlotContent: (promptKey: string, slotKey: string, content: string) => void;
  resetSlot: (promptKey: string, slotKey: string) => void;

  // Full-text editing
  fullTextContent: string;
  setFullTextContent: (content: string) => void;

  // Dirty tracking
  isDirty: (promptKey: string) => boolean;
  dirtySlots: (promptKey: string) => string[];

  // Server overrides (fetched)
  serverOverrides: Record<string, Record<string, string>>; // promptKey -> slotKey -> content
  setServerOverrides: (overrides: Array<{ promptKey: string; slotKey: string | null; content: string }>) => void;

  // Category filter
  categoryFilter: string;
  setCategoryFilter: (cat: string) => void;
}

export const usePromptTemplateStore = create<PromptTemplateStore>()((set, get) => ({
  registry: [],
  setRegistry: (registry) => set({ registry }),

  selectedPromptKey: null,
  selectedSlotKey: null,
  selectPrompt: (key) => {
    const reg = get().registry.find((r) => r.key === key);
    const firstEditable = reg?.slots.find((s) => s.editable);
    set({
      selectedPromptKey: key,
      selectedSlotKey: firstEditable?.key ?? null,
      mode: "slots",
    });
  },
  selectSlot: (key) => set({ selectedSlotKey: key }),

  mode: "slots",
  setMode: (mode) => set({ mode }),

  editedSlots: {},
  setSlotContent: (promptKey, slotKey, content) =>
    set((state) => ({
      editedSlots: {
        ...state.editedSlots,
        [promptKey]: {
          ...(state.editedSlots[promptKey] ?? {}),
          [slotKey]: content,
        },
      },
    })),
  resetSlot: (promptKey, slotKey) =>
    set((state) => {
      const updated = { ...(state.editedSlots[promptKey] ?? {}) };
      delete updated[slotKey];
      return {
        editedSlots: { ...state.editedSlots, [promptKey]: updated },
      };
    }),

  fullTextContent: "",
  setFullTextContent: (content) => set({ fullTextContent: content }),

  isDirty: (promptKey) => {
    const edited = get().editedSlots[promptKey];
    return edited ? Object.keys(edited).length > 0 : false;
  },
  dirtySlots: (promptKey) => {
    const edited = get().editedSlots[promptKey];
    return edited ? Object.keys(edited) : [];
  },

  serverOverrides: {},
  setServerOverrides: (overrides) => {
    const map: Record<string, Record<string, string>> = {};
    for (const o of overrides) {
      const key = o.slotKey ?? "__full__";
      if (!map[o.promptKey]) map[o.promptKey] = {};
      map[o.promptKey][key] = o.content;
    }
    set({ serverOverrides: map });
  },

  categoryFilter: "all",
  setCategoryFilter: (cat) => set({ categoryFilter: cat }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/prompt-template-store.ts
git commit -m "feat: add Zustand store for prompt template editor UI state"
```

---

### Task 9: Frontend — Global Prompt Settings Page

**Files:**
- Create: `src/app/[locale]/settings/prompts/page.tsx`
- Create: `src/components/prompt-templates/prompt-editor.tsx`
- Create: `src/components/prompt-templates/slot-list.tsx`
- Create: `src/components/prompt-templates/prompt-preview.tsx`
- Create: `src/components/prompt-templates/advanced-editor.tsx`

This is the largest frontend task. Build the three-column editor layout matching the approved mockup.

- [ ] **Step 1: Create the settings page shell**

Create `src/app/[locale]/settings/prompts/page.tsx`:

```typescript
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { PromptEditor } from "@/components/prompt-templates/prompt-editor";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { apiFetch } from "@/lib/api-fetch";

export default function PromptSettingsPage() {
  const t = useTranslations("promptTemplates");
  const router = useRouter();
  const { setRegistry, setServerOverrides } = usePromptTemplateStore();

  useEffect(() => {
    // Fetch registry and existing overrides
    Promise.all([
      apiFetch("/api/prompt-templates/registry").then((r) => r.json()),
      apiFetch("/api/prompt-templates").then((r) => r.json()),
    ]).then(([registry, overrides]) => {
      setRegistry(registry);
      setServerOverrides(overrides);
    });
  }, [setRegistry, setServerOverrides]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-white/80 backdrop-blur-xl px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div>
            <span className="font-display text-sm font-semibold">{t("title")}</span>
            <p className="text-[10px] text-[--text-muted]">{t("subtitle")}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 bg-[--surface]">
        <PromptEditor />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create PromptEditor — the main 3-column layout**

Create `src/components/prompt-templates/prompt-editor.tsx` with:
- Left column: prompt list grouped by category with filter pills at top
- Middle column: slot list for selected prompt
- Right column: editor textarea + live preview pane
- Header bar with mode toggle, save, reset buttons

This component uses `usePromptTemplateStore` for state management, `apiFetch` for API calls, and `useTranslations("promptTemplates")` for i18n.

The component should follow the existing project patterns:
- Use `cn()` for className merging
- Use existing UI components: `Button`, `Textarea`, `Badge`
- Use `toast` from `sonner` for success/error notifications
- Tailwind classes matching STUDIO NOIR theme (see mockup)

Key interactions:
- Clicking a prompt in the left column loads its slots in the middle column
- Clicking a slot loads its content in the editor
- Debounced preview: on slot content change, POST to `/api/prompt-templates/preview` and display the result with highlights
- Save: PUT to `/api/prompt-templates/{promptKey}` with current slot contents
- Reset: DELETE to `/api/prompt-templates/{promptKey}` and reload defaults

- [ ] **Step 3: Create SlotList component**

Create `src/components/prompt-templates/slot-list.tsx` — renders the middle column showing editable slots (with modification badges) and locked slots (grayed out with lock icon).

- [ ] **Step 4: Create PromptPreview component**

Create `src/components/prompt-templates/prompt-preview.tsx` — renders the bottom section of the right column, showing the assembled full prompt with highlighted regions for user-modified slots.

- [ ] **Step 5: Create AdvancedEditor component**

Create `src/components/prompt-templates/advanced-editor.tsx` — full-text textarea that replaces the slot editor when "Advanced" mode is selected. On save, calls `/api/prompt-templates/validate` first and shows warning toast if protected regions were modified.

- [ ] **Step 6: Add navigation link**

Add a link to the prompt settings page. In the existing settings page (`src/app/[locale]/settings/page.tsx`), add a new section card:

```typescript
<Link
  href="/settings/prompts"
  className="flex items-center gap-3 rounded-2xl border border-[--border-subtle] bg-white p-5 transition-all duration-200 hover:border-[--border-hover] hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
>
  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
    <FileText className="h-4 w-4" />
  </div>
  <div>
    <div className="font-display text-sm font-semibold">{t("promptTemplates")}</div>
    <div className="text-xs text-[--text-muted]">{t("promptTemplatesDesc")}</div>
  </div>
</Link>
```

Add corresponding i18n keys to settings namespace: `"promptTemplates": "提示词管理"`, `"promptTemplatesDesc": "自定义 AI 生成提示词模板"`.

- [ ] **Step 7: Verify the page renders**

```bash
pnpm dev
```

Navigate to `/settings/prompts`, verify the three-column layout renders, prompts load from registry, and slot editing works.

- [ ] **Step 8: Commit**

```bash
git add src/app/[locale]/settings/ src/components/prompt-templates/ messages/
git commit -m "feat: add global prompt template management settings page"
```

---

### Task 10: Frontend — Project-Level Override Cards

**Files:**
- Create: `src/components/prompt-templates/project-prompt-cards.tsx`
- Modify: Project settings area (wherever project settings tab exists)

- [ ] **Step 1: Create ProjectPromptCards component**

Create `src/components/prompt-templates/project-prompt-cards.tsx` — renders a card grid showing all prompts with their override status. Each card has:
- Icon + name + promptKey
- Badge: "已覆盖" (green) or "使用全局" (gray)
- Slot count info
- Buttons: "编辑" (opens PromptEditor in dialog or navigates) and "用全局" (deletes project override)

The component accepts `projectId` as prop and fetches project overrides from `/api/projects/{id}/prompt-templates`.

- [ ] **Step 2: Integrate into project settings**

Find the project settings tab/page and add the `ProjectPromptCards` component. If project settings is in the editor view, add a new tab for "提示词配置". Include the toggle switch "使用项目专属提示词".

- [ ] **Step 3: Verify project-level overrides work**

Create a project, open its settings, enable project-specific prompts, customize one, run a generation, and verify the customized prompt is used.

- [ ] **Step 4: Commit**

```bash
git add src/components/prompt-templates/project-prompt-cards.tsx
git commit -m "feat: add project-level prompt override cards UI"
```

---

### Task 11: Frontend — Preset Dialog

**Files:**
- Create: `src/components/prompt-templates/preset-dialog.tsx`

- [ ] **Step 1: Create PresetDialog component**

Create `src/components/prompt-templates/preset-dialog.tsx` — a dialog that:
- Lists built-in presets and user presets from `/api/prompt-presets`
- Each preset shows name, description, and "Apply" button
- "Save as preset" form with name input
- "Delete" button for user presets (not built-in)
- Applying a preset calls `/api/prompt-presets/{id}/apply` and refreshes the editor

Use the existing `Dialog` component from `src/components/ui/dialog.tsx`.

- [ ] **Step 2: Wire preset dialog into PromptEditor**

Add a "预设模板" button in the PromptEditor header that opens the PresetDialog.

- [ ] **Step 3: Commit**

```bash
git add src/components/prompt-templates/preset-dialog.tsx src/components/prompt-templates/prompt-editor.tsx
git commit -m "feat: add preset template management dialog"
```

---

### Task 12: Handle Client-Side Prompt Usage

**Files:**
- Modify: `src/components/editor/character-card.tsx`

- [ ] **Step 1: Move character turnaround prompt to server-side**

`character-card.tsx` currently imports `buildCharacterTurnaroundPrompt` directly. Since the resolver is server-side, change the character image generation to go through the API instead of building the prompt client-side.

If the character image generation already goes through the generate API route (via `single_character_image` action), then the prompt will be resolved server-side automatically. Verify this and remove the direct client-side import if it's only used for display/preview purposes.

If the client needs to preview the prompt, add a call to the preview API endpoint instead.

- [ ] **Step 2: Commit**

```bash
git add src/components/editor/character-card.tsx
git commit -m "refactor: move character prompt building to server-side resolver"
```

---

### Task 13: End-to-End Verification

- [ ] **Step 1: Verify full flow**

1. Start the dev server: `pnpm dev`
2. Navigate to `/settings/prompts`
3. Select "角色提取" prompt
4. Edit the "编剧角色定义" slot — change some text
5. Verify the live preview updates
6. Save the change
7. Switch to "Advanced" mode — verify full text shows with highlighting
8. Reset to default — verify it reverts
9. Create a project, navigate to project settings
10. Enable project-specific prompts, customize one prompt
11. Run a generation — verify the custom prompt is used
12. Save a preset, then apply it to another prompt
13. Check version history and restore a previous version

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat: complete prompt template management system"
```
