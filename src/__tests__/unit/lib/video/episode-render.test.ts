import { it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
vi.unmock("node:fs");
vi.mock("@/lib/storage/artifact-store", () => ({
  materializeArtifacts: vi.fn(async () => ({paths:[],cleanup:vi.fn()})),
  saveArtifactFromFile: vi.fn(async (_ref: string, file: string) => file),
}));
it("runs the production renderer through trim, BGM mix, validation and save", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-render-"));
  vi.stubEnv("UPLOAD_DIR", dir);
  vi.stubEnv("MEDIA_METADATA_DIR", path.join(dir,"metadata"));
  try {
    const source = path.join(dir, "source.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=32000", "-t", "2", "-c:v", "libx264", "-c:a", "aac", source]);
    const { renderEpisodeTimeline } = await import("@/lib/pipeline/episode-render");
    const timeline = {tracks:[
      {type:"video",muted:true,clips:[{type:"video",url:"source.mp4",startTime:0,endTime:1,duration:1,trimStart:.5,trimEnd:1.5}]},
      {type:"bgm",volume:.5,clips:[{type:"bgm",audioUrl:"source.mp4",startTime:0,endTime:1,duration:1,volume:.5,fadeIn:.1,fadeOut:.1}]},
    ]} as Parameters<typeof renderEpisodeTimeline>[0]["timeline"];
    const { outputUrl } = await renderEpisodeTimeline({projectId:"test",episodeId:"test",timeline});
    expect(fs.existsSync(outputUrl)).toBe(true);
    const streams = JSON.parse(execFileSync("ffprobe", ["-v","error","-show_streams","-of","json",outputUrl]).toString()).streams;
    expect(streams[0].r_frame_rate).toBe("24/1");
    expect(Number(streams[1].duration)).toBeCloseTo(1, 1);
    const { saveArtifactFromFile } = await import("@/lib/storage/artifact-store");
    expect(saveArtifactFromFile).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(path.join(dir,"metadata"))).toHaveLength(1);
    const {db}=await import("@/lib/db");
    const updateCount=vi.mocked(db.update).mock.calls.length;
    const preview=await renderEpisodeTimeline({projectId:"test",episodeId:"test",timeline,mode:"preview"});
    expect(vi.mocked(db.update).mock.calls.length).toBe(updateCount);
    const decoded=(file:string)=>execFileSync("ffmpeg",["-v","error","-i",file,"-map","0:v","-f","framemd5","-" ]).toString();
    expect(decoded(preview.outputUrl)).toBe(decoded(outputUrl));
    expect(fs.readdirSync(path.join(dir,"metadata"))).toHaveLength(1);
    fs.writeFileSync(path.join(dir,"broken.mp4"), "not a media file");
    const log = vi.spyOn(console,"error").mockImplementation(() => {});
    await expect(renderEpisodeTimeline({projectId:"test",episodeId:"test",timeline:{tracks:[
      {type:"video",clips:[{type:"video",url:"broken.mp4",startTime:0,endTime:1,duration:1}]},
    ]}})).rejects.toThrow();
    expect(saveArtifactFromFile).toHaveBeenCalledTimes(4);
    log.mockRestore();
  } finally { vi.unstubAllEnvs(); fs.rmSync(dir,{recursive:true,force:true}); }
}, 30000);
