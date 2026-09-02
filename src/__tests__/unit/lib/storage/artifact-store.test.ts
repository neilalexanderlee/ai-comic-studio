/**
 * 存储抽象层测试。
 *
 * 锁住的核心不变量：**未配置 OSS 时，行为与改造前完全一致**——
 * 落本地磁盘、返回跟随 UPLOAD_DIR 的真实路径。存量 1.1GB 数据和自部署用户
 * 都依赖这一点，破坏它的症状是「文件生成了但界面显示缺失」。
 *
 * 实时 OSS 往返不在单测里跑（需要网络与真实凭证），已通过真实生成验证过。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

// 全局 setup.ts mock 了 node:fs；本测试需要真实读写临时目录
vi.mock("node:fs", async (importOriginal) => importOriginal());

import fs from "node:fs";

const OSS_ENV = [
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
] as const;

function clearOssEnv() {
  for (const k of OSS_ENV) vi.stubEnv(k, "");
}

async function freshStore(uploadDir: string) {
  vi.resetModules();
  vi.stubEnv("UPLOAD_DIR", uploadDir);
  return await import("@/lib/storage/artifact-store");
}

describe("artifact-store", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acs-store-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("未配置 OSS —— 必须与改造前行为一致", () => {
    beforeEach(clearOssEnv);

    it("落本地磁盘，并返回跟随 UPLOAD_DIR 的真实路径", async () => {
      const { saveArtifact } = await freshStore(tmp);
      const ref = await saveArtifact("bgm/x.wav", Buffer.from("hello"));

      // 返回的必须是**实际写入路径**（跟随 UPLOAD_DIR），否则 UPLOAD_DIR 被改动时
      // （Docker 里是 /app/uploads）引用会指向不存在的位置
      expect(ref).toBe(path.join(tmp, "bgm/x.wav"));
      expect(fs.readFileSync(ref, "utf8")).toBe("hello");
    });

    it("自动创建多层目录", async () => {
      const { saveArtifact } = await freshStore(tmp);
      const ref = await saveArtifact("projects/p1/v1/videos/a.mp4", Buffer.from("v"));
      expect(ref).toBe(path.join(tmp, "projects/p1/v1/videos/a.mp4"));
      expect(fs.existsSync(ref)).toBe(true);
    });

    it("读回内容与写入一致", async () => {
      const { saveArtifact, readArtifact } = await freshStore(tmp);
      const data = Buffer.from([0xff, 0x00, 0x42]);
      const ref = await saveArtifact("frames/f.png", data);
      expect(Buffer.compare(await readArtifact(ref), data)).toBe(0);
    });

    it("exists / delete 对本地文件生效，且 delete 幂等", async () => {
      const { saveArtifact, artifactExists, deleteArtifact } = await freshStore(tmp);
      const ref = await saveArtifact("bgm/y.wav", Buffer.from("y"));
      expect(await artifactExists(ref)).toBe(true);
      await deleteArtifact(ref);
      expect(await artifactExists(ref)).toBe(false);
      await expect(deleteArtifact(ref)).resolves.toBeUndefined(); // 再删不炸
    });

    it("artifactExists 对空值返回 false", async () => {
      const { artifactExists } = await freshStore(tmp);
      expect(await artifactExists(null)).toBe(false);
      expect(await artifactExists(undefined)).toBe(false);
      expect(await artifactExists("")).toBe(false);
    });

    it("本地引用解析成 /api/uploads/ 路由地址（与 uploadUrl 一致）", async () => {
      const { resolveArtifactUrl } = await freshStore(tmp);
      expect(resolveArtifactUrl("./uploads/bgm/x.wav")).toBe("/api/uploads/bgm/x.wav");
      // 绝对路径（Docker 里是 /app/uploads/...）同样要能解析
      expect(resolveArtifactUrl("/app/uploads/frames/f.png")).toBe("/api/uploads/frames/f.png");
      // Windows 反斜杠
      expect(resolveArtifactUrl(".\\uploads\\bgm\\z.wav")).toBe("/api/uploads/bgm/z.wav");
    });
  });

  describe("引用形态判别", () => {
    beforeEach(clearOssEnv);

    it("区分 oss:// 引用与本地路径", async () => {
      const { isOssRef, ossKeyOf } = await freshStore(tmp);
      expect(isOssRef("oss://bgm/x.wav")).toBe(true);
      expect(isOssRef("./uploads/bgm/x.wav")).toBe(false);
      expect(isOssRef("/app/uploads/bgm/x.wav")).toBe(false);
      expect(ossKeyOf("oss://bgm/x.wav")).toBe("bgm/x.wav");
      expect(ossKeyOf("oss://projects/p/v/videos/a.mp4")).toBe("projects/p/v/videos/a.mp4");
    });
  });

  describe("OSS 开关", () => {
    it("四个变量齐全才算启用", async () => {
      vi.resetModules();
      clearOssEnv();
      const m1 = await import("@/lib/storage/oss-client");
      expect(m1.isOssEnabled()).toBe(false);

      vi.resetModules();
      vi.stubEnv("OSS_REGION", "oss-cn-beijing");
      vi.stubEnv("OSS_BUCKET", "b");
      vi.stubEnv("OSS_ACCESS_KEY_ID", "id");
      vi.stubEnv("OSS_ACCESS_KEY_SECRET", "");
      const m2 = await import("@/lib/storage/oss-client");
      expect(m2.isOssEnabled(), "缺 SECRET 不应算启用").toBe(false);

      vi.resetModules();
      vi.stubEnv("OSS_ACCESS_KEY_SECRET", "secret");
      const m3 = await import("@/lib/storage/oss-client");
      expect(m3.isOssEnabled()).toBe(true);
    });

    it("未配置时取 client 抛出可读错误，而不是静默失败", async () => {
      vi.resetModules();
      clearOssEnv();
      const { getOssClient } = await import("@/lib/storage/oss-client");
      expect(() => getOssClient()).toThrow(/未配置 OSS/);
    });
  });
});
