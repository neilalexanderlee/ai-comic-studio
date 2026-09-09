import { it, expect } from "vitest";
import { canonicalTimeline } from "@/lib/video/timeline-contract";
import { mediaGain } from "@/lib/video/timeline";
it("normalizes legacy duration, excludes UI-only fields and invalidates composition edits", () => {
  const c = {
    id: "a",
    type: "video",
    url: "oss://a.mp4",
    startTime: 0,
    endTime: 2,
    duration: 9,
  };
  const t = { tracks: [{ type: "video", clips: [c] }] };
  const normalized = canonicalTimeline(t);
  expect(normalized.tracks[0].clips[0].duration).toBe(2);
  expect(
    canonicalTimeline({
      tracks: [
        {
          type: "video",
          clips: [
            {
              ...c,
              waveformData: [1, 2],
              previewUrl: "proxy",
              name: "renamed",
            },
          ],
        },
      ],
    }),
  ).toEqual(normalized);
  expect(
    canonicalTimeline({
      tracks: [{ type: "video", clips: [{ ...c, effectType: "shake" }] }],
    }),
  ).not.toEqual(normalized);
  expect(() =>
    canonicalTimeline({
      tracks: [{ type: "video", clips: [{ ...c, endTime: -1 }] }],
    }),
  ).toThrow();
  expect(() => canonicalTimeline({ ...t, compositionVersion: 999 })).toThrow();
  expect(mediaGain({ ...c, volume: 2, fadeIn: 1 }, { volume: 0.5 }, 0.5)).toBe(
    0.5,
  );
});
