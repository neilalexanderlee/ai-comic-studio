import { extractJSON } from "@/lib/ai/ai-sdk";
import { buildShotCompletePrompt } from "@/lib/ai/prompts/shot-complete";
import type { ExtractedShot } from "./extract-shot-script";
import type { PersistableShot } from "./persist-storyboard-version";

/** Map markdown-extracted shots to DB rows without LLM rewrite (author wording preserved). */
export function finalizeExtractedShotsForDb(shots: ExtractedShot[]): PersistableShot[] {
  return shots.map((shot) => ({
    sequence: shot.sequence,
    prompt: (shot.prompt?.trim() || shot.motionScript?.trim() || "").trim(),
    startFrameDesc: shot.startFrameDesc ?? shot.prompt ?? null,
    endFrameDesc: shot.endFrameDesc ?? shot.startFrameDesc ?? shot.prompt ?? null,
    motionScript: shot.motionScript ?? shot.prompt ?? null,
    videoScript: shot.videoScript ?? null,
    cameraDirection: shot.cameraDirection ?? "static",
    duration: shot.duration ?? 10,
    dialogues: shot.dialogues.map((d, i) => ({
      character: d.character,
      text: d.text,
      sequence: i,
    })),
  }));
}

interface CompleteShotsParams {
  script: string;
  shots: ExtractedShot[];
  characterDescriptions: string;
  characterVisualHints?: Array<{ name: string; visualHint: string }>;
  generate: (prompt: string) => Promise<string>;
}

function needsCompletion(shot: ExtractedShot): boolean {
  return !shot.startFrameDesc || !shot.endFrameDesc || !shot.motionScript || !shot.cameraDirection;
}

export async function completeExtractedShots(
  params: CompleteShotsParams
): Promise<PersistableShot[]> {
  return Promise.all(
    params.shots.map(async (shot) => {
      if (!needsCompletion(shot)) {
        return {
          sequence: shot.sequence,
          prompt: shot.prompt,
          startFrameDesc: shot.startFrameDesc ?? null,
          endFrameDesc: shot.endFrameDesc ?? null,
          motionScript: shot.motionScript ?? null,
          videoScript: null,
          cameraDirection: shot.cameraDirection ?? "static",
          duration: shot.duration ?? 10,
          dialogues: shot.dialogues,
        } satisfies PersistableShot;
      }

      const prompt = buildShotCompletePrompt({
        script: params.script,
        prompt: shot.prompt,
        startFrameDesc: shot.startFrameDesc ?? null,
        endFrameDesc: shot.endFrameDesc ?? null,
        motionScript: shot.motionScript ?? null,
        cameraDirection: shot.cameraDirection ?? null,
        duration: shot.duration ?? 10,
        dialogues: shot.dialogues,
        characterDescriptions: params.characterDescriptions,
        characterVisualHints: params.characterVisualHints,
      });

      const raw = await params.generate(prompt);
      const parsed = JSON.parse(extractJSON(raw)) as {
        startFrameDesc?: string;
        endFrameDesc?: string;
        motionScript?: string;
        videoScript?: string;
        cameraDirection?: string;
        duration?: number;
      };

      return {
        sequence: shot.sequence,
        prompt: shot.prompt,
        startFrameDesc: shot.startFrameDesc ?? parsed.startFrameDesc ?? null,
        endFrameDesc: shot.endFrameDesc ?? parsed.endFrameDesc ?? null,
        motionScript: shot.motionScript ?? parsed.motionScript ?? null,
        videoScript: parsed.videoScript ?? null,
        cameraDirection: shot.cameraDirection ?? parsed.cameraDirection ?? "static",
        duration: shot.duration ?? parsed.duration ?? 10,
        dialogues: shot.dialogues,
      } satisfies PersistableShot;
    })
  );
}
