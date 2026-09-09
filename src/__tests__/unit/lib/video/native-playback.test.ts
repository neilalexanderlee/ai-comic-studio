import { describe, it, expect } from "vitest";
import { mediaAtTime, supportsWebAv } from "@/components/editor/video-editor/utils/nativePlayback";
import type { Clip, Track } from "@/components/editor/video-editor/utils/clipMeta";
const clip: Clip = { id:"c", trackId:"t", type:"bgm", name:"music", startTime:5, endTime:10, duration:5, trimStart:2, volume:0.5, fadeIn:1, fadeOut:2 };
const track: Track = { id:"t", type:"bgm", name:"music", clips:[clip], volume:0.8 };
describe("native preview", () => {
  it("uses native media on HTTP and when a required API is missing", () => {
    const apis = { VideoDecoder:()=>{}, AudioDecoder:()=>{} };
    expect(supportsWebAv({ ...apis, isSecureContext:false }, { getDirectory:()=>{} })).toBe(false);
    expect(supportsWebAv({ ...apis, isSecureContext:true })).toBe(false);
    expect(supportsWebAv({ ...apis, isSecureContext:true }, { getDirectory:()=>{} })).toBe(true);
  });
  it("preserves gain above one and stops at the explicit source trim boundary", () => {
    expect(mediaAtTime({...clip,volume:2,fadeIn:0,fadeOut:0}, {...track,volume:1}, 7, false).volume).toBe(2);
    expect(mediaAtTime({...clip,trimEnd:3}, track, 7, false).active).toBe(false);
  });
  it("maps seek/trim and respects clip, track, master volume and fades", () => {
    expect(mediaAtTime(clip, track, 5.5, false)).toEqual({active:true, sourceTime:2.5, volume:0.2});
    expect(mediaAtTime(clip, track, 9, false).volume).toBe(0.2);
    expect(mediaAtTime(clip, {...track,muted:true}, 7, false).volume).toBe(0);
    expect(mediaAtTime(clip, track, 7, true).volume).toBe(0);
    expect(mediaAtTime(clip, track, 10, false).active).toBe(false);
  });
});
