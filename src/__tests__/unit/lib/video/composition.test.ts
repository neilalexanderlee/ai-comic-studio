import { it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  timelineRenderArgs,
  type RenderMedia,
} from "@/lib/video/render-timeline";
import {
  TRANSITIONS,
  EFFECTS,
  type TransitionName,
} from "@/lib/video/composition";
vi.unmock("node:fs");
it("renders every offered transition and effect, preserves duration and composites overlapping tracks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-"));
  const ff = (args: string[]) =>
    execFileSync("ffmpeg", ["-v", "error", ...args], { maxBuffer: 8e6 });
  try {
    const sources = ["red", "blue"].map((color, i) => {
      const input = path.join(dir, `${i}.mp4`);
      ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=64x64:r=24`,
        "-t",
        "1",
        "-c:v",
        "libx264",
        input,
      ]);
      return input;
    });
    const videos: RenderMedia[] = sources.map((input, i) => ({
      input,
      hasAudio: false,
      startTime: i,
      endTime: i + 1,
      duration: 1,
      width: 64,
      height: 64,
      track: 0,
    }));
    for (const transitionType of Object.keys(TRANSITIONS) as TransitionName[]) {
      const output = path.join(dir, `${transitionType}.mp4`);
      ff(
        timelineRenderArgs({
          videos,
          audio: [],
          output,
          width: 64,
          height: 64,
          fps: 24,
          duration: 2,
          transitions: [
            { track: 0, startTime: 0.75, endTime: 1.25, transitionType },
          ],
        }),
      );
      const raw = ff([
        "-i",
        output,
        "-an",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      expect(raw.length / (64 * 64 * 3), transitionType).toBe(48);
      expect(raw[0], transitionType).toBeGreaterThan(200);
      expect(raw[raw.length - 1], transitionType).toBeGreaterThan(200);
    }
    for (const effectType of EFFECTS) {
      const output = path.join(dir, `${effectType}.mp4`);
      ff(
        timelineRenderArgs({
          videos: [{ ...videos[0], effectType }],
          audio: [],
          output,
          width: 64,
          height: 64,
          fps: 24,
          duration: 1,
        }),
      );
      expect(fs.statSync(output).size, effectType).toBeGreaterThan(500);
      // Effects that composite onto a generated canvas can change the timebase.
      // Exercise their output through a transition, not only in isolation.
      ff(timelineRenderArgs({
        videos: [{ ...videos[0], effectType }, videos[1]],
        audio: [], output, width: 64, height: 64, fps: 24, duration: 2,
        transitions: [{ track: 0, startTime: 0.75, endTime: 1.25, transitionType: "pixelate" }],
      }));
      const combined = ff(["-i", output, "-an", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
      expect(combined.length / (64 * 64 * 3), effectType).toBe(48);
    }
    const output = path.join(dir, "overlap.mp4");
    ff(
      timelineRenderArgs({
        videos: [
          videos[0],
          {
            ...videos[1],
            track: 1,
            startTime: 0.25,
            endTime: 0.75,
            duration: 0.5,
          },
        ],
        audio: [],
        output,
        width: 64,
        height: 64,
        fps: 24,
        duration: 1,
      }),
    );
    const frame = (t: string) =>
      ff([
        "-ss",
        t,
        "-i",
        output,
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
    expect(frame("0.5")[2]).toBeGreaterThan(200);
    expect(frame("0.9")[0]).toBeGreaterThan(200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
