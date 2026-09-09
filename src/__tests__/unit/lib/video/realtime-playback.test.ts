import { expect, it } from "vitest";
import { mediaAtTime } from "@/components/editor/video-editor/utils/realtimePlayback";
import type { Clip, Track } from "@/components/editor/video-editor/utils/clipMeta";

const clip: Clip = {id:"a", trackId:"v", type:"video", name:"a", startTime:5, endTime:10, duration:5, trimStart:2, trimEnd:5, volume:1.5, fadeIn:2, fadeOut:2};
const track: Track = {id:"v", name:"v", type:"video", clips:[clip], volume:.8};

it("maps timeline time into trimmed source and keeps the unused tail silent", () => {
  expect(mediaAtTime(clip, track, 4, false).active).toBe(false);
  expect(mediaAtTime(clip, track, 6, false)).toEqual({active:true, sourceTime:3, volume:0.6000000000000001});
  expect(mediaAtTime(clip, track, 8, false)).toEqual({active:false, sourceTime:5, volume:0});
  expect(mediaAtTime(clip, track, 10, false).active).toBe(false);
});
it("multiplies track and clip gain with fades, including gain above one and muting", () => {
  expect(mediaAtTime({...clip, trimEnd:7}, track, 9, false).volume).toBeCloseTo(.6);
  expect(mediaAtTime({...clip, fadeIn:0}, track, 6, false).volume).toBeCloseTo(1.2);
  expect(mediaAtTime(clip, {...track, muted:true}, 6, false).volume).toBe(0);
  expect(mediaAtTime(clip, track, 6, true).volume).toBe(0);
});
