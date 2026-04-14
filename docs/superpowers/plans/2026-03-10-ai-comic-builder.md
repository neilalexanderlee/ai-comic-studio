# AI Comic Builder Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an open-source AI-powered short video comic (漫剧) generation platform with semi-automatic workflow and user editing breakpoints.

**Architecture:** Next.js 16 full-stack monolith with SQLite (Drizzle ORM) for data + task queue, local filesystem for media storage, and pluggable AI providers (OpenAI-compat, Gemini, Seedance). Pipeline steps are tracked as tasks in SQLite and executed by an in-process polling worker.

**Tech Stack:** Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Zustand, Drizzle ORM, SQLite, next-intl, fluent-ffmpeg, OpenAI SDK, Google AI SDK

**Spec:** `docs/superpowers/specs/2026-03-10-ai-comic-builder-design.md`

---

## Chunk 1: Project Foundation

### Task 1: Scaffold Next.js 16 Project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `.env.example`, `.gitignore`

- [ ] **Step 1: Initialize Next.js 16 project**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
```

Select defaults: Yes to all prompts. This creates the base Next.js 16 project with App Router, TypeScript, Tailwind CSS, and ESLint.

- [ ] **Step 2: Verify the project runs**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder
pnpm dev
```

Expected: Dev server starts on http://localhost:3000, default Next.js page renders.

- [ ] **Step 3: Create `.env.example`**

Create `/Users/chenhao/codes/myself/AIComicBuilder/.env.example`:

```env
# AI Providers
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

GEMINI_API_KEY=

SEEDANCE_API_KEY=
SEEDANCE_BASE_URL=

# App
DATABASE_URL=file:./data/aicomic.db
UPLOAD_DIR=./uploads
DEFAULT_LOCALE=zh

# Optional
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Copy to `.env`:

```bash
cp .env.example .env
```

- [ ] **Step 4: Add `.env` and `uploads/` to `.gitignore`**

Append to `.gitignore`:

```
.env
data/
uploads/
```

- [ ] **Step 5: Create upload directories**

```bash
mkdir -p uploads/characters uploads/frames uploads/videos data
```

- [ ] **Step 6: Initialize git and commit**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder
git init
git add -A
git commit -m "chore: scaffold Next.js 16 project with Tailwind CSS"
```

---

### Task 2: Install Core Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install database dependencies**

```bash
pnpm add drizzle-orm better-sqlite3
pnpm add -D drizzle-kit @types/better-sqlite3
```

- [ ] **Step 2: Install AI SDK dependencies**

```bash
pnpm add openai @google/genai
```

- [ ] **Step 3: Install UI and state dependencies**

```bash
pnpm add zustand
pnpm dlx shadcn@latest init
```

When prompted by shadcn init, select:
- Style: Default
- Base color: Neutral
- CSS variables: Yes

- [ ] **Step 4: Install i18n and utility dependencies**

```bash
pnpm add next-intl ulid
pnpm add fluent-ffmpeg
pnpm add -D @types/fluent-ffmpeg
```

- [ ] **Step 5: Verify build still works**

```bash
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: install core dependencies (drizzle, AI SDKs, shadcn, i18n, ffmpeg)"
```

---

### Task 3: Database Schema (Drizzle ORM)

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/index.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle config**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:./data/aicomic.db",
  },
});
```

- [ ] **Step 2: Create database schema**

Create `src/lib/db/schema.ts`:

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  script: text("script").default(""),
  status: text("status", {
    enum: ["draft", "processing", "completed"],
  })
    .notNull()
    .default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").default(""),
  referenceImage: text("reference_image"),
});

export const shots = sqliteTable("shots", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  prompt: text("prompt").default(""),
  duration: integer("duration").notNull().default(10),
  firstFrame: text("first_frame"),
  lastFrame: text("last_frame"),
  videoUrl: text("video_url"),
  status: text("status", {
    enum: ["pending", "generating", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
});

export const dialogues = sqliteTable("dialogues", {
  id: text("id").primaryKey(),
  shotId: text("shot_id")
    .notNull()
    .references(() => shots.id, { onDelete: "cascade" }),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  audioUrl: text("audio_url"),
  sequence: integer("sequence").notNull().default(0),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  type: text("type", {
    enum: [
      "script_parse",
      "character_extract",
      "character_image",
      "shot_split",
      "frame_generate",
      "video_generate",
      "video_assemble",
    ],
  }).notNull(),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  payload: text("payload", { mode: "json" }),
  result: text("result", { mode: "json" }),
  error: text("error"),
  retries: integer("retries").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
});
```

- [ ] **Step 3: Create database connection**

Create `src/lib/db/index.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "node:path";

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db";
const absolutePath = path.resolve(dbPath);

// Prevent multiple connections in dev mode (HMR re-evaluates modules)
const globalForDb = globalThis as unknown as { sqlite: InstanceType<typeof Database> };
const sqlite = globalForDb.sqlite ?? new Database(absolutePath);
if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlite = sqlite;
}

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
```

- [ ] **Step 4: Generate and run initial migration**

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Expected: Migration files created in `drizzle/` directory, database file created at `data/aicomic.db`.

- [ ] **Step 5: Verify database works**

Create a quick test by running:

```bash
pnpm tsx -e "
const Database = require('better-sqlite3');
const db = new Database('./data/aicomic.db');
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
console.log('Tables:', tables.map(t => t.name));
db.close();
"
```

Expected: Shows tables: projects, characters, shots, dialogues, tasks (plus drizzle migration tables).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add database schema with Drizzle ORM (projects, characters, shots, dialogues, tasks)"
```

---

### Task 4: SQLite Task Queue

**Files:**
- Create: `src/lib/task-queue/types.ts`
- Create: `src/lib/task-queue/queue.ts`
- Create: `src/lib/task-queue/worker.ts`

- [ ] **Step 1: Create task queue types**

Create `src/lib/task-queue/types.ts`:

```typescript
import type { tasks } from "@/lib/db/schema";
import type { InferSelectModel } from "drizzle-orm";

export type Task = InferSelectModel<typeof tasks>;

export type TaskType = Task["type"];

export type TaskHandler = (task: Task) => Promise<unknown>;

export type TaskHandlerMap = Partial<Record<NonNullable<TaskType>, TaskHandler>>;
```

- [ ] **Step 2: Create queue operations**

Create `src/lib/task-queue/queue.ts`:

```typescript
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, and, lte, asc, or, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { TaskType } from "./types";

export async function enqueueTask(params: {
  type: NonNullable<TaskType>;
  projectId?: string;
  payload?: unknown;
  maxRetries?: number;
  scheduledAt?: Date;
}) {
  const id = ulid();
  const [task] = await db
    .insert(tasks)
    .values({
      id,
      type: params.type,
      projectId: params.projectId,
      payload: params.payload,
      maxRetries: params.maxRetries ?? 3,
      scheduledAt: params.scheduledAt,
    })
    .returning();
  return task;
}

export async function dequeueTask(): Promise<
  typeof tasks.$inferSelect | null
> {
  const now = new Date();

  // Atomic claim: UPDATE ... WHERE in a single statement to avoid race conditions.
  // Finds the first pending task that is either unscheduled or due, and atomically sets it to "running".
  const [task] = await db
    .update(tasks)
    .set({ status: "running" })
    .where(
      eq(
        tasks.id,
        sql`(SELECT id FROM ${tasks} WHERE ${tasks.status} = 'pending' AND (${tasks.scheduledAt} IS NULL OR ${tasks.scheduledAt} <= ${now.getTime()}) ORDER BY ${tasks.createdAt} ASC LIMIT 1)`
      )
    )
    .returning();

  return task || null;
}

export async function completeTask(id: string, result: unknown) {
  await db
    .update(tasks)
    .set({
      status: "completed",
      result: result as Record<string, unknown>,
    })
    .where(eq(tasks.id, id));
}

export async function failTask(id: string, error: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id));

  if (!task) return;

  const newRetries = (task.retries ?? 0) + 1;
  const maxRetries = task.maxRetries ?? 3;

  if (newRetries < maxRetries) {
    // Retry: set back to pending
    await db
      .update(tasks)
      .set({
        status: "pending",
        retries: newRetries,
        error,
      })
      .where(eq(tasks.id, id));
  } else {
    // Max retries reached: mark as failed
    await db
      .update(tasks)
      .set({
        status: "failed",
        retries: newRetries,
        error,
      })
      .where(eq(tasks.id, id));
  }
}

export async function getTasksByProject(projectId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.createdAt));
}
```

- [ ] **Step 3: Create task worker**

Create `src/lib/task-queue/worker.ts`:

```typescript
import { dequeueTask, completeTask, failTask } from "./queue";
import type { TaskHandlerMap, Task } from "./types";

const POLL_INTERVAL_MS = 2000;

let isRunning = false;
let handlers: TaskHandlerMap = {};

export function registerHandlers(newHandlers: TaskHandlerMap) {
  handlers = { ...handlers, ...newHandlers };
}

async function processTask(task: Task) {
  const handler = task.type ? handlers[task.type] : undefined;
  if (!handler) {
    await failTask(task.id, `No handler registered for task type: ${task.type}`);
    return;
  }

  try {
    const result = await handler(task);
    await completeTask(task.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failTask(task.id, message);
  }
}

async function poll() {
  if (!isRunning) return;

  try {
    const task = await dequeueTask();
    if (task) {
      await processTask(task);
    }
  } catch (err) {
    console.error("[TaskWorker] Poll error:", err);
  }

  if (isRunning) {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
}

export function startWorker() {
  if (isRunning) return;
  isRunning = true;
  console.log("[TaskWorker] Started polling every", POLL_INTERVAL_MS, "ms");
  poll();
}

export function stopWorker() {
  isRunning = false;
  console.log("[TaskWorker] Stopped");
}
```

- [ ] **Step 4: Create barrel export**

Create `src/lib/task-queue/index.ts`:

```typescript
export { enqueueTask, completeTask, failTask, getTasksByProject } from "./queue";
export { registerHandlers, startWorker, stopWorker } from "./worker";
export type { Task, TaskType, TaskHandler, TaskHandlerMap } from "./types";
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add SQLite-based task queue with polling worker"
```

---

### Task 5: i18n Setup (next-intl)

**Files:**
- Create: `src/i18n/request.ts`
- Create: `src/i18n/routing.ts`
- Create: `messages/zh.json`
- Create: `messages/en.json`
- Modify: `src/app/layout.tsx`
- Modify: `next.config.ts`

- [ ] **Step 1: Create i18n routing config**

Create `src/i18n/routing.ts`:

```typescript
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["zh", "en", "ja", "ko"],
  defaultLocale: "zh",
});
```

- [ ] **Step 2: Create i18n request config**

Create `src/i18n/request.ts`:

```typescript
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as "zh" | "en" | "ja" | "ko")) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 3: Create Chinese translation file**

Create `messages/zh.json`:

```json
{
  "common": {
    "appName": "AI 漫剧生成器",
    "create": "创建",
    "save": "保存",
    "delete": "删除",
    "cancel": "取消",
    "confirm": "确认",
    "loading": "加载中...",
    "generating": "生成中...",
    "retry": "重试",
    "back": "返回"
  },
  "dashboard": {
    "title": "我的项目",
    "newProject": "新建项目",
    "noProjects": "还没有项目，点击上方按钮创建一个吧",
    "projectStatus": {
      "draft": "草稿",
      "processing": "处理中",
      "completed": "已完成"
    }
  },
  "project": {
    "title": "项目标题",
    "script": "剧本",
    "characters": "角色",
    "storyboard": "分镜",
    "preview": "预览",
    "scriptPlaceholder": "在这里输入你的故事或剧本...",
    "parseScript": "AI 解析剧本",
    "extractCharacters": "提取角色",
    "generateShots": "生成分镜",
    "generateFrames": "生成画面",
    "generateVideo": "生成视频",
    "assembleVideo": "合成最终视频",
    "shotsCompleted": "{completed} / {total} 个分镜已完成",
    "finalVideo": "最终视频",
    "finalVideoHint": "在 uploads/videos 目录下查看最终合成的视频"
  },
  "character": {
    "name": "角色名",
    "description": "角色描述",
    "referenceImage": "参考图",
    "generateImage": "生成三视图",
    "noCharacters": "还没有角色，先解析剧本提取角色"
  },
  "shot": {
    "sequence": "第 {number} 个分镜",
    "prompt": "画面描述",
    "duration": "时长 (秒)",
    "firstFrame": "首帧",
    "lastFrame": "尾帧",
    "dialogue": "台词",
    "noShots": "还没有分镜，先生成分镜"
  }
}
```

- [ ] **Step 4: Create English translation file**

Create `messages/en.json`:

```json
{
  "common": {
    "appName": "AI Comic Builder",
    "create": "Create",
    "save": "Save",
    "delete": "Delete",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "loading": "Loading...",
    "generating": "Generating...",
    "retry": "Retry",
    "back": "Back"
  },
  "dashboard": {
    "title": "My Projects",
    "newProject": "New Project",
    "noProjects": "No projects yet. Click the button above to create one.",
    "projectStatus": {
      "draft": "Draft",
      "processing": "Processing",
      "completed": "Completed"
    }
  },
  "project": {
    "title": "Project Title",
    "script": "Script",
    "characters": "Characters",
    "storyboard": "Storyboard",
    "preview": "Preview",
    "scriptPlaceholder": "Enter your story or script here...",
    "parseScript": "AI Parse Script",
    "extractCharacters": "Extract Characters",
    "generateShots": "Generate Shots",
    "generateFrames": "Generate Frames",
    "generateVideo": "Generate Video",
    "assembleVideo": "Assemble Final Video",
    "shotsCompleted": "{completed} / {total} shots completed",
    "finalVideo": "Final Video",
    "finalVideoHint": "Check the uploads/videos directory for the final assembled video."
  },
  "character": {
    "name": "Character Name",
    "description": "Description",
    "referenceImage": "Reference Image",
    "generateImage": "Generate Turnaround",
    "noCharacters": "No characters yet. Parse the script to extract characters first."
  },
  "shot": {
    "sequence": "Shot {number}",
    "prompt": "Scene Description",
    "duration": "Duration (seconds)",
    "firstFrame": "First Frame",
    "lastFrame": "Last Frame",
    "dialogue": "Dialogue",
    "noShots": "No shots yet. Generate shots from the script first."
  }
}
```

- [ ] **Step 5: Create placeholder ja.json and ko.json**

Create `messages/ja.json` and `messages/ko.json` as copies of `en.json` (to be translated later). For now, just copy the English version as placeholder:

```bash
cp messages/en.json messages/ja.json
cp messages/en.json messages/ko.json
```

- [ ] **Step 6: Update next.config.ts for next-intl**

Modify `next.config.ts` to add the next-intl plugin:

```typescript
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
```

- [ ] **Step 7: Create locale layout with `[locale]` segment**

Rename `src/app/layout.tsx` to serve as root, and create locale-aware layout:

Create `src/app/[locale]/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const metadata: Metadata = {
  title: "AI Comic Builder",
  description: "AI-powered short video comic generator",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "zh" | "en" | "ja" | "ko")) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

Move the main page to `src/app/[locale]/page.tsx` as the dashboard entry point (placeholder for now):

```tsx
import { useTranslations } from "next-intl";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
    </main>
  );
}
```

Remove the old `src/app/page.tsx` if it still exists. Keep `src/app/layout.tsx` as a minimal root layout (just passes children through) or remove it if Next.js 16 doesn't require it with the `[locale]` segment.

- [ ] **Step 8: Verify i18n works**

```bash
pnpm dev
```

Visit http://localhost:3000/zh — should show "我的项目"
Visit http://localhost:3000/en — should show "My Projects"

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add i18n with next-intl (zh, en, ja, ko)"
```

---

## Chunk 2: AI Provider Layer

### Task 6: AI Provider Interfaces and Types

**Files:**
- Create: `src/lib/ai/types.ts`
- Create: `src/lib/ai/index.ts`

- [ ] **Step 1: Create AI provider types**

Create `src/lib/ai/types.ts`:

```typescript
export interface TextOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ImageOptions {
  model?: string;
  size?: string;
  quality?: string;
  referenceImages?: string[]; // paths to reference images for consistency
}

export interface AIProvider {
  generateText(prompt: string, options?: TextOptions): Promise<string>;
  generateImage(prompt: string, options?: ImageOptions): Promise<string>; // returns file path
}

export interface VideoGenerateParams {
  firstFrame: string; // path to first frame image
  lastFrame: string; // path to last frame image
  prompt: string; // motion/action description
  duration: number; // seconds
}

export interface VideoProvider {
  generateVideo(params: VideoGenerateParams): Promise<string>; // returns file path
}
```

- [ ] **Step 2: Create provider factory**

Create `src/lib/ai/index.ts`:

```typescript
import type { AIProvider, VideoProvider } from "./types";

export type { AIProvider, VideoProvider, TextOptions, ImageOptions, VideoGenerateParams } from "./types";

let defaultAIProvider: AIProvider | null = null;
let defaultVideoProvider: VideoProvider | null = null;

export function setDefaultAIProvider(provider: AIProvider) {
  defaultAIProvider = provider;
}

export function setDefaultVideoProvider(provider: VideoProvider) {
  defaultVideoProvider = provider;
}

export function getAIProvider(): AIProvider {
  if (!defaultAIProvider) {
    throw new Error("No AI provider configured. Call setDefaultAIProvider() first.");
  }
  return defaultAIProvider;
}

export function getVideoProvider(): VideoProvider {
  if (!defaultVideoProvider) {
    throw new Error("No video provider configured. Call setDefaultVideoProvider() first.");
  }
  return defaultVideoProvider;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add AI provider interfaces and factory"
```

---

### Task 7: OpenAI-Compatible Provider

**Files:**
- Create: `src/lib/ai/providers/openai.ts`

- [ ] **Step 1: Implement OpenAI provider**

Create `src/lib/ai/providers/openai.ts`:

```typescript
import OpenAI from "openai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private defaultModel: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.client = new OpenAI({
      apiKey: params?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: params?.baseURL || process.env.OPENAI_BASE_URL,
    });
    this.defaultModel = params?.model || process.env.OPENAI_MODEL || "gpt-4o";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    messages.push({ role: "user", content: prompt });

    const response = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    });

    return response.choices[0]?.message?.content || "";
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const response = await this.client.images.generate({
      model: options?.model || "dall-e-3",
      prompt,
      size: (options?.size as "1024x1024" | "1792x1024" | "1024x1792") || "1024x1024",
      quality: (options?.quality as "standard" | "hd") || "standard",
      n: 1,
    });

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) {
      throw new Error("No image URL returned from OpenAI");
    }

    // Download and save locally
    const imageResponse = await fetch(imageUrl);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const filename = `${ulid()}.png`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add OpenAI-compatible AI provider"
```

---

### Task 8: Gemini Provider

**Files:**
- Create: `src/lib/ai/providers/gemini.ts`

- [ ] **Step 1: Implement Gemini provider**

Create `src/lib/ai/providers/gemini.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;
  private defaultModel: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.client = new GoogleGenAI({
      apiKey: params?.apiKey || process.env.GEMINI_API_KEY || "",
    });
    this.defaultModel = params?.model || "gemini-2.0-flash";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const model = options?.model || this.defaultModel;

    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      config: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        systemInstruction: options?.systemPrompt,
      },
    });

    return response.text || "";
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || "gemini-2.0-flash-preview-image-generation";

    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      config: {
        responseModalities: ["image", "text"],
      },
    });

    // Extract image from response
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) {
      throw new Error("No image returned from Gemini");
    }

    for (const part of parts) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, "base64");
        const ext = part.inlineData.mimeType?.includes("png") ? "png" : "jpg";
        const filename = `${ulid()}.${ext}`;
        const dir = path.join(this.uploadDir, "frames");
        fs.mkdirSync(dir, { recursive: true });
        const filepath = path.join(dir, filename);
        fs.writeFileSync(filepath, buffer);
        return filepath;
      }
    }

    throw new Error("No image data found in Gemini response");
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add Gemini AI provider"
```

---

### Task 9: Seedance Video Provider

**Files:**
- Create: `src/lib/ai/providers/seedance.ts`

- [ ] **Step 1: Implement Seedance provider**

Create `src/lib/ai/providers/seedance.ts`:

```typescript
import type { VideoProvider, VideoGenerateParams } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

export class SeedanceProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.SEEDANCE_API_KEY || "";
    this.baseUrl = params?.baseUrl || process.env.SEEDANCE_BASE_URL || "";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<string> {
    const firstFrameBase64 = fs.readFileSync(params.firstFrame, {
      encoding: "base64",
    });
    const lastFrameBase64 = fs.readFileSync(params.lastFrame, {
      encoding: "base64",
    });

    // Submit video generation task
    const submitResponse = await fetch(`${this.baseUrl}/v1/video/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        first_frame: firstFrameBase64,
        last_frame: lastFrameBase64,
        prompt: params.prompt,
        duration: params.duration,
      }),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      throw new Error(`Seedance submit failed: ${submitResponse.status} ${errText}`);
    }

    const submitResult = (await submitResponse.json()) as { task_id: string };
    const taskId = submitResult.task_id;

    // Poll for completion
    const videoUrl = await this.pollForResult(taskId);

    // Download video
    const videoResponse = await fetch(videoUrl);
    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    const filename = `${ulid()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120; // 10 minutes with 5s interval
    const interval = 5000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const response = await fetch(
        `${this.baseUrl}/v1/video/status/${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      if (!response.ok) continue;

      const result = (await response.json()) as {
        status: string;
        video_url?: string;
        error?: string;
      };

      if (result.status === "completed" && result.video_url) {
        return result.video_url;
      }

      if (result.status === "failed") {
        throw new Error(`Seedance generation failed: ${result.error}`);
      }
    }

    throw new Error("Seedance generation timed out");
  }
}
```

Note: The Seedance API shape above is a placeholder. You will need to adjust the request/response format to match the actual Seedance API documentation. The key pattern (submit → poll → download) will likely remain the same.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add Seedance video provider"
```

---

### Task 10: Provider Initialization

**Files:**
- Create: `src/lib/ai/setup.ts`

- [ ] **Step 1: Create provider setup module**

Create `src/lib/ai/setup.ts`:

```typescript
import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";

let initialized = false;

export function initializeProviders() {
  if (initialized) return;

  // Default to OpenAI provider if OPENAI_API_KEY is set, otherwise Gemini
  if (process.env.OPENAI_API_KEY) {
    setDefaultAIProvider(new OpenAIProvider());
  } else if (process.env.GEMINI_API_KEY) {
    setDefaultAIProvider(new GeminiProvider());
  } else {
    console.warn("[AI] No AI provider API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY.");
  }

  if (process.env.SEEDANCE_API_KEY) {
    setDefaultVideoProvider(new SeedanceProvider());
  } else {
    console.warn("[AI] No Seedance API key configured. Video generation will not work.");
  }

  initialized = true;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add AI provider initialization with auto-detection"
```

---

## Chunk 3: Pipeline Handlers

**Dependency Note:** Implement Task 13 (FFmpeg) BEFORE Task 12 Step 7 (video-assemble), since `video-assemble.ts` imports from `@/lib/video/ffmpeg`. Recommended order: Task 11 → Task 13 → Task 12.

### Task 11: Prompt Templates

**Files:**
- Create: `src/lib/ai/prompts/script-parse.ts`
- Create: `src/lib/ai/prompts/character-extract.ts`
- Create: `src/lib/ai/prompts/shot-split.ts`
- Create: `src/lib/ai/prompts/frame-generate.ts`

- [ ] **Step 1: Script parsing prompt**

Create `src/lib/ai/prompts/script-parse.ts`:

```typescript
export const SCRIPT_PARSE_SYSTEM = `You are a professional screenwriter. Your task is to take a user's story or script and structure it into a proper screenplay format.

Output a JSON object with this structure:
{
  "title": "string - the title of the story",
  "synopsis": "string - a brief synopsis",
  "scenes": [
    {
      "sceneNumber": number,
      "setting": "string - location and time",
      "description": "string - what happens in this scene",
      "mood": "string - the emotional tone",
      "dialogues": [
        {
          "character": "string - character name",
          "text": "string - what they say",
          "emotion": "string - how they say it"
        }
      ]
    }
  ]
}

Rules:
- Keep the original story's intent and tone
- Each scene should be 10-15 seconds when visualized
- Include clear visual descriptions for each scene
- Respond ONLY with the JSON, no markdown fences`;

export function buildScriptParsePrompt(script: string): string {
  return `Please structure the following story into a screenplay:\n\n${script}`;
}
```

- [ ] **Step 2: Character extraction prompt**

Create `src/lib/ai/prompts/character-extract.ts`:

```typescript
export const CHARACTER_EXTRACT_SYSTEM = `You are a character designer. Extract all characters from the screenplay and describe their visual appearance in detail.

Output a JSON array:
[
  {
    "name": "string - character name",
    "description": "string - detailed visual description including: gender, age, hair color/style, eye color, skin tone, body type, typical outfit, distinguishing features",
    "personality": "string - brief personality traits"
  }
]

Rules:
- Be very specific about visual details (colors, styles, proportions)
- These descriptions will be used to generate consistent character images
- Include outfit details that remain consistent across scenes
- Respond ONLY with the JSON array, no markdown fences`;

export function buildCharacterExtractPrompt(screenplay: string): string {
  return `Extract and describe all characters from this screenplay:\n\n${screenplay}`;
}
```

- [ ] **Step 3: Shot splitting prompt**

Create `src/lib/ai/prompts/shot-split.ts`:

```typescript
export const SHOT_SPLIT_SYSTEM = `You are a storyboard director. Split the screenplay into individual shots for video generation.

Each shot is 10-15 seconds of video. Output a JSON array:
[
  {
    "sequence": number,
    "prompt": "string - detailed visual description of the shot for image generation. Include character positions, actions, camera angle, lighting, background. Reference character names.",
    "duration": number (10-15),
    "dialogues": [
      {
        "character": "string - character name",
        "text": "string - dialogue line"
      }
    ],
    "cameraDirection": "string - camera movement description (e.g., 'slow zoom in', 'pan left', 'static')"
  }
]

Rules:
- Each shot should be a single continuous camera movement
- Include enough visual detail for AI image generation
- Reference character names so they can be matched to reference images
- Ensure narrative continuity between consecutive shots
- Respond ONLY with the JSON array, no markdown fences`;

export function buildShotSplitPrompt(screenplay: string, characters: string): string {
  return `Split this screenplay into individual shots.\n\nScreenplay:\n${screenplay}\n\nCharacters:\n${characters}`;
}
```

- [ ] **Step 4: Frame generation prompt builder**

Create `src/lib/ai/prompts/frame-generate.ts`:

```typescript
export function buildFirstFramePrompt(params: {
  shotPrompt: string;
  characterDescriptions: string;
  previousLastFrame?: string;
}): string {
  let prompt = `Generate the FIRST FRAME of this shot as a high-quality anime/comic style illustration.\n\n`;
  prompt += `Shot description: ${params.shotPrompt}\n\n`;
  prompt += `Character visual references:\n${params.characterDescriptions}\n\n`;

  if (params.previousLastFrame) {
    prompt += `IMPORTANT: This frame must visually continue from the previous shot's last frame. Maintain the same character positions, lighting, and setting as the transition point.\n`;
  }

  prompt += `Style: Cinematic anime illustration, detailed backgrounds, expressive characters, dramatic lighting.`;
  return prompt;
}

export function buildLastFramePrompt(params: {
  shotPrompt: string;
  characterDescriptions: string;
  firstFramePath: string;
}): string {
  let prompt = `Generate the LAST FRAME of this shot as a high-quality anime/comic style illustration.\n\n`;
  prompt += `Shot description: ${params.shotPrompt}\n\n`;
  prompt += `Character visual references:\n${params.characterDescriptions}\n\n`;
  prompt += `This is the END state of the shot. Characters should have completed their actions described in the shot.\n`;
  prompt += `Style: Cinematic anime illustration, detailed backgrounds, expressive characters, dramatic lighting.`;
  return prompt;
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add prompt templates for script parsing, character extraction, shot splitting, and frame generation"
```

---

### Task 12: Pipeline Task Handlers

**Files:**
- Create: `src/lib/pipeline/script-parse.ts`
- Create: `src/lib/pipeline/character-extract.ts`
- Create: `src/lib/pipeline/character-image.ts`
- Create: `src/lib/pipeline/shot-split.ts`
- Create: `src/lib/pipeline/frame-generate.ts`
- Create: `src/lib/pipeline/video-generate.ts`
- Create: `src/lib/pipeline/video-assemble.ts`
- Create: `src/lib/pipeline/index.ts`

- [ ] **Step 1: Script parsing handler**

Create `src/lib/pipeline/script-parse.ts`:

```typescript
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getAIProvider } from "@/lib/ai";
import { SCRIPT_PARSE_SYSTEM, buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleScriptParse(task: Task) {
  const payload = task.payload as { projectId: string };
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, payload.projectId));

  if (!project || !project.script) {
    throw new Error("Project or script not found");
  }

  const ai = getAIProvider();
  const result = await ai.generateText(buildScriptParsePrompt(project.script), {
    systemPrompt: SCRIPT_PARSE_SYSTEM,
    temperature: 0.7,
  });

  const screenplay = JSON.parse(result);

  await db
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, payload.projectId));

  // Auto-enqueue character extraction now that screenplay is parsed
  const { enqueueTask } = await import("@/lib/task-queue");
  await enqueueTask({
    type: "character_extract",
    projectId: payload.projectId,
    payload: {
      projectId: payload.projectId,
      screenplay: result,
    },
  });

  return screenplay;
}
```

- [ ] **Step 2: Character extraction handler**

Create `src/lib/pipeline/character-extract.ts`:

```typescript
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { getAIProvider } from "@/lib/ai";
import {
  CHARACTER_EXTRACT_SYSTEM,
  buildCharacterExtractPrompt,
} from "@/lib/ai/prompts/character-extract";
import { ulid } from "ulid";
import type { Task } from "@/lib/task-queue";

export async function handleCharacterExtract(task: Task) {
  const payload = task.payload as { projectId: string; screenplay: string };

  const ai = getAIProvider();
  const result = await ai.generateText(
    buildCharacterExtractPrompt(payload.screenplay),
    { systemPrompt: CHARACTER_EXTRACT_SYSTEM, temperature: 0.5 }
  );

  const extracted = JSON.parse(result) as Array<{
    name: string;
    description: string;
  }>;

  const created = [];
  for (const char of extracted) {
    const id = ulid();
    const [record] = await db
      .insert(characters)
      .values({
        id,
        projectId: payload.projectId,
        name: char.name,
        description: char.description,
      })
      .returning();
    created.push(record);
  }

  return { characters: created };
}
```

- [ ] **Step 3: Character image generation handler**

Create `src/lib/pipeline/character-image.ts`:

```typescript
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { getAIProvider } from "@/lib/ai";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleCharacterImage(task: Task) {
  const payload = task.payload as { characterId: string };

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, payload.characterId));

  if (!character) {
    throw new Error("Character not found");
  }

  const ai = getAIProvider();
  const prompt = `Character turnaround reference sheet showing front view, 3/4 view, side view, and back view of: ${character.description}. Anime/comic art style, clean white background, consistent proportions across all views, professional character design sheet.`;

  const imagePath = await ai.generateImage(prompt, {
    size: "1792x1024", // wide format for turnaround sheet
    quality: "hd",
  });

  await db
    .update(characters)
    .set({ referenceImage: imagePath })
    .where(eq(characters.id, payload.characterId));

  return { imagePath };
}
```

- [ ] **Step 4: Shot splitting handler**

Create `src/lib/pipeline/shot-split.ts`:

```typescript
import { db } from "@/lib/db";
import { shots, dialogues, characters } from "@/lib/db/schema";
import { getAIProvider } from "@/lib/ai";
import {
  SHOT_SPLIT_SYSTEM,
  buildShotSplitPrompt,
} from "@/lib/ai/prompts/shot-split";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Task } from "@/lib/task-queue";

export async function handleShotSplit(task: Task) {
  const payload = task.payload as {
    projectId: string;
    screenplay: string;
  };

  // Get characters for this project
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, payload.projectId));

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const ai = getAIProvider();
  const result = await ai.generateText(
    buildShotSplitPrompt(payload.screenplay, characterDescriptions),
    { systemPrompt: SHOT_SPLIT_SYSTEM, temperature: 0.5 }
  );

  const parsedShots = JSON.parse(result) as Array<{
    sequence: number;
    prompt: string;
    duration: number;
    dialogues: Array<{ character: string; text: string }>;
  }>;

  const created = [];
  for (const shot of parsedShots) {
    const shotId = ulid();
    const [record] = await db
      .insert(shots)
      .values({
        id: shotId,
        projectId: payload.projectId,
        sequence: shot.sequence,
        prompt: shot.prompt,
        duration: shot.duration,
      })
      .returning();

    // Create dialogues for this shot
    for (let i = 0; i < shot.dialogues.length; i++) {
      const dialogue = shot.dialogues[i];
      const matchedChar = projectCharacters.find(
        (c) => c.name === dialogue.character
      );
      if (matchedChar) {
        await db.insert(dialogues).values({
          id: ulid(),
          shotId,
          characterId: matchedChar.id,
          text: dialogue.text,
          sequence: i,
        });
      }
    }

    created.push(record);
  }

  return { shots: created };
}
```

- [ ] **Step 5: Frame generation handler**

Create `src/lib/pipeline/frame-generate.ts`:

```typescript
import { db } from "@/lib/db";
import { shots, characters } from "@/lib/db/schema";
import { getAIProvider } from "@/lib/ai";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { eq, and, lt, desc } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleFrameGenerate(task: Task) {
  const payload = task.payload as {
    shotId: string;
    projectId: string;
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");

  // Get character descriptions
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, payload.projectId));

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  // Find previous shot's last frame for continuity
  const [previousShot] = await db
    .select()
    .from(shots)
    .where(
      and(
        eq(shots.projectId, payload.projectId),
        lt(shots.sequence, shot.sequence)
      )
    )
    .orderBy(desc(shots.sequence))
    .limit(1);

  const ai = getAIProvider();

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  // Generate first frame
  const firstFramePrompt = buildFirstFramePrompt({
    shotPrompt: shot.prompt || "",
    characterDescriptions,
    previousLastFrame: previousShot?.lastFrame || undefined,
  });
  const firstFramePath = await ai.generateImage(firstFramePrompt, {
    quality: "hd",
    referenceImages: projectCharacters
      .map((c) => c.referenceImage)
      .filter(Boolean) as string[],
  });

  // Generate last frame
  const lastFramePrompt = buildLastFramePrompt({
    shotPrompt: shot.prompt || "",
    characterDescriptions,
    firstFramePath,
  });
  const lastFramePath = await ai.generateImage(lastFramePrompt, {
    quality: "hd",
    referenceImages: projectCharacters
      .map((c) => c.referenceImage)
      .filter(Boolean) as string[],
  });

  await db
    .update(shots)
    .set({
      firstFrame: firstFramePath,
      lastFrame: lastFramePath,
      status: "completed",
    })
    .where(eq(shots.id, payload.shotId));

  return { firstFrame: firstFramePath, lastFrame: lastFramePath };
}
```

- [ ] **Step 6: Video generation handler**

Create `src/lib/pipeline/video-generate.ts`:

```typescript
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { getVideoProvider } from "@/lib/ai";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleVideoGenerate(task: Task) {
  const payload = task.payload as { shotId: string };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");
  if (!shot.firstFrame || !shot.lastFrame) {
    throw new Error("Shot frames not generated yet");
  }

  const videoProvider = getVideoProvider();

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  const videoPath = await videoProvider.generateVideo({
    firstFrame: shot.firstFrame,
    lastFrame: shot.lastFrame,
    prompt: shot.prompt || "",
    duration: shot.duration ?? 10,
  });

  await db
    .update(shots)
    .set({ videoUrl: videoPath, status: "completed" })
    .where(eq(shots.id, payload.shotId));

  return { videoPath };
}
```

- [ ] **Step 7: Video assembly handler**

Create `src/lib/pipeline/video-assemble.ts`:

```typescript
import { db } from "@/lib/db";
import { shots, projects, dialogues, characters } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { assembleVideo } from "@/lib/video/ffmpeg";
import type { Task } from "@/lib/task-queue";

export async function handleVideoAssemble(task: Task) {
  const payload = task.payload as { projectId: string };

  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, payload.projectId))
    .orderBy(asc(shots.sequence));

  const videoPaths = projectShots
    .map((s) => s.videoUrl)
    .filter(Boolean) as string[];

  if (videoPaths.length === 0) {
    throw new Error("No video clips to assemble");
  }

  // Get dialogues for subtitles
  const allDialogues = [];
  for (const shot of projectShots) {
    const shotDialogues = await db
      .select({
        text: dialogues.text,
        characterName: characters.name,
        sequence: dialogues.sequence,
        shotSequence: shots.sequence,
      })
      .from(dialogues)
      .innerJoin(characters, eq(dialogues.characterId, characters.id))
      .innerJoin(shots, eq(dialogues.shotId, shots.id))
      .where(eq(dialogues.shotId, shot.id))
      .orderBy(asc(dialogues.sequence));
    allDialogues.push(...shotDialogues);
  }

  const outputPath = await assembleVideo({
    videoPaths,
    subtitles: allDialogues.map((d) => ({
      text: `${d.characterName}: ${d.text}`,
      shotSequence: d.shotSequence,
    })),
    projectId: payload.projectId,
    shotDurations: projectShots.map((s) => s.duration ?? 10),
  });

  await db
    .update(projects)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(projects.id, payload.projectId));

  return { outputPath };
}
```

- [ ] **Step 8: Pipeline registration**

Create `src/lib/pipeline/index.ts`:

```typescript
import { registerHandlers } from "@/lib/task-queue";
import { handleScriptParse } from "./script-parse";
import { handleCharacterExtract } from "./character-extract";
import { handleCharacterImage } from "./character-image";
import { handleShotSplit } from "./shot-split";
import { handleFrameGenerate } from "./frame-generate";
import { handleVideoGenerate } from "./video-generate";
import { handleVideoAssemble } from "./video-assemble";

export function registerPipelineHandlers() {
  registerHandlers({
    script_parse: handleScriptParse,
    character_extract: handleCharacterExtract,
    character_image: handleCharacterImage,
    shot_split: handleShotSplit,
    frame_generate: handleFrameGenerate,
    video_generate: handleVideoGenerate,
    video_assemble: handleVideoAssemble,
  });
}
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add all pipeline task handlers (script, characters, shots, frames, video)"
```

---

### Task 13: FFmpeg Video Processing

**Files:**
- Create: `src/lib/video/ffmpeg.ts`

- [ ] **Step 1: Implement FFmpeg wrapper**

Create `src/lib/video/ffmpeg.ts`:

```typescript
import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

interface SubtitleEntry {
  text: string;
  shotSequence: number;
}

interface AssembleParams {
  videoPaths: string[];
  subtitles: SubtitleEntry[];
  projectId: string;
  shotDurations: number[]; // duration of each shot in seconds
}

/**
 * Generate an SRT subtitle file from dialogue entries.
 * Each subtitle is displayed for the duration of its corresponding shot.
 */
function generateSrtFile(
  subtitles: SubtitleEntry[],
  shotDurations: number[],
  outputPath: string
): string {
  const srtPath = outputPath.replace(/\.mp4$/, ".srt");

  // Calculate cumulative start times for each shot
  const shotStartTimes: number[] = [];
  let cumulative = 0;
  for (const duration of shotDurations) {
    shotStartTimes.push(cumulative);
    cumulative += duration;
  }

  const srtEntries: string[] = [];
  let index = 1;

  for (const sub of subtitles) {
    const shotIdx = sub.shotSequence - 1; // 1-based to 0-based
    if (shotIdx < 0 || shotIdx >= shotDurations.length) continue;

    const startTime = shotStartTimes[shotIdx];
    const endTime = startTime + shotDurations[shotIdx];

    srtEntries.push(
      `${index}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sub.text}\n`
    );
    index++;
  }

  fs.writeFileSync(srtPath, srtEntries.join("\n"));
  return srtPath;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export async function assembleVideo(params: AssembleParams): Promise<string> {
  const { videoPaths, subtitles, projectId, shotDurations } = params;
  const outputDir = path.join(uploadDir, "videos");
  fs.mkdirSync(outputDir, { recursive: true });
  const concatOutputPath = path.join(outputDir, `${projectId}-concat-${ulid()}.mp4`);
  const outputPath = path.join(outputDir, `${projectId}-final-${ulid()}.mp4`);

  // Step 1: Concatenate video clips
  if (videoPaths.length === 1) {
    fs.copyFileSync(videoPaths[0], concatOutputPath);
  } else {
    const concatListPath = path.join(outputDir, `${projectId}-concat.txt`);
    const concatContent = videoPaths
      .map((p) => `file '${path.resolve(p)}'`)
      .join("\n");
    fs.writeFileSync(concatListPath, concatContent);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy"])
        .output(concatOutputPath)
        .on("end", () => {
          fs.unlinkSync(concatListPath);
          resolve();
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg concat failed: ${err.message}`));
        })
        .run();
    });
  }

  // Step 2: Burn in subtitles if any
  if (subtitles.length > 0) {
    const srtPath = generateSrtFile(subtitles, shotDurations, outputPath);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatOutputPath)
        .outputOptions([
          "-vf",
          `subtitles='${srtPath.replace(/'/g, "'\\''")}'`,
        ])
        .output(outputPath)
        .on("end", () => {
          // Cleanup intermediate files
          fs.unlinkSync(concatOutputPath);
          fs.unlinkSync(srtPath);
          resolve();
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg subtitle burn failed: ${err.message}`));
        })
        .run();
    });
  } else {
    // No subtitles, just rename
    fs.renameSync(concatOutputPath, outputPath);
  }

  return outputPath;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add FFmpeg video assembly"
```

---

## Chunk 4: API Routes

### Task 14: Project CRUD API

**Files:**
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/[id]/route.ts`

- [ ] **Step 1: List and create projects**

Create `src/app/api/projects/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { ulid } from "ulid";

export async function GET() {
  const allProjects = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt));
  return NextResponse.json(allProjects);
}

export async function POST(request: Request) {
  const body = (await request.json()) as { title: string; script?: string };
  const id = ulid();

  const [project] = await db
    .insert(projects)
    .values({
      id,
      title: body.title,
      script: body.script || "",
    })
    .returning();

  return NextResponse.json(project, { status: 201 });
}
```

- [ ] **Step 2: Get, update, delete single project**

Create `src/app/api/projects/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, characters, shots, dialogues } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch related data
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, id));

  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, id))
    .orderBy(asc(shots.sequence));

  // Enrich each shot with its dialogues (including character name)
  const enrichedShots = await Promise.all(
    projectShots.map(async (shot) => {
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
    ...project,
    characters: projectCharacters,
    shots: enrichedShots,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Partial<{
    title: string;
    script: string;
    status: string;
  }>;

  const [updated] = await db
    .update(projects)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.delete(projects).where(eq(projects.id, id));
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add project CRUD API routes"
```

---

### Task 15: Generation API Routes

**Files:**
- Create: `src/app/api/projects/[id]/generate/route.ts`
- Create: `src/app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Generation trigger endpoint**

Create `src/app/api/projects/[id]/generate/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { enqueueTask } from "@/lib/task-queue";

type GenerateAction =
  | "script_parse"
  | "character_extract"
  | "character_image"
  | "shot_split"
  | "frame_generate"
  | "video_generate"
  | "video_assemble";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const body = (await request.json()) as {
    action: GenerateAction;
    payload?: Record<string, unknown>;
  };

  const task = await enqueueTask({
    type: body.action,
    projectId,
    payload: { projectId, ...body.payload },
  });

  return NextResponse.json(task, { status: 201 });
}
```

- [ ] **Step 2: Task status endpoint**

Create `src/app/api/tasks/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));

  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add generation trigger and task status API routes"
```

---

### Task 16: Character and Shot API Routes

**Files:**
- Create: `src/app/api/projects/[id]/characters/route.ts`
- Create: `src/app/api/projects/[id]/characters/[characterId]/route.ts`
- Create: `src/app/api/projects/[id]/shots/route.ts`
- Create: `src/app/api/projects/[id]/shots/[shotId]/route.ts`

- [ ] **Step 1: Characters list and update**

Create `src/app/api/projects/[id]/characters/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const result = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));
  return NextResponse.json(result);
}
```

Create `src/app/api/projects/[id]/characters/[characterId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { characterId } = await params;
  const body = (await request.json()) as Partial<{
    name: string;
    description: string;
  }>;

  const [updated] = await db
    .update(characters)
    .set(body)
    .where(eq(characters.id, characterId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { characterId } = await params;
  await db.delete(characters).where(eq(characters.id, characterId));
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: Shots list and update**

Create `src/app/api/projects/[id]/shots/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, dialogues, characters } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  // Enrich with dialogues
  const enriched = await Promise.all(
    projectShots.map(async (shot) => {
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

  return NextResponse.json(enriched);
}
```

Create `src/app/api/projects/[id]/shots/[shotId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { shotId } = await params;
  const body = (await request.json()) as Partial<{
    prompt: string;
    duration: number;
    sequence: number;
  }>;

  const [updated] = await db
    .update(shots)
    .set(body)
    .where(eq(shots.id, shotId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { shotId } = await params;
  await db.delete(shots).where(eq(shots.id, shotId));
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add character and shot CRUD API routes"
```

---

### Task 17: Static File Serving for Uploads

**Files:**
- Create: `src/app/api/uploads/[...path]/route.ts`

- [ ] **Step 1: Create uploads file serving endpoint**

Create `src/app/api/uploads/[...path]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const filePath = path.join(uploadDir, ...segments);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  const resolvedUploadDir = path.resolve(uploadDir);
  if (!resolved.startsWith(resolvedUploadDir)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(resolved);

  return new NextResponse(buffer, {
    headers: { "Content-Type": contentType },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add uploads file serving endpoint"
```

---

## Chunk 5: App Initialization and Worker Startup

### Task 18: App Bootstrap

**Files:**
- Create: `src/lib/bootstrap.ts`
- Create: `src/instrumentation.ts`

- [ ] **Step 1: Create bootstrap module**

Create `src/lib/bootstrap.ts`:

```typescript
import { initializeProviders } from "@/lib/ai/setup";
import { registerPipelineHandlers } from "@/lib/pipeline";
import { startWorker } from "@/lib/task-queue";

let bootstrapped = false;

export function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  console.log("[Bootstrap] Initializing AI providers...");
  initializeProviders();

  console.log("[Bootstrap] Registering pipeline handlers...");
  registerPipelineHandlers();

  console.log("[Bootstrap] Starting task worker...");
  startWorker();

  console.log("[Bootstrap] Ready.");
}
```

- [ ] **Step 2: Create instrumentation file for server startup**

Use Next.js instrumentation hook (runs once at server startup, not on every request or HMR re-evaluation).

Create `src/instrumentation.ts`:

```typescript
export async function register() {
  // Only run on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("@/lib/bootstrap");
    bootstrap();
  }
}
```

- [ ] **Step 3: Verify server starts cleanly**

```bash
pnpm dev
```

Expected: Console shows bootstrap messages, no errors. Dev server runs.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add app bootstrap with provider init and worker startup via instrumentation"
```

---

## Chunk 6: Frontend — Dashboard

### Task 19: Shared Utilities + Dashboard Page (Project List)

**Files:**
- Create: `src/lib/utils/upload-url.ts`
- Create: `src/app/[locale]/(dashboard)/page.tsx`
- Create: `src/app/[locale]/(dashboard)/layout.tsx`
- Create: `src/components/project-card.tsx`
- Create: `src/components/create-project-dialog.tsx`

- [ ] **Step 1: Create shared uploadUrl utility**

Create `src/lib/utils/upload-url.ts`:

```typescript
/**
 * Convert a local file path (e.g., "./uploads/frames/abc.png") to an API URL
 * for serving via /api/uploads/[...path].
 */
export function uploadUrl(filePath: string): string {
  return `/api/uploads/${filePath.replace(/^\.?\/?uploads\//, "")}`;
}
```

This avoids duplicating the path-cleaning regex across multiple components.

- [ ] **Step 2: Install shadcn/ui components needed**

```bash
pnpm dlx shadcn@latest add button card dialog input label textarea badge
```

- [ ] **Step 2: Create dashboard layout**

Create `src/app/[locale]/(dashboard)/layout.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center px-4">
          <h1 className="text-lg font-semibold">{t("appName")}</h1>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Create ProjectCard component**

Create `src/components/project-card.tsx`:

```tsx
"use client";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLocale } from "next-intl";

interface ProjectCardProps {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export function ProjectCard({ id, title, status, createdAt }: ProjectCardProps) {
  const t = useTranslations("dashboard.projectStatus");
  const locale = useLocale();

  const statusVariant =
    status === "completed"
      ? "default"
      : status === "processing"
        ? "secondary"
        : "outline";

  return (
    <Link href={`/${locale}/project/${id}/script`}>
      <Card className="cursor-pointer transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{title}</CardTitle>
            <Badge variant={statusVariant}>
              {t(status as "draft" | "processing" | "completed")}
            </Badge>
          </div>
          <CardDescription>
            {new Date(createdAt).toLocaleDateString()}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 4: Create CreateProjectDialog**

Create `src/components/create-project-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

export function CreateProjectDialog() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setLoading(true);

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    const project = await res.json();
    setOpen(false);
    setTitle("");
    setLoading(false);
    router.push(`/${locale}/project/${project.id}/script`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t("dashboard.newProject")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dashboard.newProject")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title">{t("project.title")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Comic"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <Button onClick={handleCreate} disabled={loading || !title.trim()} className="w-full">
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Create dashboard page**

Create `src/app/[locale]/(dashboard)/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ProjectCard } from "@/components/project-card";
import { CreateProjectDialog } from "@/components/create-project-dialog";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const allProjects = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <CreateProjectDialog />
      </div>

      {allProjects.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">
          {t("noProjects")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allProjects.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              title={project.title}
              status={project.status}
              createdAt={project.createdAt.toISOString()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

Remove the old `src/app/[locale]/page.tsx` placeholder if it still exists.

- [ ] **Step 6: Verify dashboard renders**

```bash
pnpm dev
```

Visit http://localhost:3000/zh — should show dashboard with "我的项目" header and "新建项目" button.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add dashboard page with project list and create dialog"
```

---

## Chunk 7: Frontend — Project Editor

### Task 20: Project Editor Layout

**Files:**
- Create: `src/app/[locale]/project/[id]/layout.tsx`
- Create: `src/components/editor/project-nav.tsx`
- Create: `src/stores/project-store.ts`

- [ ] **Step 1: Create Zustand project store**

Create `src/stores/project-store.ts`:

```typescript
import { create } from "zustand";

interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
}

interface Dialogue {
  id: string;
  text: string;
  characterId: string;
  characterName: string;
  sequence: number;
}

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
}

interface Project {
  id: string;
  title: string;
  script: string;
  status: string;
  characters: Character[];
  shots: Shot[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  fetchProject: (id: string) => Promise<void>;
  updateScript: (script: string) => void;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: null,
  loading: false,

  fetchProject: async (id: string) => {
    set({ loading: true });
    const res = await fetch(`/api/projects/${id}`);
    const data = await res.json();
    set({ project: data, loading: false });
  },

  updateScript: (script: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, script } : null,
    }));
  },

  setProject: (project: Project) => {
    set({ project });
  },
}));
```

- [ ] **Step 2: Create project navigation**

Create `src/components/editor/project-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";

interface ProjectNavProps {
  projectId: string;
}

export function ProjectNav({ projectId }: ProjectNavProps) {
  const t = useTranslations("project");
  const locale = useLocale();
  const pathname = usePathname();

  const tabs = [
    { key: "script", href: `/${locale}/project/${projectId}/script` },
    { key: "characters", href: `/${locale}/project/${projectId}/characters` },
    { key: "storyboard", href: `/${locale}/project/${projectId}/storyboard` },
    { key: "preview", href: `/${locale}/project/${projectId}/preview` },
  ] as const;

  return (
    <nav className="flex gap-1 border-b px-4">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            pathname === tab.href
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Create project editor layout**

Create `src/app/[locale]/project/[id]/layout.tsx`:

```tsx
"use client";

import { useEffect, use } from "react";
import { useProjectStore } from "@/stores/project-store";
import { ProjectNav } from "@/components/editor/project-nav";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("common");
  const locale = useLocale();
  const { project, loading, fetchProject } = useProjectStore();

  useEffect(() => {
    fetchProject(id);
  }, [id, fetchProject]);

  if (loading || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center gap-4 px-4">
          <Link href={`/${locale}`}>
            <Button variant="ghost" size="sm">
              {t("back")}
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">{project.title}</h1>
        </div>
      </header>
      <ProjectNav projectId={id} />
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add project editor layout with tab navigation and Zustand store"
```

---

### Task 21: Script Editor Page

**Files:**
- Create: `src/app/[locale]/project/[id]/script/page.tsx`
- Create: `src/components/editor/script-editor.tsx`

- [ ] **Step 1: Create script editor component**

Create `src/components/editor/script-editor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useTranslations } from "next-intl";

export function ScriptEditor() {
  const t = useTranslations();
  const { project, updateScript, fetchProject } = useProjectStore();
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  if (!project) return null;

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: project.script }),
    });
    setSaving(false);
  }

  async function handleParseScript() {
    if (!project) return;
    setGenerating(true);

    // Save script first
    await handleSave();

    // Trigger script parsing (character extraction is auto-enqueued upon completion)
    await fetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "script_parse" }),
    });

    setGenerating(false);

    // TODO: Replace with proper polling or SSE for task status updates
    // For now, periodically refresh to check for results
    const pollInterval = setInterval(() => fetchProject(project.id), 5000);
    setTimeout(() => clearInterval(pollInterval), 120000); // Stop after 2 min
  }

  return (
    <div className="space-y-4">
      <Textarea
        value={project.script}
        onChange={(e) => updateScript(e.target.value)}
        placeholder={t("project.scriptPlaceholder")}
        rows={20}
        className="min-h-[400px] font-mono"
      />
      <div className="flex gap-2">
        <Button onClick={handleSave} variant="outline" disabled={saving}>
          {saving ? t("common.loading") : t("common.save")}
        </Button>
        <Button onClick={handleParseScript} disabled={generating}>
          {generating ? t("common.generating") : t("project.parseScript")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create script page**

Create `src/app/[locale]/project/[id]/script/page.tsx`:

```tsx
import { ScriptEditor } from "@/components/editor/script-editor";

export default function ScriptPage() {
  return <ScriptEditor />;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add script editor page"
```

---

### Task 22: Characters Page

**Files:**
- Create: `src/app/[locale]/project/[id]/characters/page.tsx`
- Create: `src/components/editor/character-card.tsx`

- [ ] **Step 1: Create character card component**

Create `src/components/editor/character-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";

interface CharacterCardProps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  referenceImage: string | null;
  onUpdate: () => void;
}

export function CharacterCard({
  id,
  projectId,
  name,
  description,
  referenceImage,
  onUpdate,
}: CharacterCardProps) {
  const t = useTranslations();
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [generating, setGenerating] = useState(false);

  async function handleSave() {
    await fetch(`/api/projects/${projectId}/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc }),
    });
    onUpdate();
  }

  async function handleGenerateImage() {
    setGenerating(true);
    await fetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "character_image",
        payload: { characterId: id },
      }),
    });
    setGenerating(false);
    // Poll for updates
    setTimeout(onUpdate, 5000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSave}
            className="text-lg font-bold"
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          onBlur={handleSave}
          rows={4}
          placeholder={t("character.description")}
        />
        {referenceImage ? (
          <img
            src={uploadUrl(referenceImage)}
            // Import { uploadUrl } from "@/lib/utils/upload-url" at the top
            alt={name}
            className="w-full rounded-lg"
          />
        ) : (
          <Button
            onClick={handleGenerateImage}
            disabled={generating}
            variant="outline"
            className="w-full"
          >
            {generating ? t("common.generating") : t("character.generateImage")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create characters page**

Create `src/app/[locale]/project/[id]/characters/page.tsx`:

```tsx
"use client";

import { useProjectStore } from "@/stores/project-store";
import { CharacterCard } from "@/components/editor/character-card";
import { useTranslations } from "next-intl";

export default function CharactersPage() {
  const t = useTranslations("character");
  const { project, fetchProject } = useProjectStore();

  if (!project) return null;

  return (
    <div className="space-y-6">
      {project.characters.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">
          {t("noCharacters")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {project.characters.map((char) => (
            <CharacterCard
              key={char.id}
              id={char.id}
              projectId={project.id}
              name={char.name}
              description={char.description}
              referenceImage={char.referenceImage}
              onUpdate={() => fetchProject(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add characters page with editable character cards"
```

---

### Task 23: Storyboard Page

**Files:**
- Create: `src/app/[locale]/project/[id]/storyboard/page.tsx`
- Create: `src/components/editor/shot-card.tsx`

- [ ] **Step 1: Create shot card component**

Create `src/components/editor/shot-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

interface Dialogue {
  id: string;
  text: string;
  characterName: string;
}

interface ShotCardProps {
  id: string;
  projectId: string;
  sequence: number;
  prompt: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
  onUpdate: () => void;
}

export function ShotCard({
  id,
  projectId,
  sequence,
  prompt,
  duration,
  firstFrame,
  lastFrame,
  videoUrl,
  status,
  dialogues,
  onUpdate,
}: ShotCardProps) {
  const t = useTranslations();
  const [editPrompt, setEditPrompt] = useState(prompt);
  const [generating, setGenerating] = useState(false);

  async function handleSave() {
    await fetch(`/api/projects/${projectId}/shots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: editPrompt }),
    });
  }

  async function handleGenerateFrames() {
    setGenerating(true);
    await fetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "frame_generate",
        payload: { shotId: id },
      }),
    });
    setGenerating(false);
    setTimeout(onUpdate, 10000);
  }

  async function handleGenerateVideo() {
    setGenerating(true);
    await fetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "video_generate",
        payload: { shotId: id },
      }),
    });
    setGenerating(false);
    setTimeout(onUpdate, 30000);
  }

  // Import { uploadUrl } from "@/lib/utils/upload-url" at the top of this file

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("shot.sequence", { number: sequence })}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{duration}s</Badge>
            <Badge variant={status === "completed" ? "default" : "secondary"}>
              {status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          onBlur={handleSave}
          rows={3}
          placeholder={t("shot.prompt")}
        />

        {/* Dialogues */}
        {dialogues.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("shot.dialogue")}</p>
            {dialogues.map((d) => (
              <p key={d.id} className="text-muted-foreground text-sm">
                <span className="font-medium">{d.characterName}:</span> {d.text}
              </p>
            ))}
          </div>
        )}

        {/* Frames */}
        <div className="grid grid-cols-2 gap-2">
          {firstFrame ? (
            <div>
              <p className="mb-1 text-xs font-medium">{t("shot.firstFrame")}</p>
              <img src={uploadUrl(firstFrame)} alt="First frame" className="rounded" />
            </div>
          ) : null}
          {lastFrame ? (
            <div>
              <p className="mb-1 text-xs font-medium">{t("shot.lastFrame")}</p>
              <img src={uploadUrl(lastFrame)} alt="Last frame" className="rounded" />
            </div>
          ) : null}
        </div>

        {/* Video */}
        {videoUrl && (
          <video controls className="w-full rounded" src={uploadUrl(videoUrl)} />
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {!firstFrame && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleGenerateFrames}
              disabled={generating}
            >
              {generating ? t("common.generating") : t("project.generateFrames")}
            </Button>
          )}
          {firstFrame && lastFrame && !videoUrl && (
            <Button
              size="sm"
              onClick={handleGenerateVideo}
              disabled={generating}
            >
              {generating ? t("common.generating") : t("project.generateVideo")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create storyboard page**

Create `src/app/[locale]/project/[id]/storyboard/page.tsx`:

```tsx
"use client";

import { useProjectStore } from "@/stores/project-store";
import { ShotCard } from "@/components/editor/shot-card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useState } from "react";

export default function StoryboardPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const [generating, setGenerating] = useState(false);

  if (!project) return null;

  async function handleGenerateShots() {
    if (!project) return;
    setGenerating(true);
    await fetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "shot_split" }),
    });
    setGenerating(false);
    setTimeout(() => fetchProject(project.id), 5000);
  }

  return (
    <div className="space-y-6">
      {project.shots.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground mb-4">{t("shot.noShots")}</p>
          <Button onClick={handleGenerateShots} disabled={generating}>
            {generating ? t("common.generating") : t("project.generateShots")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {project.shots.map((shot) => (
            <ShotCard
              key={shot.id}
              id={shot.id}
              projectId={project.id}
              sequence={shot.sequence}
              prompt={shot.prompt}
              duration={shot.duration}
              firstFrame={shot.firstFrame}
              lastFrame={shot.lastFrame}
              videoUrl={shot.videoUrl}
              status={shot.status}
              dialogues={shot.dialogues || []}
              onUpdate={() => fetchProject(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add storyboard page with shot cards (frame/video generation)"
```

---

### Task 24: Preview Page

**Files:**
- Create: `src/app/[locale]/project/[id]/preview/page.tsx`

- [ ] **Step 1: Create preview page**

Create `src/app/[locale]/project/[id]/preview/page.tsx`:

```tsx
"use client";

import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useState } from "react";

export default function PreviewPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const [assembling, setAssembling] = useState(false);

  if (!project) return null;

  const allShotsHaveVideo = project.shots.every((s) => s.videoUrl);
  const completedVideos = project.shots.filter((s) => s.videoUrl).length;

  async function handleAssemble() {
    if (!project) return;
    setAssembling(true);
    await fetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "video_assemble" }),
    });
    setAssembling(false);
    setTimeout(() => fetchProject(project.id), 10000);
  }

  // Import { uploadUrl } from "@/lib/utils/upload-url" at the top of this file

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm">
            {t("project.shotsCompleted", { completed: completedVideos, total: project.shots.length })}
          </p>
        </div>
        <Button
          onClick={handleAssemble}
          disabled={!allShotsHaveVideo || assembling}
        >
          {assembling ? t("common.generating") : t("project.assembleVideo")}
        </Button>
      </div>

      {/* Show individual shot videos */}
      <div className="grid gap-4 md:grid-cols-2">
        {project.shots
          .filter((s) => s.videoUrl)
          .map((shot) => (
            <div key={shot.id} className="space-y-1">
              <p className="text-sm font-medium">
                {t("shot.sequence", { number: shot.sequence })}
              </p>
              <video
                controls
                className="w-full rounded"
                src={uploadUrl(shot.videoUrl!)}
              />
            </div>
          ))}
      </div>

      {/* Final assembled video if project is completed */}
      {project.status === "completed" && (
        <div className="border-t pt-6">
          <h3 className="mb-4 text-lg font-semibold">{t("project.finalVideo")}</h3>
          <p className="text-muted-foreground text-sm">
            {t("project.finalVideoHint")}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add preview page with video assembly"
```

---

## Chunk 8: Final Wiring and Verification

### Task 25: Verify Full Build

- [ ] **Step 1: Run the full build**

```bash
cd /Users/chenhao/codes/myself/AIComicBuilder
pnpm build
```

Expected: Build completes without errors.

- [ ] **Step 2: Fix any TypeScript or build errors**

Address any issues that arise during the build. Common issues:
- Missing imports
- Type mismatches
- shadcn/ui component paths

- [ ] **Step 3: Verify dev server runs end-to-end**

```bash
pnpm dev
```

Test:
1. Visit http://localhost:3000/zh — dashboard loads
2. Click "新建项目" — dialog opens, create a project
3. Navigate to script tab — textarea appears
4. Navigate to characters tab — empty state shown
5. Navigate to storyboard tab — empty state shown
6. Navigate to preview tab — preview page loads

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve build issues and verify end-to-end flow"
```

---

## Summary

| Chunk | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-5 | Project scaffold, deps, DB schema, task queue, i18n |
| 2 | 6-10 | AI provider interfaces, OpenAI/Gemini/Seedance implementations |
| 3 | 11-13 | Prompt templates, pipeline handlers, FFmpeg |
| 4 | 14-17 | API routes (CRUD, generation, file serving) |
| 5 | 18 | Bootstrap / worker startup |
| 6 | 19 | Dashboard (project list) |
| 7 | 20-24 | Project editor (layout, script, characters, storyboard, preview) |
| 8 | 25 | Build verification |

**Total: 25 tasks, ~80 steps**

After completing this plan, you will have a fully functional AI Comic Builder with:
- Project management (create, list, edit)
- Script input and AI parsing
- Character extraction and reference image generation
- Storyboard splitting and frame generation
- Video generation (Seedance) and assembly (FFmpeg)
- i18n support (zh, en, ja, ko)
- All data persisted in SQLite, files on local filesystem
