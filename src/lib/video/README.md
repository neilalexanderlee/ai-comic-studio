# Composition v2

The editor defaults to **realtime editing preview** using native HTML media and Web Audio, including on HTTP. It immediately reflects trims, overlapping video layers, subtitles, track/clip gain and audio fades. It shares source timing/gain rules with export and never queues a render for ordinary playback. Media buffering is independent of rendering.

**Precise preview and export use one server renderer.** Precise preview is opt-in for final transitions/effects and mixing verification. Realtime preview explicitly labels transitions/effects as requiring precise preview; it does not pretend to render them. Edits return the player to realtime mode and invalidate the precise composition. A fresh precise preview is reused when switching modes. HTTPS remains outside this module.

## Timeline contract

- `canonicalTimeline` validates and removes UI-only data. Legacy snapshots remain readable; endpoints define duration. Output settings are persisted in the editor snapshot, not localStorage. First-source dimensions/fps remain the default; explicit output settings override them.
- Video tracks are composited in array order, later tracks on top; overlapping clips within a track use start-time order. Empty regions are transparent within a layer, black on the final canvas. Muting a video track mutes its sound, not its picture.
- Transitions belong to a video track and connect the closest pair around their midpoint. They occupy their stored interval without shortening the episode or shifting other tracks. Missing transition handles hold the adjacent endpoint frame *only within the transition*. Audio stays at its original timeline position; audio crossfades are explicit clip fades.
- `composition.ts` defines all 13 offered transitions and eight effects. FFmpeg-native transitions replace legacy Canvas approximations, including the formerly unimplemented pixelate option. Precise preview and export use those same definitions.
- Source trim bounds are applied before effects. Clip/track gains multiply, fades are local to the clip and precede timeline delay. Each input has a separate decoder; mixed AAC packets are never concatenated.
- Subtitles are burned once in precise preview and export; realtime preview overlays them once on the displayed video canvas. Global styling applies to old snapshots; explicit new per-clip edits opt in via `subtitleStyleOverride`, so historical default styles do not silently change old projects.

## Derived artifacts and reproducibility

Originals are immutable. `inspectMedia` records content SHA256, streams/codecs/timebases/sample rates/channel layouts/durations and the full FFmpeg runtime version. A private content-addressed metadata cache is stored under `data/media-metadata` (override with `MEDIA_METADATA_DIR`). Each output has an adjacent JSON provenance manifest containing metadata, timeline, composition version and output settings.

Precise preview renders at a maximum dimension of 640 pixels from the same originals. The queue's unique `dedup_key` shares concurrent and completed previews for the same project/episode/day/normalized composition. Terminal failure releases the key; explicit refresh invalidates only a completed preview. Preview never changes `episodes.finalVideoUrl`. Export is a new task and publishes only after validation. Cache buckets bound stale legacy in-place file replacement; generated content refs are immutable.

Docker pins the verified Node base image digest, FFmpeg and CJK font package versions. A changed toolchain must rerun media regression and update the composition/cache revision before deployment. Missing pinned packages cause a build failure, never an implicit upgrade.

## Validation

Real FFmpeg tests reproduce heterogeneous AAC failure and verify continuous audio, trim, silence, gaps, gain, every offered transition/effect, overlap ordering, duration and preserved fps. A production-pipeline test compares preview/export decoded frame hashes at equal resolution and checks preview does not publish a final video. SQLite tests cover concurrent deduplication, completion reuse and retry. Baseline/migration tests cover existing and new databases.

Before upload the pipeline fully decodes video and audio, verifies video duration/frame count and decoded audio sample duration. Intentional black/silence are valid; decode failure is not. Browser release QA must include preview generation, cached reuse, playback, scrubbing, invalidation after an edit and export on production FFmpeg.

## 剪辑器 Harness 维护约定

### 自动回归

以下测试不调用生成模型。媒体测试需要本机可用的 `ffmpeg`、`ffprobe`，使用临时合成素材；不能因为没有真实 API Key 而跳过。

| 文件（相对于 `src/__tests__/unit/lib/`） | 锁定的行为 |
|---|---|
| `video/realtime-playback.test.ts` | 时间线到裁剪源时间的映射、显式 trimEnd、未使用尾段静音、片段×轨道音量、淡入淡出、静音及大于 1 的增益 |
| `video/timeline-contract.test.ts` | 旧快照兼容、端点决定时长、剔除仅供 UI 使用的字段、合成变更影响规范化快照 |
| `video/render-timeline.test.ts` | 真实异构 AAC 拼接失败对照；逐源解码后保留 24 fps、空隙、裁剪、静音和音量 |
| `video/composition.test.ts` | 13 种转场、8 种特效、每种特效接像素转场、帧数与重叠轨道顺序；特效输出必须统一时间基准后再接转场 |
| `video/episode-render.test.ts` | 生产合成路径、字幕/BGM、完整解码与保存；同尺寸精准预览/导出帧哈希一致；预览不发布最终成片；损坏素材不发布 |
| `task-queue/queue.test.ts` | SQLite 并发去重、完成任务复用、失败释放去重键并允许重试 |
| `db/baseline-schema.test.ts`、`db/migration-lock.test.ts` | 基线与增量迁移、迁移锁；包括预览去重列对应的 schema/journal 完整性 |

```bash
npx tsc --noEmit
pnpm test src/__tests__/unit/lib/video src/__tests__/unit/lib/task-queue/queue.test.ts src/__tests__/unit/lib/db/baseline-schema.test.ts src/__tests__/unit/lib/db/migration-lock.test.ts
```

### 浏览器发布验收

1. 使用两段以上带声音、含裁剪的素材，并叠加字幕/BGM。打开剪辑器默认即为实时模式；普通播放、跳转、字幕/音量修改不创建渲染任务。首次素材加载允许缓冲，但不能要求“先生成预览”。
2. 播放跨镜头直至结束，确认音视频推进、片尾保留最后一帧；再次播放、快速暂停/拖动、切换标签页后回来，均检查媒体错误及声音是否重复。
3. 修改字幕对齐/字号/位置后立即检查画面；属性面板必须显示实际继承或覆盖后的样式，不能回落到另一套默认值。实时字幕只叠加一次。
4. 主动选择精准预览，检查实际转场/特效；切回实时再播放。精准预览使用烧录字幕，不叠加实时字幕。修改后自动回到实时模式，不播放过期的精准结果。
5. 重复请求相同精准预览，检查任务复用；预览不能更改最终成片地址。正式导出另行检查解码、视频帧数、实际音频样本时长；文件带有音轨不等于音轨完整或有声音。
6. 将服务器生成成功、浏览器播放成功、本机下载成功分别记录；浏览器拦截下载不能记作下载通过。实时模式的转场/画面特效提示必须保留，不能声称实时画面与最终输出逐像素一致。

自动回归未覆盖完整浏览器交互，也未证明任意输入或任意 FFmpeg 版本均无缺陷。运行环境升级后应在实际生产版本复跑媒体回归与上述交互验收。
