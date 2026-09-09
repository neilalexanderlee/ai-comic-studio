import {
  effectFilters,
  transitionFilter,
  type EffectName,
  type RenderTransition,
} from "./composition";
import { mediaTiming, type TimedMedia } from "./timeline";

export interface RenderMedia extends TimedMedia {
  id?: string;
  input: string;
  hasAudio: boolean;
  width?: number;
  height?: number;
  track?: number;
  effectType?: EffectName;
}

/** Each source has its own decoder. Never concatenate heterogeneous AAC packets. */
export function timelineRenderArgs(options: {
  videos: RenderMedia[];
  audio: RenderMedia[];
  output: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  subtitles?: boolean;
  transitions?: RenderTransition[];
}): string[] {
  const { videos, audio, output, width, height, fps, duration, subtitles } =
    options;
  const args = ["-y", "-v", "error", "-xerror", "-filter_complex_threads", "1"];
  [...videos, ...audio].forEach((c) =>
    args.push("-threads", "1", "-i", c.input),
  );
  const filters: string[] = [];
  const sounds: string[] = [];
  const transitions = options.transitions ?? [];
  const links = transitions.map((t) => {
    if (!(t.endTime > t.startTime) || t.startTime < 0 || t.endTime > duration)
      throw new Error("转场时间超出时间线");
    const mid = (t.startTime + t.endTime) / 2;
    const candidates = videos
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => (v.track ?? 0) === t.track);
    const before = t.beforeClipId
      ? candidates.find(({ v }) => v.id === t.beforeClipId)
      : candidates
          .filter(({ v }) => v.startTime < mid)
          .sort(
            (a, b) => Math.abs(a.v.endTime - mid) - Math.abs(b.v.endTime - mid),
          )[0];
    const after = t.afterClipId
      ? candidates.find(({ v }) => v.id === t.afterClipId)
      : candidates
          .filter(({ v, i }) => i !== before?.i && v.endTime > mid)
          .sort(
            (a, b) =>
              Math.abs(a.v.startTime - mid) - Math.abs(b.v.startTime - mid),
          )[0];
    if (
      !before ||
      !after ||
      before.i === after.i ||
      before.v.endTime < t.startTime ||
      after.v.startTime > t.endTime
    )
      throw new Error("转场未连接两个有效镜头，请重新放置转场");
    return { ...t, before: before.i, after: after.i };
  });
  videos.forEach((clip, i) => {
    const t = mediaTiming(clip);
    let chain = `[${i}:v:0]setpts=PTS-STARTPTS,trim=start=${t.sourceStart}:end=${t.sourceEnd},setpts=PTS-STARTPTS,fps=${fps},settb=AVTB`;
    chain += `,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=rgba`;
    chain += `,tpad=stop_mode=add:color=black@0:stop_duration=${t.duration},trim=duration=${t.duration}[raw${i}]`;
    filters.push(
      chain,
      ...effectFilters(
        `raw${i}`,
        `effect${i}`,
        clip.effectType,
        t.duration,
        width,
        height,
        fps,
      ),
    );
    const branches = [
      `[v${i}]`,
      ...links.flatMap((t, n) =>
        t.before === i || t.after === i ? [`[v${i}t${n}]`] : [],
      ),
    ];
    // Canvas-based effects inherit their canvas clock; normalize at the
    // effect boundary so either side of an xfade uses the same timebase.
    filters.push(`[effect${i}]fps=${fps},settb=AVTB,split=${branches.length}${branches.join("")}`);
  });
  filters.push(
    `color=c=black:s=${width}x${height}:r=${fps}:d=${duration},format=rgba[canvas0]`,
  );
  const layers = [...new Set(videos.map((v) => v.track ?? 0))].sort(
    (a, b) => a - b,
  );
  layers.forEach((layer, li) => {
    filters.push(
      `color=c=black@0:s=${width}x${height}:r=${fps}:d=${duration},format=rgba[layer${li}base]`,
    );
    let previous = `layer${li}base`;
    videos.forEach((clip, i) => {
      if ((clip.track ?? 0) !== layer) return;
      filters.push(`[v${i}]setpts=PTS+${clip.startTime}/TB[position${i}]`);
      const next = `layer${li}v${i}`;
      filters.push(
        `[${previous}][position${i}]overlay=eof_action=pass:repeatlast=0:format=auto:enable='gte(t,${clip.startTime})*lt(t,${clip.endTime})'[${next}]`,
      );
      previous = next;
    });
    links.forEach((t, n) => {
      if (t.track !== layer) return;
      const length = t.endTime - t.startTime;
      for (const i of [t.before, t.after]) {
        const lead = Math.max(0, videos[i].startTime - t.startTime);
        const trim = Math.max(0, t.startTime - videos[i].startTime);
        filters.push(
          `[v${i}t${n}]tpad=start_mode=clone:start_duration=${lead}:stop_mode=clone:stop_duration=${length},trim=start=${trim}:duration=${length},setpts=PTS-STARTPTS,format=yuv444p[t${n}s${i}]`,
        );
      }
      filters.push(
        `[t${n}s${t.before}][t${n}s${t.after}]${transitionFilter(t.transitionType, length)},trim=duration=${length},setpts=PTS+${t.startTime}/TB[transition${n}]`,
      );
      const next = `layer${li}t${n}`;
      filters.push(
        `[${previous}][transition${n}]overlay=eof_action=pass:repeatlast=0:format=auto:enable='gte(t,${t.startTime})*lt(t,${t.endTime})'[${next}]`,
      );
      previous = next;
    });
    filters.push(
      `[canvas${li}][${previous}]overlay=shortest=1:format=auto[canvas${li + 1}]`,
    );
  });
  filters.push(
    `[canvas${layers.length}]${subtitles ? "subtitles=subtitles.ass" : "null"}[video]`,
  );
  [...videos, ...audio].forEach((clip, i) => {
    if (!clip.hasAudio) return;
    const t = mediaTiming(clip);
    let chain = `[${i}:a:0]asetpts=PTS-STARTPTS,atrim=start=${t.sourceStart}:end=${t.sourceEnd},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume ?? 1}`;
    if (clip.fadeIn && clip.fadeIn > 0)
      chain += `,afade=t=in:st=0:d=${clip.fadeIn}`;
    if (clip.fadeOut && clip.fadeOut > 0)
      chain += `,afade=t=out:st=${Math.max(0, t.duration - clip.fadeOut)}:d=${clip.fadeOut}`;
    chain += `,adelay=${Math.round(clip.startTime * 48000)}S:all=1[a${i}]`;
    filters.push(chain);
    sounds.push(`[a${i}]`);
  });
  // A finite silence bed defines duration, including deliberate gaps and silent sources.
  filters.push(
    `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[silence]`,
  );
  sounds.push("[silence]");
  filters.push(
    `${sounds.join("")}amix=inputs=${sounds.length}:duration=longest:normalize=0,atrim=duration=${duration}[audio]`,
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[video]",
    "-map",
    "[audio]",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-bf",
    "0",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-b:a",
    "192k",
    "-t",
    String(duration),
    "-movflags",
    "+faststart",
    output,
  );
  return args;
}
