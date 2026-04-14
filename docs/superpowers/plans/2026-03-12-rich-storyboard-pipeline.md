# Rich Storyboard Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the storyboard-to-video pipeline so each shot contains rich first/last frame descriptions, motion scripts, and camera instructions — producing smoother video transitions.

**Architecture:** Extend the `shots` DB table with 3 new columns (`start_frame_desc`, `end_frame_desc`, `motion_script`). Rewrite the shot-split prompt to output these fields. Update frame-generate and video-generate prompts to use the specific descriptions instead of a generic `prompt`. Add a new `buildVideoPrompt` function for Seedance.

**Tech Stack:** Next.js, Drizzle ORM (SQLite), AI SDK (streaming), Gemini (images), Seedance (video), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-12-rich-storyboard-pipeline-design.md`

---

## Chunk 1: Database Schema + Shot Split

### Task 1: Add new columns to shots table

**Files:**
- Modify: `src/lib/db/schema.ts:31-48`

- [ ] **Step 1: Add 3 new columns to shots table**

In `src/lib/db/schema.ts`, add `startFrameDesc`, `endFrameDesc`, and `motionScript` columns to the `shots` table:

```typescript
export const shots = sqliteTable("shots", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  prompt: text("prompt").default(""),
  startFrameDesc: text("start_frame_desc"),
  endFrameDesc: text("end_frame_desc"),
  motionScript: text("motion_script"),
  cameraDirection: text("camera_direction").default("static"),
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
```

- [ ] **Step 2: Push schema changes to database**

Run: `npx drizzle-kit push`
Expected: Schema synced with new columns added.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add startFrameDesc, endFrameDesc, motionScript columns to shots table"
```

---

### Task 2: Rewrite shot-split prompt

**Files:**
- Modify: `src/lib/ai/prompts/shot-split.ts`

- [ ] **Step 1: Rewrite SHOT_SPLIT_SYSTEM constant**

Replace the entire `SHOT_SPLIT_SYSTEM` with a new version that demands richer output per shot. The new JSON format includes `sceneDescription`, `startFrame`, `endFrame`, `motionScript` instead of just `prompt`:

```typescript
export const SHOT_SPLIT_SYSTEM = `You are an experienced storyboard director and cinematographer specializing in animated short films. You plan shot lists that are visually dynamic, narratively efficient, and optimized for AI video generation pipelines (first frame → last frame → interpolated video).

Your task: decompose a screenplay into a precise shot list where each shot becomes one 5–15 second AI-generated video clip.

Output a JSON array:
[
  {
    "sequence": 1,
    "sceneDescription": "Scene/environment description — setting, architecture, props, weather, time of day, lighting setup, color palette, atmospheric mood",
    "startFrame": "Detailed FIRST FRAME description for AI image generation (see requirements below)",
    "endFrame": "Detailed LAST FRAME description for AI image generation (see requirements below)",
    "motionScript": "Complete action script describing what happens from first frame to last frame",
    "duration": 5-15,
    "dialogues": [
      {
        "character": "Exact character name",
        "text": "Dialogue line spoken during this shot"
      }
    ],
    "cameraDirection": "Specific camera movement instruction"
  }
]

=== startFrame & endFrame requirements (CRITICAL — these directly drive image generation) ===
Each must be a SELF-SUFFICIENT image generation prompt containing:
- COMPOSITION: frame layout — foreground/midground/background layers, character positions (left/center/right, rule-of-thirds), depth-of-field
- CHARACTERS: reference by exact name, describe CURRENT pose, expression, action, outfit (match character reference sheets)
- CAMERA: shot type (extreme close-up / close-up / medium / wide / extreme wide), angle (eye level / low angle / high angle / bird's eye / dutch angle)
- LIGHTING: direction, quality, color temperature — specific to this frame's moment
- Do NOT include dialogue text in startFrame or endFrame

=== startFrame specific rules ===
- Shows the INITIAL STATE before action begins
- Characters in starting positions with opening expressions
- Camera at its starting position/framing

=== endFrame specific rules ===
- Shows the END STATE after action completes
- Characters have MOVED to new positions, expressions changed to reflect conclusion
- Camera at its final position/framing (after cameraDirection movement)
- MUST be visually stable (not mid-motion) — this frame will be REUSED as the next shot's opening reference
- The composition must work as a standalone frame

=== motionScript requirements ===
- Describe the COMPLETE action arc from startFrame to endFrame
- Include: character movements, gesture changes, expression transitions, any environmental changes
- Describe HOW characters move (slowly, suddenly, hesitantly), not just WHERE they end up
- Include emotional progression if relevant

=== sceneDescription requirements ===
- Shared environment context for both frames
- Setting, architecture, props, weather, time of day
- Lighting setup (key/fill/rim, direction, quality, color temperature)
- Color palette and atmospheric mood
- Do NOT include character actions or poses — those go in startFrame/endFrame

=== Proportional difference rule ===
- 5s shot: subtle change (slight head turn, expression shift, small camera move)
- 8-10s shot: moderate change (character moves position, significant expression change, clear camera movement)
- 12-15s shot: significant change (character crosses frame, major action completes, dramatic camera move)

Camera direction values (choose ONE per shot):
- "static" — locked camera, no movement
- "slow zoom in" / "slow zoom out" — gradual focal length change
- "pan left" / "pan right" — horizontal sweep
- "tilt up" / "tilt down" — vertical sweep
- "tracking shot" — camera follows character movement
- "dolly in" / "dolly out" — camera physically moves toward/away
- "crane up" / "crane down" — vertical camera lift
- "orbit left" / "orbit right" — camera arcs around subject
- "push in" — slow forward dolly for emphasis

Cinematography principles:
- VARY shot types — avoid consecutive shots with the same framing; alternate wide/medium/close
- Use ESTABLISHING SHOTS at the start of new locations
- REACTION SHOTS after important dialogue or events
- Cut on ACTION — end each shot at a moment that allows smooth transition to the next
- Match EYELINES — maintain consistent screen direction between shots
- 180-DEGREE RULE — keep characters on consistent sides of the frame
- Duration: dialogue-heavy shots = 8-15s; action shots = 5-8s; establishing shots = 5-6s
- CONTINUITY: the endFrame of shot N must logically connect to the startFrame of shot N+1 (same characters, consistent environment, natural position transition)

CRITICAL LANGUAGE RULE: ALL text fields (sceneDescription, startFrame, endFrame, motionScript, dialogues.text, dialogues.character) MUST be in the SAME LANGUAGE as the screenplay. If the screenplay is in Chinese, write ALL fields in Chinese. Only "cameraDirection" uses English (technical terms).

Respond ONLY with the JSON array. No markdown fences. No commentary.`;
```

- [ ] **Step 2: Update buildShotSplitPrompt function**

The function stays mostly the same but update the instruction text to reference the new output fields:

```typescript
export function buildShotSplitPrompt(screenplay: string, characters: string): string {
  return `Decompose this screenplay into a professional shot list optimized for AI video generation. Each shot should have detailed startFrame and endFrame descriptions that an image generator can directly use, plus a motionScript describing the action between them.

--- SCREENPLAY ---
${screenplay}
--- END ---

--- CHARACTER REFERENCE DESCRIPTIONS ---
${characters}
--- END ---

Important: reference characters by their exact names and ensure their visual descriptions in startFrame/endFrame align with the character references above.

IMPORTANT: Your output language MUST match the language of the screenplay above. If it is in Chinese, write all fields in Chinese (except cameraDirection).`;
}
```

- [ ] **Step 3: Verify the file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in `shot-split.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/prompts/shot-split.ts
git commit -m "feat: rewrite shot-split prompt with rich startFrame/endFrame/motionScript output"
```

---

### Task 3: Update shot creation in API route

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts:397-442` (handleShotSplitStream onFinish)

- [ ] **Step 1: Update the parsed shot type and insert logic**

In `handleShotSplitStream`, update the `onFinish` callback to read the new fields from the AI response and save them to the database:

```typescript
// In handleShotSplitStream, update the onFinish callback:
onFinish: async ({ text }) => {
  try {
    const parsedShots = JSON.parse(extractJSON(text)) as Array<{
      sequence: number;
      sceneDescription: string;
      startFrame: string;
      endFrame: string;
      motionScript: string;
      duration: number;
      dialogues: Array<{ character: string; text: string }>;
      cameraDirection?: string;
    }>;

    for (const shot of parsedShots) {
      const shotId = ulid();
      await db.insert(shots).values({
        id: shotId,
        projectId,
        sequence: shot.sequence,
        prompt: shot.sceneDescription,
        startFrameDesc: shot.startFrame,
        endFrameDesc: shot.endFrame,
        motionScript: shot.motionScript,
        cameraDirection: shot.cameraDirection || "static",
        duration: shot.duration,
      });

      for (let i = 0; i < (shot.dialogues || []).length; i++) {
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
    }

    console.log(
      `[ShotSplit] Created ${parsedShots.length} shots`
    );
  } catch (err) {
    console.error("[ShotSplit] onFinish error:", err);
  }
},
```

Key changes:
- `shot.prompt` → `shot.sceneDescription` mapped to DB `prompt` field
- New fields `startFrame` → `startFrameDesc`, `endFrame` → `endFrameDesc`, `motionScript` → `motionScript`
- Save `cameraDirection` from AI response

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: save rich shot fields (startFrameDesc, endFrameDesc, motionScript) from shot_split"
```

---

## Chunk 2: Frame Generation + Video Generation Prompts

### Task 4: Rewrite frame-generate prompts

**Files:**
- Modify: `src/lib/ai/prompts/frame-generate.ts`

- [ ] **Step 1: Rewrite buildFirstFramePrompt**

Replace the function signature and body. The new version takes `sceneDescription` + `startFrameDesc` instead of `shotPrompt`:

```typescript
export function buildFirstFramePrompt(params: {
  sceneDescription: string;
  startFrameDesc: string;
  characterDescriptions: string;
  previousLastFrame?: string;
}): string {
  const lines: string[] = [];

  lines.push(`Create the OPENING FRAME of this shot as a single high-quality image.`);
  lines.push(``);
  lines.push(`=== SCENE ENVIRONMENT ===`);
  lines.push(params.sceneDescription);
  lines.push(``);
  lines.push(`=== FRAME DESCRIPTION ===`);
  lines.push(params.startFrameDesc);
  lines.push(``);
  lines.push(`=== CHARACTER DESCRIPTIONS ===`);
  lines.push(params.characterDescriptions);
  lines.push(``);
  lines.push(`=== REFERENCE IMAGES ===`);
  lines.push(`Reference images of each character are attached. You MUST reproduce these characters EXACTLY as they appear in the reference images — same face, same body type, same clothing, same hair, same colors. Do NOT change their visual style.`);
  lines.push(``);

  if (params.previousLastFrame) {
    lines.push(`=== CONTINUITY REQUIREMENT ===`);
    lines.push(`This shot DIRECTLY follows the previous shot. The attached reference includes the previous shot's final frame. Maintain visual continuity:`);
    lines.push(`- Same characters must appear in consistent outfits and proportions`);
    lines.push(`- Environmental lighting and color temperature should transition smoothly`);
    lines.push(`- Character positions should logically follow from where the previous shot ended`);
    lines.push(``);
  }

  lines.push(`=== CRITICAL STYLE RULE ===`);
  lines.push(`The visual style is determined by the character descriptions and reference images above.`);
  lines.push(`If the characters are photorealistic/写实真人 (real people), you MUST generate a PHOTOREALISTIC image that looks like a real photograph or film still. Do NOT render as anime, cartoon, or illustration.`);
  lines.push(`If the characters are anime/动漫 style, render in anime style.`);
  lines.push(`The style of the reference images is the ground truth — match it exactly.`);
  lines.push(``);
  lines.push(`=== RENDERING ===`);
  lines.push(`Textures: Rich detail in fabric, skin, hair, and environment`);
  lines.push(`Lighting: Cinematic three-point lighting with motivated light sources. Use rim lighting for character separation.`);
  lines.push(`Backgrounds: Fully rendered, detailed environment. No blank or abstract backgrounds.`);
  lines.push(`Characters: Match reference images exactly. Expressive faces, natural dynamic poses.`);
  lines.push(`Composition: Cinematographic framing with clear focal point and depth-of-field.`);

  return lines.join("\n");
}
```

- [ ] **Step 2: Rewrite buildLastFramePrompt**

Replace with new version that uses `endFrameDesc` instead of generic "be different" instructions:

```typescript
export function buildLastFramePrompt(params: {
  sceneDescription: string;
  endFrameDesc: string;
  characterDescriptions: string;
  firstFramePath: string;
}): string {
  const lines: string[] = [];

  lines.push(`Create the CLOSING FRAME of this shot as a single high-quality image.`);
  lines.push(``);
  lines.push(`=== SCENE ENVIRONMENT ===`);
  lines.push(params.sceneDescription);
  lines.push(``);
  lines.push(`=== FRAME DESCRIPTION ===`);
  lines.push(params.endFrameDesc);
  lines.push(``);
  lines.push(`=== CHARACTER DESCRIPTIONS ===`);
  lines.push(params.characterDescriptions);
  lines.push(``);
  lines.push(`=== REFERENCE IMAGES ===`);
  lines.push(`The FIRST attached image is the OPENING FRAME of this same shot — use it as your visual anchor for style, environment, and character appearance.`);
  lines.push(`The remaining attached images are character reference sheets — characters MUST look exactly like their references.`);
  lines.push(``);
  lines.push(`=== RELATIONSHIP TO FIRST FRAME ===`);
  lines.push(`This closing frame shows the END STATE of the shot's action. Compared to the first frame:`);
  lines.push(`- Same environment, lighting setup, and color palette`);
  lines.push(`- Identical character appearance (face, outfit, body type)`);
  lines.push(`- Character positions, poses, and expressions have CHANGED as described in the frame description above`);
  lines.push(``);
  lines.push(`=== AS NEXT SHOT'S STARTING POINT ===`);
  lines.push(`This frame will be reused as the next shot's opening frame. Ensure:`);
  lines.push(`- The pose is STABLE — not mid-motion or blurred`);
  lines.push(`- The composition is COMPLETE and works as a standalone frame`);
  lines.push(`- The framing allows natural transition to a different camera angle`);
  lines.push(``);
  lines.push(`=== CRITICAL STYLE RULE ===`);
  lines.push(`Match the EXACT style of the first frame image. If it is photorealistic, this frame MUST also be photorealistic. If it is anime, this frame MUST also be anime. Do NOT change the visual style.`);
  lines.push(``);
  lines.push(`=== RENDERING ===`);
  lines.push(`Textures: Rich detail matching the first frame`);
  lines.push(`Lighting: Same lighting setup as the first frame. Changes only if motivated by action.`);
  lines.push(`Backgrounds: Must match the first frame's environment.`);
  lines.push(`Characters: Match reference images exactly. Show emotional state at END of the shot's action.`);
  lines.push(`Composition: Natural conclusion of the shot, ready to cut to the next.`);

  return lines.join("\n");
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: Errors in `frame-generate.ts` callers (expected — will fix in Task 6)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/prompts/frame-generate.ts
git commit -m "feat: rewrite frame-generate prompts to use specific startFrameDesc/endFrameDesc"
```

---

### Task 5: Create video-generate prompt

**Files:**
- Create: `src/lib/ai/prompts/video-generate.ts`

- [ ] **Step 1: Create buildVideoPrompt function**

```typescript
export function buildVideoPrompt(params: {
  sceneDescription: string;
  motionScript: string;
  cameraDirection: string;
}): string {
  return `Camera movement: ${params.cameraDirection}

Action: ${params.motionScript}

Scene: ${params.sceneDescription}

Generate a smooth, cinematic video transition from the first frame to the last frame.
The camera movement should be steady and natural.
Character movements should be fluid and match the action description.
Maintain consistent lighting, color grading, and visual style throughout.`;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | grep video-generate`
Expected: No errors in this file

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/prompts/video-generate.ts
git commit -m "feat: add buildVideoPrompt for Seedance video generation"
```

---

### Task 6: Update pipeline callers (frame-generate + video-generate)

**Files:**
- Modify: `src/lib/pipeline/frame-generate.ts`
- Modify: `src/lib/pipeline/video-generate.ts`

- [ ] **Step 1: Update frame-generate pipeline**

Update `handleFrameGenerate` in `src/lib/pipeline/frame-generate.ts` to pass the new fields:

```typescript
import { db } from "@/lib/db";
import { shots, characters } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
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
    modelConfig?: ModelConfigPayload;
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, payload.projectId));

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

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

  const ai = resolveImageProvider(payload.modelConfig);

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  // Generate first frame using startFrameDesc
  const firstFramePrompt = buildFirstFramePrompt({
    sceneDescription: shot.prompt || "",
    startFrameDesc: shot.startFrameDesc || shot.prompt || "",
    characterDescriptions,
    previousLastFrame: previousShot?.lastFrame || undefined,
  });
  const firstFramePath = await ai.generateImage(firstFramePrompt, {
    quality: "hd",
    referenceImages: projectCharacters
      .map((c) => c.referenceImage)
      .filter(Boolean) as string[],
  });

  // Generate last frame using endFrameDesc
  const lastFramePrompt = buildLastFramePrompt({
    sceneDescription: shot.prompt || "",
    endFrameDesc: shot.endFrameDesc || shot.prompt || "",
    characterDescriptions,
    firstFramePath,
  });
  const charRefImages = projectCharacters
    .map((c) => c.referenceImage)
    .filter(Boolean) as string[];
  const lastFramePath = await ai.generateImage(lastFramePrompt, {
    quality: "hd",
    referenceImages: [firstFramePath, ...charRefImages],
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

Note: Uses `shot.startFrameDesc || shot.prompt || ""` as fallback for backward compatibility with existing shots that don't have the new fields.

- [ ] **Step 2: Update video-generate pipeline**

Update `handleVideoGenerate` in `src/lib/pipeline/video-generate.ts` to use `buildVideoPrompt`:

```typescript
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleVideoGenerate(task: Task) {
  const payload = task.payload as { shotId: string; ratio?: string; modelConfig?: ModelConfigPayload };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");
  if (!shot.firstFrame || !shot.lastFrame) {
    throw new Error("Shot frames not generated yet");
  }

  const videoProvider = resolveVideoProvider(payload.modelConfig);

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  const prompt = shot.motionScript
    ? buildVideoPrompt({
        sceneDescription: shot.prompt || "",
        motionScript: shot.motionScript,
        cameraDirection: shot.cameraDirection || "static",
      })
    : shot.prompt || "";

  const videoPath = await videoProvider.generateVideo({
    firstFrame: shot.firstFrame,
    lastFrame: shot.lastFrame,
    prompt,
    duration: shot.duration ?? 10,
    ratio: payload.ratio,
  });

  await db
    .update(shots)
    .set({ videoUrl: videoPath, status: "completed" })
    .where(eq(shots.id, payload.shotId));

  return { videoPath };
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: Errors remain in the API route (will fix next)

- [ ] **Step 4: Commit**

```bash
git add src/lib/pipeline/frame-generate.ts src/lib/pipeline/video-generate.ts
git commit -m "feat: update frame/video pipeline to use rich shot fields"
```

---

### Task 7: Update API route frame/video generation handlers

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

- [ ] **Step 1: Add import for buildVideoPrompt**

At the top of the file, add:

```typescript
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
```

- [ ] **Step 2: Update handleBatchFrameGenerate**

In the loop inside `handleBatchFrameGenerate` (around line 495-520), update the calls to `buildFirstFramePrompt` and `buildLastFramePrompt` to pass the new fields:

Replace the first frame prompt building (around line 497-500):
```typescript
// Old:
const firstPrompt = buildFirstFramePrompt({
  shotPrompt: shot.prompt || "",
  characterDescriptions,
});

// New:
const firstPrompt = buildFirstFramePrompt({
  sceneDescription: shot.prompt || "",
  startFrameDesc: shot.startFrameDesc || shot.prompt || "",
  characterDescriptions,
});
```

Replace the last frame prompt building (around line 512-516):
```typescript
// Old:
const lastPrompt = buildLastFramePrompt({
  shotPrompt: shot.prompt || "",
  characterDescriptions,
  firstFramePath,
});

// New:
const lastPrompt = buildLastFramePrompt({
  sceneDescription: shot.prompt || "",
  endFrameDesc: shot.endFrameDesc || shot.prompt || "",
  characterDescriptions,
  firstFramePath,
});
```

- [ ] **Step 3: Update handleSingleFrameGenerate**

Same changes as above for the single frame generation handler (around line 607-620):

Replace first frame prompt:
```typescript
// Old:
const firstPrompt = buildFirstFramePrompt({
  shotPrompt: shot.prompt || "",
  characterDescriptions,
  previousLastFrame: previousShot?.lastFrame || undefined,
});

// New:
const firstPrompt = buildFirstFramePrompt({
  sceneDescription: shot.prompt || "",
  startFrameDesc: shot.startFrameDesc || shot.prompt || "",
  characterDescriptions,
  previousLastFrame: previousShot?.lastFrame || undefined,
});
```

Replace last frame prompt:
```typescript
// Old:
const lastPrompt = buildLastFramePrompt({
  shotPrompt: shot.prompt || "",
  characterDescriptions,
  firstFramePath,
});

// New:
const lastPrompt = buildLastFramePrompt({
  sceneDescription: shot.prompt || "",
  endFrameDesc: shot.endFrameDesc || shot.prompt || "",
  characterDescriptions,
  firstFramePath,
});
```

- [ ] **Step 4: Update handleSingleVideoGenerate**

Update the video prompt construction (around line 669-675):

```typescript
// Old:
const videoPath = await videoProvider.generateVideo({
  firstFrame: shot.firstFrame,
  lastFrame: shot.lastFrame,
  prompt: shot.prompt || "",
  duration: shot.duration ?? 10,
  ratio,
});

// New:
const prompt = shot.motionScript
  ? buildVideoPrompt({
      sceneDescription: shot.prompt || "",
      motionScript: shot.motionScript,
      cameraDirection: shot.cameraDirection || "static",
    })
  : shot.prompt || "";

const videoPath = await videoProvider.generateVideo({
  firstFrame: shot.firstFrame,
  lastFrame: shot.lastFrame,
  prompt,
  duration: shot.duration ?? 10,
  ratio,
});
```

- [ ] **Step 5: Update handleBatchVideoGenerate**

Same video prompt change (around line 726-732):

```typescript
// Old:
const videoPath = await videoProvider.generateVideo({
  firstFrame: shot.firstFrame!,
  lastFrame: shot.lastFrame!,
  prompt: shot.prompt || "",
  duration: shot.duration ?? 10,
  ratio,
});

// New:
const prompt = shot.motionScript
  ? buildVideoPrompt({
      sceneDescription: shot.prompt || "",
      motionScript: shot.motionScript,
      cameraDirection: shot.cameraDirection || "static",
    })
  : shot.prompt || "";

const videoPath = await videoProvider.generateVideo({
  firstFrame: shot.firstFrame!,
  lastFrame: shot.lastFrame!,
  prompt,
  duration: shot.duration ?? 10,
  ratio,
});
```

- [ ] **Step 6: Verify full compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add src/app/api/projects/[id]/generate/route.ts
git commit -m "feat: update API route handlers to use rich shot fields for frame/video generation"
```

---

## Chunk 3: Frontend + Store Updates

### Task 8: Update project store and ShotCard

**Files:**
- Modify: `src/stores/project-store.ts:18-28`
- Modify: `src/components/editor/shot-card.tsx`

- [ ] **Step 1: Add new fields to Shot interface in project store**

In `src/stores/project-store.ts`, update the `Shot` interface:

```typescript
interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
}
```

- [ ] **Step 2: Update ShotCard to display rich fields**

In `src/components/editor/shot-card.tsx`, update:

1. Add new fields to `ShotCardProps` interface:
```typescript
interface ShotCardProps {
  id: string;
  projectId: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
  onUpdate: () => void;
}
```

2. Update the component destructuring to include new props:
```typescript
export function ShotCard({
  id,
  projectId,
  sequence,
  prompt,
  startFrameDesc,
  endFrameDesc,
  motionScript,
  cameraDirection,
  duration,
  firstFrame,
  lastFrame,
  videoUrl,
  status,
  dialogues,
  onUpdate,
}: ShotCardProps) {
```

3. In the info section (around line 157), display `prompt` (scene description) truncated as before — this is the scene environment description now.

4. In the expanded detail section (around line 249-308), show the rich fields. Replace the single `Textarea` with multiple sections:

```tsx
{/* Expanded detail */}
{expanded && (
  <div className="space-y-4 border-t border-[--border-subtle] p-4">
    {/* Scene Description (editable) */}
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
        {t("shot.sceneDescription")}
      </p>
      <Textarea
        value={editPrompt}
        onChange={(e) => setEditPrompt(e.target.value)}
        onBlur={handleSave}
        rows={2}
        placeholder={t("shot.prompt")}
      />
    </div>

    {/* Start Frame Description */}
    {startFrameDesc && (
      <div className="rounded-xl bg-blue-50/50 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-blue-600">
          {t("shot.startFrame")}
        </p>
        <p className="text-sm leading-relaxed text-[--text-secondary]">{startFrameDesc}</p>
      </div>
    )}

    {/* End Frame Description */}
    {endFrameDesc && (
      <div className="rounded-xl bg-amber-50/50 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-600">
          {t("shot.endFrame")}
        </p>
        <p className="text-sm leading-relaxed text-[--text-secondary]">{endFrameDesc}</p>
      </div>
    )}

    {/* Motion Script */}
    {motionScript && (
      <div className="rounded-xl bg-emerald-50/50 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-600">
          {t("shot.motionScript")}
        </p>
        <p className="text-sm leading-relaxed text-[--text-secondary]">{motionScript}</p>
      </div>
    )}

    {/* Camera Direction */}
    {cameraDirection && cameraDirection !== "static" && (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          🎬 {cameraDirection}
        </Badge>
      </div>
    )}

    {dialogues.length > 0 && (
      <div className="space-y-2 rounded-xl bg-[--surface] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
          {t("shot.dialogue")}
        </p>
        {dialogues.map((d) => (
          <p key={d.id} className="text-sm leading-relaxed">
            <span className="font-semibold text-primary">{d.characterName}</span>
            <span className="mx-1.5 text-[--text-muted]">&mdash;</span>
            <span className="text-[--text-secondary]">{d.text}</span>
          </p>
        ))}
      </div>
    )}

    <div className="flex items-center gap-2">
      {/* ...existing action buttons (unchanged)... */}
    </div>
  </div>
)}
```

- [ ] **Step 3: Update storyboard page to pass new props**

In `src/app/[locale]/project/[id]/storyboard/page.tsx`, update the `ShotCard` usage (around line 361-375) to pass the new fields:

```tsx
<ShotCard
  key={shot.id}
  id={shot.id}
  projectId={project.id}
  sequence={shot.sequence}
  prompt={shot.prompt}
  startFrameDesc={shot.startFrameDesc}
  endFrameDesc={shot.endFrameDesc}
  motionScript={shot.motionScript}
  cameraDirection={shot.cameraDirection}
  duration={shot.duration}
  firstFrame={shot.firstFrame}
  lastFrame={shot.lastFrame}
  videoUrl={shot.videoUrl}
  status={shot.status}
  dialogues={shot.dialogues || []}
  onUpdate={() => fetchProject(project.id)}
/>
```

- [ ] **Step 4: Add i18n keys for new labels**

Check the locale files and add translation keys for `shot.sceneDescription`, `shot.startFrame`, `shot.endFrame`, `shot.motionScript`. Find the locale files:

```bash
find src -name "*.json" -path "*/messages/*" | head -5
```

Add to each locale file:
```json
{
  "shot": {
    "sceneDescription": "Scene Description",
    "startFrame": "Start Frame",
    "endFrame": "End Frame",
    "motionScript": "Motion Script"
  }
}
```

(Use Chinese translations for zh locale: "场景描述", "首帧描述", "尾帧描述", "动作脚本")

- [ ] **Step 5: Verify compilation and dev server**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/stores/project-store.ts src/components/editor/shot-card.tsx src/app/[locale]/project/[id]/storyboard/page.tsx
git commit -m "feat: display rich shot fields (startFrameDesc, endFrameDesc, motionScript) in UI"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 2: Push schema to DB**

Run: `npx drizzle-kit push`
Expected: Schema synced

- [ ] **Step 3: Start dev server and verify**

Run: `npm run dev` (or `pnpm dev`)
Expected: No runtime errors, storyboard page loads

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for rich storyboard pipeline"
```
