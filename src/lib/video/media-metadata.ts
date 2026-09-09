import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export interface MediaStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  time_base?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  start_time?: string;
}
export interface MediaMetadata {
  version: 1;
  sha256: string;
  runtime: string;
  streams: MediaStream[];
}
let runtime: Promise<string> | undefined;
export function mediaRuntime() {
  return (runtime ??= exec("ffmpeg", ["-version"]).then((r) =>
    r.stdout.trim(),
  ));
}
/** Content-addressed, private metadata cache. Originals are never rewritten. */
export async function inspectMedia(input: string): Promise<MediaMetadata> {
  const hash = createHash("sha256");
  for await (const bytes of fs.createReadStream(input)) hash.update(bytes);
  const sha256 = hash.digest("hex");
  const version = await mediaRuntime();
  const dir =
    process.env.MEDIA_METADATA_DIR ||
    path.join(process.env.DATA_DIR || "./data", "media-metadata");
  const key = createHash("sha256")
    .update(sha256 + version)
    .digest("hex");
  const cache = path.join(dir, key + ".json");
  try {
    const cached = JSON.parse(fs.readFileSync(cache, "utf8")) as MediaMetadata;
    if (
      cached.version === 1 &&
      cached.sha256 === sha256 &&
      cached.runtime === version &&
      Array.isArray(cached.streams)
    )
      return cached;
  } catch {
    /* Cache misses and damaged cache entries are re-probed. */
  }
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-of",
    "json",
    input,
  ]);
  const metadata: MediaMetadata = {
    version: 1,
    sha256,
    runtime: version,
    streams: JSON.parse(stdout).streams,
  };
  if (!metadata.streams?.length) throw new Error("素材没有有效媒体流");
  fs.mkdirSync(dir, { recursive: true });
  const temp = cache + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(metadata));
    fs.renameSync(temp, cache);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return metadata;
}
