import { mediaTiming, type TimedMedia } from "./timeline";

export interface RenderMedia extends TimedMedia {
  input: string; hasAudio: boolean;
  width?: number; height?: number;
}

/** Each source has its own decoder. Never concatenate heterogeneous AAC packets. */
export function timelineRenderArgs(options: {
  videos: RenderMedia[]; audio: RenderMedia[]; output: string;
  width: number; height: number; fps: number; duration: number; subtitles?: boolean;
}): string[] {
  const { videos, audio, output, width, height, fps, duration, subtitles } = options;
  const args = ["-y", "-v", "error", "-xerror", "-filter_complex_threads", "1"];
  [...videos, ...audio].forEach(c => args.push("-threads", "1", "-i", c.input));
  const filters: string[] = [];
  const segments: string[] = [];
  const sounds: string[] = [];
  let cursor = 0;
  function gap(length: number) {
    const label = `gap${segments.length}`;
    filters.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${length},settb=AVTB[${label}]`);
    segments.push(`[${label}]`);
  }
  videos.forEach((clip, i) => {
    const t = mediaTiming(clip);
    if (clip.startTime < cursor - 0.001) throw new Error("当前导出不支持重叠视频轨，请先将视频片段顺序排列");
    if (clip.startTime > cursor + 0.001) gap(clip.startTime - cursor);
    let chain = `[${i}:v:0]setpts=PTS-STARTPTS,trim=start=${t.sourceStart}:end=${t.sourceEnd},setpts=PTS-STARTPTS,settb=AVTB`;
    if (clip.width !== width || clip.height !== height) chain += `,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
    // Source shorter than the requested interval becomes black, never a cloned final frame.
    chain += `,setsar=1,tpad=stop_mode=add:stop_duration=${t.duration},trim=duration=${t.duration}[v${i}]`;
    filters.push(chain);
    segments.push(`[v${i}]`);
    cursor = clip.endTime;
  });
  if (duration > cursor + 0.001) gap(duration - cursor);
  filters.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0${subtitles ? ",subtitles=subtitles.ass" : ""}[video]`);
  [...videos, ...audio].forEach((clip, i) => {
    if (!clip.hasAudio) return;
    const t = mediaTiming(clip);
    let chain = `[${i}:a:0]asetpts=PTS-STARTPTS,atrim=start=${t.sourceStart}:end=${t.sourceEnd},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume ?? 1}`;
    if (clip.fadeIn && clip.fadeIn > 0) chain += `,afade=t=in:st=0:d=${clip.fadeIn}`;
    if (clip.fadeOut && clip.fadeOut > 0) chain += `,afade=t=out:st=${Math.max(0, t.duration - clip.fadeOut)}:d=${clip.fadeOut}`;
    chain += `,adelay=${Math.round(clip.startTime * 48000)}S:all=1[a${i}]`;
    filters.push(chain); sounds.push(`[a${i}]`);
  });
  // A finite silence bed defines duration, including deliberate gaps and silent sources.
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[silence]`);
  sounds.push("[silence]");
  filters.push(`${sounds.join("")}amix=inputs=${sounds.length}:duration=longest:normalize=0,atrim=duration=${duration}[audio]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[video]", "-map", "[audio]",
    "-c:v", "libx264", "-threads", "2", "-bf", "0", "-preset", "fast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-b:a", "192k", "-t", String(duration), "-movflags", "+faststart", output);
  return args;
}
