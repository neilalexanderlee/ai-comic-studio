import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizedClipArgs } from "@/lib/video/normalize-render-clip";

vi.unmock("node:fs");

describe("mixed-rate render sources", () => {
  it("keeps a continuous 48k stereo track across 44.1k, silent and 32k sources", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-audio-test-"));
    const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", ...args]);
    try {
      const files = [44100, 0, 32000].map((rate, i) => {
        const input = path.join(dir, `${i}-in.mp4`), output = path.join(dir, `${i}.mp4`);
        ff(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24", ...(rate ? ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${rate}`] : []), "-t", "1", "-c:v", "libx264", "-c:a", "aac", input]);
        ff(normalizedClipArgs({ input, output, hasAudio: !!rate, duration: 1, width: 64, height: 64 }));
        return output;
      });
      const list = path.join(dir, "list.txt"), out = path.join(dir, "out.mp4");
      fs.writeFileSync(list, files.map(f => `file '${f}'`).join("\n"));
      ff(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "copy", "-c:a", "aac", out]);
      const pcm = ff(["-i", out, "-vn", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"]);
      expect(pcm.length / 4 / 48000).toBeGreaterThanOrEqual(3);
      const rms = (start: number) => {
        let sum = 0;
        for (let n = start * 48000; n < (start + 0.2) * 48000; n++) sum += pcm.readFloatLE(Math.floor(n) * 4) ** 2;
        return Math.sqrt(sum / 9600);
      };
      expect(rms(0.4)).toBeGreaterThan(0.02);
      expect(rms(1.4)).toBeLessThan(0.001);
      expect(rms(2.4)).toBeGreaterThan(0.02);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 20000);
});
