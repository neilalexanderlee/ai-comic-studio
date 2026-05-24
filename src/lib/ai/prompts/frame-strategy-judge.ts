/**
 * LLM prompt for deciding whether a shot needs a last frame (keyframe-interpolation mode)
 * or is better served by first-frame-only (reference-image mode).
 *
 * The prompt is deliberately structured-data-in → JSON-out, so it is language-agnostic:
 * Chinese, English, Japanese or any other language in startFrameDesc/endFrameDesc works
 * without any prompt changes.
 */

export interface FrameStrategyInput {
  duration: number;
  cameraDirection: string | null;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  prompt: string | null;
}

export interface FrameStrategyResult {
  mode: "both" | "first_only";
  reason: string;
}

export function buildFrameStrategyPrompt(shot: FrameStrategyInput): string {
  const data = {
    duration_seconds: shot.duration,
    camera_direction: shot.cameraDirection || "static",
    start_frame_desc: shot.startFrameDesc || null,
    end_frame_desc: shot.endFrameDesc || null,
    shot_description: shot.prompt || null,
  };

  return `You are a video director deciding how to generate frames for an AI video model.

The video model supports two modes:
- "both": supply a start frame + end frame. The model interpolates between them. Best when the end state is meaningfully different from the start and the transition is smooth.
- "first_only": supply only a start frame. The model moves freely from it. Best when there is no meaningful end state, the motion is unpredictable, or the visual jump between start and end would cause a hard cut artifact.

Decide which mode to use for the following shot. Return ONLY valid JSON — no markdown, no explanation outside the JSON.

Shot data:
${JSON.stringify(data, null, 2)}

Decision criteria:
- Use "first_only" if:
  • end_frame_desc is null or absent
  • end_frame_desc is nearly identical to start_frame_desc (static scene, no meaningful change)
  • end_frame_desc describes a different scene, location, or a clearly different character configuration from start_frame_desc (scene jump → hard cut artifact)
  • camera_direction involves unpredictable motion: handheld, whip pan, quick cuts, or similar
  • duration_seconds < 5 (too short for useful interpolation)

- Use "both" if:
  • end_frame_desc shows a clear, achievable state change: character pose/position/expression shift, costume change, or object transformation
  • camera_direction involves a controlled movement with a predictable endpoint: dolly in/out, crane up/down, tilt, pan — where the end framing matters
  • The shot is long enough (≥ 6s) and the endpoint anchors the motion arc

Return:
{
  "mode": "both" | "first_only",
  "reason": "one concise sentence explaining the decision"
}`;
}
