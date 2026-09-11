/**
 * `user_client_prefs` 的版本号往返 —— 跑在**真实的临时 SQLite 文件**上。
 *
 * 这张表本身很朴素，值得单独测的只有一件事：**`upsertModelStorePrefs` 返回的
 * `updatedAt` 必须与随后读出来的完全相等。**
 *
 * 客户端拿这个值当「我手里是哪一版」，下次拉取时用 `服务端 > 本地` 判断要不要
 * 采用服务端那份。而 Drizzle 的 `mode:"timestamp"` **只存到秒**：直接返回
 * `new Date().getTime()` 会比读回来的值大最多 999 毫秒，于是客户端永远判成
 * 「本地更新」，**服务端的改动再也进不来**，症状是「在另一台设备上改的模型列表
 * 死活同步不过来」。秒/毫秒这个坑在本项目已经出现过三次（约定 8i / 8j），
 * 所以这条用测试钉死而不是只写注释。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

// 全局 setup.ts 同时 mock 了 node:fs 和 @/lib/db，这里两者都要真的。
vi.mock("node:fs", async (importOriginal) => importOriginal());
vi.mock("@/lib/db", async (importOriginal) => importOriginal());
import fs from "node:fs";

let tmpDir: string;
let dbFile: string;

async function freshModule() {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", `file:${dbFile}`);
  return await import("@/lib/user-client-prefs");
}

beforeEach(() => {
  // `createDb()` 把连接缓存在 globalThis 上，`vi.resetModules()` 清不掉它。
  const g = globalThis as unknown as { sqlite?: unknown; drizzleDb?: unknown };
  delete g.sqlite;
  delete g.drizzleDb;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-prefs-"));
  dbFile = path.join(tmpDir, "test.db");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const PAYLOAD = {
  providers: [
    {
      id: "p1",
      name: "Demo",
      protocol: "openai",
      baseUrl: "https://example.test/v1",
      apiKey: "",
      capability: "text",
      models: [{ id: "m1", name: "M1", checked: true }],
    },
  ],
  defaultTextModel: { providerId: "p1", modelId: "m1" },
  defaultImageModel: null,
  defaultVideoModel: null,
  defaultMusicModel: null,
} as unknown as import("@/stores/model-store").ModelStorePersistPayload;

describe("user_client_prefs 版本号", () => {
  it("写入返回的 updatedAt 与读回来的完全相等（秒截断不能泄漏出去）", async () => {
    const prefs = await freshModule();

    const written = await prefs.upsertModelStorePrefs("u1", PAYLOAD);
    const record = await prefs.getModelStoreRecord("u1");

    expect(record).not.toBeNull();
    expect(record!.updatedAt).toBe(written);
    // 秒对齐 —— 证明返回的确实是落库后的值，而不是内存里那个带毫秒的 Date
    expect(written % 1000).toBe(0);
  });

  it("再写一次，版本号不回退（同一秒内也至少保持相等）", async () => {
    const prefs = await freshModule();

    const first = await prefs.upsertModelStorePrefs("u1", PAYLOAD);
    const second = await prefs.upsertModelStorePrefs("u1", {
      ...PAYLOAD,
      defaultTextModel: null,
    });

    expect(second).toBeGreaterThanOrEqual(first);
    expect((await prefs.getModelStoreRecord("u1"))!.payload.defaultTextModel).toBeNull();
  });

  it("没有行时返回 null，而不是一个空信封", async () => {
    const prefs = await freshModule();
    expect(await prefs.getModelStoreRecord("nobody")).toBeNull();
    expect(await prefs.getModelStorePrefs("nobody")).toBeNull();
  });
});
