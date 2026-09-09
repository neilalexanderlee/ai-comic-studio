import { describe, it, expect, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { timelineRenderArgs, type RenderMedia } from "@/lib/video/render-timeline";
import { mediaTiming } from "@/lib/video/timeline";
vi.unmock("node:fs");
const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", ...args], { maxBuffer: 8 * 1024 * 1024 });
const pcmOf = (file: string) => ff(["-i", file, "-vn", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"]);
function rms(pcm: Buffer, start: number) {
  let sum = 0;
  for (let n = Math.round(start * 48000); n < Math.round((start + .1) * 48000); n++) sum += pcm.readFloatLE(n * 4) ** 2;
  return Math.sqrt(sum / 4800);
}
describe("decoded timeline render", () => {
  it("fixes the real mixed AAC failure while preserving 24fps, silence, gaps, trim and gain", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-test-"));
    try {
      const inputs = [44100, 32000, 0].map((rate, i) => {
        const input = path.join(dir, `${i}.mp4`);
        ff(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24", ...(rate ? ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${rate}`] : []), "-t", "2", "-c:v", "libx264", "-c:a", "aac", input]);
        return input;
      });
      // Red control: the original demuxer concatenates incompatible AAC configurations.
      const list = path.join(dir, "legacy.txt");
      fs.writeFileSync(list, inputs.slice(0, 2).map(f => `file '${f}'`).join("\n"));
      const legacy = path.join(dir, "legacy.mp4");
      const old = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-c:a", "aac", legacy]);
      expect(old.stderr.toString()).toMatch(/Error|Invalid/);
      const videos: RenderMedia[] = inputs.map((input, i) => ({input, hasAudio:i !== 2, startTime:i * 1.5, endTime:i * 1.5 + 1, duration:1, trimStart:.5, trimEnd:1.5, width:64, height:64, volume:i === 1 ? .25 : 1}));
      const output = path.join(dir, "new.mp4");
      ff(timelineRenderArgs({ videos, audio:[], output, width:64, height:64, fps:24, duration:4 }));
      const streams = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", output]).toString()).streams;
      expect(streams.find((s: {codec_type:string}) => s.codec_type === "video").r_frame_rate).toBe("24/1");
      const pcm = pcmOf(output);
      expect(pcm.length / 4 / 48000).toBeCloseTo(4, 1);
      expect(rms(pcm, .4)).toBeGreaterThan(.03);
      expect(rms(pcm, 1.2)).toBeLessThan(.001);
      expect(rms(pcm, 1.9) / rms(pcm, .4)).toBeCloseTo(.25, 1);
      expect(rms(pcm, 3.4)).toBeLessThan(.001);
      // Frame count reflects timeline duration, not the original two-second sources.
      expect(Number(streams[0].nb_frames)).toBe(96);
    } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  }, 30000);
  it("does not silently ignore explicit trimEnd or invalid timing", () => {
    expect(mediaTiming({startTime:2,endTime:5,duration:3,trimStart:1,trimEnd:2})).toEqual({duration:3,sourceStart:1,sourceEnd:2});
    expect(() => mediaTiming({startTime:0,endTime:1,duration:1,trimStart:2,trimEnd:1})).toThrow();
  });
});
