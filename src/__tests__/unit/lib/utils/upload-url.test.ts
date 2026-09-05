/**
 * `uploadUrl` 的缩略图参数。
 *
 * 关键不变量：**不传 `w` 时的输出必须与引入缩略图之前逐字节一致**。
 * 这个函数有几十个调用点，其中相当一部分是视频、音频、下载链接和导出 ——
 * 它们不该因为别处加了缩略图而改变行为。
 */
import { describe, it, expect } from "vitest";
import { uploadUrl, THUMB_WIDTHS } from "@/lib/utils/upload-url";

describe("uploadUrl", () => {
  it("不传 w 时与改造前一致", () => {
    expect(uploadUrl("oss://frames/a.png")).toBe("/api/uploads/_oss/frames/a.png");
    expect(uploadUrl("./uploads/frames/a.png")).toBe("/api/uploads/frames/a.png");
    expect(uploadUrl("/app/uploads/videos/v.mp4")).toBe("/api/uploads/videos/v.mp4");
    expect(uploadUrl(".\\uploads\\bgm\\z.wav")).toBe("/api/uploads/bgm/z.wav");
  });

  it("传了 w 就带上查询参数，两种引用形态都要带", () => {
    expect(uploadUrl("oss://frames/a.png", { w: 320 })).toBe(
      "/api/uploads/_oss/frames/a.png?w=320"
    );
    // 本地引用同样带 —— 服务端会忽略它，但前端不该为「配没配 OSS」写两套逻辑
    expect(uploadUrl("./uploads/frames/a.png", { w: 160 })).toBe(
      "/api/uploads/frames/a.png?w=160"
    );
  });

  it("宽度是闭集 —— 每多一档就多一份 OSS 处理结果和一个缓存键", () => {
    expect([...THUMB_WIDTHS]).toEqual([160, 320, 640]);
  });
});
