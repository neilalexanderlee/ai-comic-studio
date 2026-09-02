import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

// 删除旧尾帧前会跨表查「有没有别的分镜正引用它」。这里默认返回空（无人引用），
// 需要模拟「被引用」的用例自行覆盖 selectResult。
let selectResult: { id: string }[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => selectResult }),
      }),
    }),
  },
}));

import { buildVideoCutPointUpdate } from "@/lib/storyboard/video-cut-point";

describe("buildVideoCutPointUpdate", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    // 存储层按 UPLOAD_DIR 换算相对 key，并拒绝根目录之外的路径。
    // 测试用例传的 uploadDir 是 /tmp/uploads，这里让存储根与之一致。
    vi.stubEnv("UPLOAD_DIR", "/tmp/uploads");
    selectResult = [];
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.mocked(fs.mkdirSync).mockClear();
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.unlinkSync).mockClear();
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it("writes only cutPoint path, not anchor_last_ai", async () => {
    const update = await buildVideoCutPointUpdate({
      remoteLastFrameUrl: "https://cdn.example/last.png",
      shotId: "shot-1",
      uploadDir: "/tmp/uploads",
      existingCutPoint: null,
    });
    expect(Object.keys(update)).toEqual(["cutPoint"]);
    expect(update.cutPoint).toContain("shot-1_seedance_lastframe");
    expect(update.cutPoint).toMatch(/\.png$/);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("returns empty object when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    const update = await buildVideoCutPointUpdate({
      remoteLastFrameUrl: "https://cdn.example/last.png",
      shotId: "shot-1",
      uploadDir: "/tmp/uploads",
    });
    expect(update).toEqual({});
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("deletes old cutPoint when it differs from anchorLastAi", async () => {
    await buildVideoCutPointUpdate({
      remoteLastFrameUrl: "https://cdn.example/last.png",
      shotId: "shot-1",
      uploadDir: "/tmp/uploads",
      existingCutPoint: "/tmp/uploads/frames/shot-1_seedance_lastframe_111.png",
      existingAnchorLastAi: "/tmp/uploads/frames/shot-1_lastframe_999.png",
    });
    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/uploads/frames/shot-1_seedance_lastframe_111.png");
  });

  it("does NOT delete old cutPoint when it is the same file as anchorLastAi (历史 bug 防回归)", async () => {
    // 旧版代码曾将 anchorLastAi 和 cutPoint 写成同一路径
    // 新版不得在替换 cutPoint 时连带删掉 anchorLastAi 的物理文件
    const sharedPath = "/tmp/uploads/frames/shot-1_lastframe_1779764547330.png";
    await buildVideoCutPointUpdate({
      remoteLastFrameUrl: "https://cdn.example/last.png",
      shotId: "shot-1",
      uploadDir: "/tmp/uploads",
      existingCutPoint: sharedPath,
      existingAnchorLastAi: sharedPath,
    });
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("不删被别的分镜 anchorFirst 引用的旧尾帧（承接上一镜尾帧是路径直拷）", async () => {
    // 真实事故：分镜3 用「承接上一镜尾帧」直拷了分镜2 的 cutPoint 路径；
    // 分镜2 视频重新生成时把旧文件删了，分镜3 的首帧当场变死链。
    selectResult = [{ id: "shot-3" }];
    await buildVideoCutPointUpdate({
      remoteLastFrameUrl: "https://cdn.example/last.png",
      shotId: "shot-2",
      uploadDir: "/tmp/uploads",
      existingCutPoint: "/tmp/uploads/frames/shot-2_seedance_lastframe_111.png",
      existingAnchorLastAi: null,
    });
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });
});
