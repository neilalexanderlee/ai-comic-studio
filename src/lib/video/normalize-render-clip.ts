/** Normalize every source BEFORE concat: AAC sample rates cannot change mid-stream. */
export function normalizedClipArgs(options: {
  input: string; output: string; hasAudio: boolean; duration: number;
  trimStart?: number; width: number; height: number;
}): string[] {
  const { input, output, hasAudio, duration, trimStart = 0, width, height } = options;
  const args = ["-y", "-ss", String(trimStart), "-i", input];
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  args.push(
    "-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0",
    "-vf", `setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${duration}`,
    "-af", `aresample=48000,asetpts=PTS-STARTPTS,apad,atrim=duration=${duration}`,
    "-t", String(duration), "-c:v", "libx264", "-bf", "0", "-preset", "fast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
    "-movflags", "+faststart", output,
  );
  return args;
}
