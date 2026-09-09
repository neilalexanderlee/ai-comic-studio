# Timeline rendering contract

- `timeline.ts` owns source trim bounds and clip/track gain semantics. Timeline endpoints define duration; explicit `trimEnd` is respected.
- `render-timeline.ts` builds a single FFmpeg filter graph. Every media input has a separate decoder; heterogeneous compressed audio packets are never concatenated. PCM is mixed at 48 kHz stereo. Intentional silence has an explicit finite bed.
- Output uses the first source's dimensions and frame rate (the legacy source-sized output policy), not a hardcoded 30 fps. Differently sized inputs are contained in that output frame. Subtitle coordinates use the editor canvas's ASS PlayRes. Video, subtitles and audio are encoded in one pass.
- Gaps are black/silent. Explicitly shortened sources are not frozen to cover missing footage. Clip and track volumes multiply; fades are local to the clip, before timeline delay.
- Unsupported overlapping video layers, transitions and visual effects fail explicitly instead of being silently discarded. Full preview/export parity for these features is not claimed.
- The pipeline verifies decoding and actual decoded audio duration before publishing or updating the episode. Broken media must fail, not be treated as an intentionally silent source.

## Preview

WebAV remains the full browser engine. Public HTTP uses an explicitly labelled basic HTML-media preview; it does not claim effects/transition parity. Its clock follows a playing video, gain uses Web Audio, and background tabs pause. Both paths report media failures. Completing a load attempt must never imply successful readiness.

## Regression tests

`render-timeline.test.ts` generates heterogeneous AAC sources, reproduces the old failure, then verifies decoded samples, intentional silence, gain, trim, gaps and 24 fps output. `episode-render.test.ts` executes the production pipeline and ensures broken media is not published. `native-playback.test.ts` covers capability, gain and trim mapping.

Run `pnpm test` and `npx tsc --noEmit`. Deployment verification must additionally exercise the actual browser and production FFmpeg; record the runtime version with the release evidence.
