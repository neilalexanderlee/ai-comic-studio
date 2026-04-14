# AI Comic Builder - Technical Design Document

## Overview

AI Comic Builder is an open-source platform for generating short video comics (漫剧). Users input a story/script, the AI generates structured storyboards with character consistency, and produces short video segments that are assembled into a final video.

**Target**: Open-source tool, easy to self-deploy, zero external dependencies beyond Node.js and FFmpeg.

## Core User Flow

Semi-automatic with editing breakpoints:

1. User inputs story/script
2. AI refines and structures the script
3. AI extracts characters → generates character reference sheets (turnaround views)
4. **User edits** character appearances
5. AI splits script into shots (10-15s each) with prompts + dialogue
6. **User edits** shot content and dialogue
7. AI generates first/last frames for each shot (referencing character sheets, previous last frame = next first frame)
8. **User edits** generated frames
9. Seedance generates video from first→last frame per shot
10. FFmpeg assembles final video with subtitles

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Next.js 16 App                 │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │
│  │  Frontend  │  │ API Routes│  │ Task Worker  │  │
│  │ App Router │  │  Server   │  │ (SQLite Poll)│  │
│  │ React 19   │  │  Actions  │  │              │  │
│  └───────────┘  └───────────┘  └─────────────┘  │
│         │              │              │           │
│         └──────────────┼──────────────┘           │
│                        │                          │
│              ┌─────────┴─────────┐                │
│              │  SQLite (Drizzle)  │                │
│              │  Data + Task Queue │                │
│              └───────────────────┘                │
│                        │                          │
│              ┌─────────┴─────────┐                │
│              │  Local Filesystem  │                │
│              │  Images / Videos   │                │
│              └───────────────────┘                │
└─────────────────────────────────────────────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
      OpenAI-compat    Gemini     Seedance
      (Text/Image)   (Text/Image)  (Video)
```

### Components

- **Next.js 16 App Router**: Full-stack framework, SSR + Server Actions
- **SQLite + Drizzle ORM**: Data persistence + task queue (zero config, single file)
- **Task Worker**: In-process polling of SQLite task table, executes AI generation tasks
- **Local Filesystem**: Stores generated images, videos, character reference sheets

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 16 (App Router) | Full-stack SSR + API |
| Language | TypeScript | Type safety |
| UI Components | shadcn/ui + Tailwind CSS 4 | Customizable, open-source friendly |
| State Management | Zustand | Lightweight, editor state |
| Database | SQLite + Drizzle ORM | Zero-config, single file |
| Task Queue | SQLite polling | No external dependencies |
| AI - Text | OpenAI SDK (compat) + Google AI SDK | Script/storyboard/character extraction |
| AI - Image | OpenAI-compat image API + Gemini | Character sheets + frames |
| AI - Video | ByteDance Seedance API | First→last frame video generation |
| Video Processing | FFmpeg (fluent-ffmpeg) | Video assembly + subtitles |
| File Storage | Local filesystem (uploads/) | Images/videos |
| i18n | next-intl | Chinese, English, Japanese, Korean |
| Package Manager | pnpm | Fast, disk efficient |
| Code Quality | ESLint + Prettier | Linting + formatting |

## Data Model

### Project

| Field | Type | Description |
|-------|------|-------------|
| id | text (ULID) | Primary key |
| title | text | Project title |
| script | text | Original user script |
| status | text | draft / processing / completed |
| createdAt | integer | Timestamp |
| updatedAt | integer | Timestamp |

### Character

| Field | Type | Description |
|-------|------|-------------|
| id | text (ULID) | Primary key |
| projectId | text | FK → Project |
| name | text | Character name |
| description | text | Appearance, personality, outfit |
| referenceImage | text | Path to turnaround sheet |

### Shot

| Field | Type | Description |
|-------|------|-------------|
| id | text (ULID) | Primary key |
| projectId | text | FK → Project |
| sequence | integer | Order in the video |
| prompt | text | Generation prompt for this shot |
| duration | integer | Target duration in seconds (10-15) |
| firstFrame | text | Path to first frame image |
| lastFrame | text | Path to last frame image |
| videoUrl | text | Path to generated video |
| status | text | pending / generating / completed / failed |

### Dialogue

| Field | Type | Description |
|-------|------|-------------|
| id | text (ULID) | Primary key |
| shotId | text | FK → Shot |
| characterId | text | FK → Character |
| text | text | Dialogue content |
| audioUrl | text | Path to TTS audio (optional) |
| sequence | integer | Order within the shot |

### Task (Queue)

| Field | Type | Description |
|-------|------|-------------|
| id | text (ULID) | Primary key |
| type | text | script_parse / character_extract / character_image / shot_split / frame_generate / video_generate / video_assemble |
| status | text | pending / running / completed / failed |
| payload | text (JSON) | Task input data |
| result | text (JSON) | Task output data |
| error | text | Error message if failed |
| retries | integer | Retry count |
| maxRetries | integer | Max retries allowed |
| createdAt | integer | Timestamp |
| scheduledAt | integer | When to execute |

## Pipeline Design

```
User Input (Story/Script)
         │
         ▼
┌─────────────────────┐
│ 1. Script Parsing    │  LLM (OpenAI-compat / Gemini)
│    → Structured      │  Output: scenes, dialogues, emotions
│      screenplay      │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 2. Character Extract │  LLM identifies characters
│    → Character       │  Output: name, appearance, outfit
│      descriptions    │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 3. Character Sheets  │  Image generation model
│    → Turnaround      │  Output: front/side/back reference
│      reference       │
└──────────┬──────────┘
           ▼  ← USER EDIT BREAKPOINT (edit character appearance)
┌─────────────────────┐
│ 4. Shot Splitting    │  LLM splits script into shots
│    → 10-15s shots    │  Output: prompt + dialogue + camera
│      with prompts    │
└──────────┬──────────┘
           ▼  ← USER EDIT BREAKPOINT (edit shot content)
┌─────────────────────┐
│ 5. Frame Generation  │  Image generation model
│    → First & last    │  Key: reference character sheets
│      frames          │  Key: prev lastFrame = next firstFrame
└──────────┬──────────┘
           ▼  ← USER EDIT BREAKPOINT (edit frames)
┌─────────────────────┐
│ 6. Video Generation  │  Seedance API
│    → 10-15s clips    │  Input: firstFrame → lastFrame + prompt
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 7. Assembly          │  FFmpeg
│    → Final video     │  Add subtitles + audio (optional)
└─────────────────────┘
```

### Key Design Decisions

- Each pipeline step maps to a Task type, with retry on failure
- Steps 3, 4, 5 have **user editing breakpoints** — not fully automatic
- Frame continuity: Shot N's lastFrame = Shot N+1's firstFrame
- Character consistency: All frame generation references character turnaround sheets
- Video assembly via FFmpeg (`fluent-ffmpeg` Node wrapper)

## AI Provider Abstraction

```typescript
interface AIProvider {
  generateText(prompt: string, options?: TextOptions): Promise<string>
  generateImage(prompt: string, options?: ImageOptions): Promise<string>
}

interface VideoProvider {
  generateVideo(params: {
    firstFrame: string
    lastFrame: string
    prompt: string
    duration: number
  }): Promise<string>
}

// Implementations:
// - OpenAIProvider → AIProvider (OpenAI-compatible API)
// - GeminiProvider → AIProvider (Google Gemini API)
// - SeedanceProvider → VideoProvider (ByteDance Seedance API)
```

- Text/image generation uses unified `AIProvider` interface, switchable between OpenAI/Gemini
- Video generation has separate `VideoProvider` interface (currently Seedance only)
- API keys configured via environment variables
- Prompt templates managed separately for easy tuning

## Project Structure

```
AIComicBuilder/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (dashboard)/          # Project list / dashboard
│   │   ├── project/[id]/         # Project editor
│   │   │   ├── script/           # Script editing
│   │   │   ├── characters/       # Character management
│   │   │   ├── storyboard/       # Storyboard editing
│   │   │   └── preview/          # Preview / export
│   │   └── api/                  # API Routes
│   │       ├── projects/
│   │       ├── generate/         # AI generation endpoints
│   │       └── tasks/            # Task status queries
│   ├── lib/
│   │   ├── db/                   # Drizzle schema + migrations
│   │   ├── ai/                   # AI service abstraction
│   │   │   ├── providers/        # OpenAI / Gemini / Seedance adapters
│   │   │   └── prompts/          # Prompt templates
│   │   ├── task-queue/           # SQLite-based task queue
│   │   └── video/                # FFmpeg video processing
│   ├── components/               # UI components
│   │   ├── editor/               # Editor components
│   │   ├── preview/              # Preview components
│   │   └── ui/                   # shadcn/ui components
│   └── stores/                   # Zustand stores
├── messages/                     # i18n translation files
│   ├── zh.json                   # Chinese
│   ├── en.json                   # English
│   ├── ja.json                   # Japanese
│   └── ko.json                   # Korean
├── uploads/                      # Generated file storage
│   ├── characters/               # Character reference sheets
│   ├── frames/                   # First/last frame images
│   └── videos/                   # Generated videos
├── drizzle/                      # Database migration files
└── public/                       # Static assets
```

## Environment Configuration

```env
# AI Providers
OPENAI_API_KEY=
OPENAI_BASE_URL=           # For OpenAI-compatible services
OPENAI_MODEL=              # Default model name

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

## Deployment

Minimal requirements for self-hosting:

1. **Node.js 20+**
2. **FFmpeg** installed on the system
3. **pnpm install && pnpm build && pnpm start**

No Redis, no PostgreSQL, no cloud services required (beyond AI API keys).
