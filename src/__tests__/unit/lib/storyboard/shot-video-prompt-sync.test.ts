import { describe, it, expect } from "vitest";
import { buildDirectVideoPrompt } from "@/lib/storyboard/shot-video-prompt-sync.server";

const noopStripBgm = (text: string) => text;

describe("buildDirectVideoPrompt", () => {
  it("assembles prompt from all fields", () => {
    const result = buildDirectVideoPrompt({
      shot: {
        duration: 7,
        startFrameDesc: "近景平视，李明站在左三分之一",
        endFrameDesc: null,
        motionScript: "0-3s: [李明:转身→迈步] 3-7s: [李明:推开门]",
        prompt: null,
        cameraDirection: "固定镜头缓推",
        bgmNote: null,
      },
      visualStyleTag: "日本2D动漫风格",
      stripBgmContent: noopStripBgm,
    });

    expect(result).toContain("Duration: 7s.");
    expect(result).toContain("近景平视，李明站在左三分之一");
    expect(result).toContain("李明转身、迈步，随后李明推开门");
    expect(result).toContain("固定镜头缓推");
    expect(result).toContain("日本2D动漫风格");
  });

  it("falls back to prompt when motionScript is empty", () => {
    const result = buildDirectVideoPrompt({
      shot: {
        duration: 5,
        startFrameDesc: null,
        endFrameDesc: null,
        motionScript: null,
        prompt: "李明走向窗边",
        cameraDirection: "静止",
        bgmNote: null,
      },
      visualStyleTag: undefined,
      stripBgmContent: noopStripBgm,
    });

    expect(result).toContain("李明走向窗边");
    expect(result).toContain("静止");
  });

  it("omits empty fields", () => {
    const result = buildDirectVideoPrompt({
      shot: {
        duration: 3,
        startFrameDesc: "",
        endFrameDesc: null,
        motionScript: "[李明:点头]",
        prompt: null,
        cameraDirection: "",
        bgmNote: null,
      },
      visualStyleTag: undefined,
      stripBgmContent: noopStripBgm,
    });

    // Should not have leading/trailing 。 from empty fields
    expect(result).not.toMatch(/^Duration.*\n\n。/);
    expect(result).toContain("李明点头");
  });
});
