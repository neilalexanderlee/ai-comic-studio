# Composition v2

Preview and export now use **one server renderer**. The browser plays a rendered MP4 rather than interpreting effects independently. This works on HTTP without WebCodecs/OPFS. The tradeoff is an explicit render step on first preview or after composition edits; scrubbing and playback are immediate once ready. HTTPS remains a deployment concern outside this module.

## Timeline contract

- `canonicalTimeline` validates and removes UI-only data. Legacy snapshots remain readable; endpoints define duration. Output settings are persisted in the editor snapshot, not localStorage. First-source dimensions/fps remain the default; explicit output settings override them.
- Video tracks are composited in array order, later tracks on top; overlapping clips within a track use start-time order. Empty regions are transparent within a layer, black on the final canvas. Muting a video track mutes its sound, not its picture.
- Transitions belong to a video track and connect the closest pair around their midpoint. They occupy their stored interval without shortening the episode or shifting other tracks. Missing transition handles hold the adjacent endpoint frame *only within the transition*. Audio stays at its original timeline position; audio crossfades are explicit clip fades.
- `composition.ts` defines all 13 offered transitions and eight effects. FFmpeg-native transitions replace legacy Canvas approximations, including the formerly unimplemented pixelate option. Preview and export use those same definitions.
- Source trim bounds are applied before effects. Clip/track gains multiply, fades are local to the clip and precede timeline delay. Each input has a separate decoder; mixed AAC packets are never concatenated.
- Subtitles are burned once in both preview and export. Global styling applies to old snapshots; explicit new per-clip edits opt in via `subtitleStyleOverride`, so historical default styles do not silently change old projects.

## Derived artifacts and reproducibility

Originals are immutable. `inspectMedia` records content SHA256, streams/codecs/timebases/sample rates/channel layouts/durations and the full FFmpeg runtime version. A private content-addressed metadata cache is stored under `data/media-metadata` (override with `MEDIA_METADATA_DIR`). Each output has an adjacent JSON provenance manifest containing metadata, timeline, composition version and output settings.

Preview renders at a maximum dimension of 640 pixels from the same originals. The queue's unique `dedup_key` shares concurrent and completed previews for the same project/episode/day/normalized composition. Terminal failure releases the key; explicit refresh invalidates only a completed preview. Preview never changes `episodes.finalVideoUrl`. Export is a new task and publishes only after validation. Cache buckets bound stale legacy in-place file replacement; generated content refs are immutable.

Docker pins the verified Node base image digest, FFmpeg and CJK font package versions. A changed toolchain must rerun media regression and update the composition/cache revision before deployment. Missing pinned packages cause a build failure, never an implicit upgrade.

## Validation

Real FFmpeg tests reproduce heterogeneous AAC failure and verify continuous audio, trim, silence, gaps, gain, every offered transition/effect, overlap ordering, duration and preserved fps. A production-pipeline test compares preview/export decoded frame hashes at equal resolution and checks preview does not publish a final video. SQLite tests cover concurrent deduplication, completion reuse and retry. Baseline/migration tests cover existing and new databases.

Before upload the pipeline fully decodes video and audio, verifies video duration/frame count and decoded audio sample duration. Intentional black/silence are valid; decode failure is not. Browser release QA must include preview generation, cached reuse, playback, scrubbing, invalidation after an edit and export on production FFmpeg.
