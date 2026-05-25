import { extractJSON } from "@/lib/ai/ai-sdk";
import { buildShotCompletePrompt } from "@/lib/ai/prompts/shot-complete";
import type { ExtractedShot } from "./extract-shot-script";
import type { PersistableShot } from "./persist-storyboard-version";

/** Map markdown-extracted shots to DB rows without LLM rewrite (author wording preserved). */
export function finalizeExtractedShotsForDb(shots: ExtractedShot[]): PersistableShot[] {
  return shots.map((shot) => {
    // startFrameDesc: use explicit tag if present, else fall back to scene description.
    // endFrameDesc: use explicit tag if present, otherwise leave null — DO NOT copy
    // startFrameDesc into endFrame. When start==end the video model has no motion
    // direction and produces a near-static clip. Leaving endFrame null signals that
    // the user (or batch AI) should fill it in with a meaningfully different state.
    const startFrameDesc = shot.startFrameDesc ?? shot.prompt ?? null;
    const endFrameDesc = shot.endFrameDesc ?? null;

    // cameraDirection: prefer explicit 运镜/镜头运动 tag; fall back to extracting
    // the first motion verb from motionScript (handles 【镜头】 descriptions like
    // "缓慢推镜头从夜空摇向小镇全景" that land in motionScript in v9 format).
    let cameraDirection = shot.cameraDirection ?? null;
    if (!cameraDirection && shot.motionScript) {
      const cameraKeywords = /推镜|拉镜|摇镜|移镜|跟拍|航拍|俯拍|仰拍|环绕|旋转|手持|固定|zoom|pan|tilt|crane|dolly/i;
      const match = shot.motionScript.match(cameraKeywords);
      if (match) {
        // Extract up to 20 chars around the keyword as a terse direction label
        const idx = shot.motionScript.indexOf(match[0]);
        cameraDirection = shot.motionScript.slice(Math.max(0, idx - 4), idx + 16).trim();
      }
    }

    return {
      sequence: shot.sequence,
      prompt: (shot.prompt?.trim() || shot.motionScript?.trim() || "").trim(),
      startFrameDesc,
      endFrameDesc,
      motionScript: shot.motionScript ?? shot.prompt ?? null,
      videoScript: shot.videoScript ?? null,
      cameraDirection: cameraDirection ?? "static",
      duration: shot.duration ?? 10,
      bgmNote: shot.bgmNote ?? null,
      soundEffectNote: shot.soundEffectNote ?? null,
      dialogues: shot.dialogues.map((d, i) => ({
        character: d.character,
        text: d.text,
        sequence: i,
      })),
    };
  });
}

interface CompleteShotsParams {
  script: string;
  shots: ExtractedShot[];
  characterDescriptions: string;
  characterVisualHints?: Array<{ name: string; visualHint: string }>;
  generate: (prompt: string) => Promise<string>;
}

function needsCompletion(shot: ExtractedShot): boolean {
  // videoScript is the most critical S-grade field — trigger completion if missing
  return !shot.startFrameDesc || !shot.endFrameDesc || !shot.motionScript || !shot.cameraDirection || !shot.videoScript;
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
      };

      return {
        sequence: shot.sequence,
        prompt: shot.prompt,
        startFrameDesc: shot.startFrameDesc ?? parsed.startFrameDesc ?? null,
        endFrameDesc: shot.endFrameDesc ?? parsed.endFrameDesc ?? null,
        motionScript: shot.motionScript ?? parsed.motionScript ?? null,
        videoScript: parsed.videoScript ?? null,
        cameraDirection: shot.cameraDirection ?? parsed.cameraDirection ?? "static",
        duration: shot.duration ?? 10,
        dialogues: shot.dialogues,
      } satisfies PersistableShot;
    })
  );
}
