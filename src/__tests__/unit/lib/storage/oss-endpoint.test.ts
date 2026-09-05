/**
 * OSS 端点切换。
 *
 * 锁住的一条不变量比省流量重要得多：
 * **签名 URL 永远走公网端点，即使数据面走内网。**
 *
 * 签出来的地址要交给两类不在 VPC 里的消费者 —— 浏览器（302 跳过去）和上游模型服务
 * （Seedance 拉参考图/参考视频）。给它们一个 `-internal` 域名，结果是在**别人的机器上**
 * 解析失败：服务器自己一切正常，日志里什么都看不到。这类 bug 的排查成本极高，
 * 所以用测试钉死。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** 记录每次 `new OSS(...)` 拿到的配置，用来断言内外网端点分别用在哪 */
const constructed: Array<Record<string, unknown>> = [];

vi.mock("ali-oss", () => {
  return {
    default: class FakeOSS {
      opts: Record<string, unknown>;
      constructor(opts: Record<string, unknown>) {
        this.opts = opts;
        constructed.push(opts);
      }
      // 真实实现会按 internal 拼出不同 host；这里把它显式地反映出来
      signatureUrl(key: string, options?: Record<string, unknown>) {
        const host = this.opts.internal
          ? `${this.opts.region}-internal.aliyuncs.com`
          : `${this.opts.region}.aliyuncs.com`;
        const resp = options?.response as Record<string, string> | undefined;
        const disp = resp?.["content-disposition"];
        const process = options?.process as string | undefined;
        return `https://${this.opts.bucket}.${host}/${key}?sig=x${
          disp ? `&response-content-disposition=${encodeURIComponent(disp)}` : ""
        }${process ? `&x-oss-process=${encodeURIComponent(process)}` : ""}`;
      }
    },
  };
});

function setOssEnv(internal: boolean) {
  vi.stubEnv("OSS_REGION", "oss-cn-beijing");
  vi.stubEnv("OSS_BUCKET", "ai-comic-studio");
  vi.stubEnv("OSS_ACCESS_KEY_ID", "ak");
  vi.stubEnv("OSS_ACCESS_KEY_SECRET", "sk");
  vi.stubEnv("OSS_INTERNAL", internal ? "1" : "");
}

async function fresh() {
  vi.resetModules();
  constructed.length = 0;
  return {
    store: await import("@/lib/storage/artifact-store"),
    client: await import("@/lib/storage/oss-client"),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OSS_INTERNAL 未开启（本地开发 / 非阿里云部署）", () => {
  it("数据面与签名都走公网", async () => {
    setOssEnv(false);
    const { store, client } = await fresh();
    expect(client.isOssInternal()).toBe(false);

    const url = store.resolveArtifactUrl("oss://renders/a.mp4");
    expect(url).toContain("oss-cn-beijing.aliyuncs.com");
    expect(url).not.toContain("-internal");
    // 只建一个客户端就够了，不该白白多建一个
    expect(constructed.filter((c) => c.internal === true)).toHaveLength(0);
  });
});

describe("OSS_INTERNAL=1（与 bucket 同地域的 ECS 上）", () => {
  it("数据面客户端走内网 —— 省的就是这部分流量", async () => {
    setOssEnv(true);
    const { client } = await fresh();
    expect(client.isOssInternal()).toBe(true);
    client.getOssClient();
    expect(constructed.at(-1)).toMatchObject({ internal: true, region: "oss-cn-beijing" });
  });

  /** 这条是整个改动里最要紧的断言 */
  it("给浏览器的签名 URL 仍然是公网域名", async () => {
    setOssEnv(true);
    const { store } = await fresh();
    const url = store.resolveArtifactUrl("oss://frames/x.png");
    expect(url).toContain("oss-cn-beijing.aliyuncs.com");
    expect(url).not.toContain("-internal");
  });

  it("给上游模型服务的签名 URL 也是公网域名", async () => {
    setOssEnv(true);
    const { store } = await fresh();
    const url = store.resolveArtifactUrlForUpstream("oss://previz/take.mp4");
    expect(url).toContain("oss-cn-beijing.aliyuncs.com");
    expect(url).not.toContain("-internal");
  });

  it("内外网各建一个客户端，互不串用", async () => {
    setOssEnv(true);
    const { store, client } = await fresh();
    client.getOssClient();
    store.resolveArtifactUrl("oss://frames/x.png");
    expect(constructed.some((c) => c.internal === true)).toBe(true);
    expect(constructed.some((c) => c.internal === false)).toBe(true);
  });
});

describe("强制下载", () => {
  it("传了文件名就把 content-disposition 签进 URL", async () => {
    setOssEnv(false);
    const { store } = await fresh();
    const url = store.resolveArtifactUrl("oss://renders/a.mp4", {
      downloadFilename: "export-1.mp4",
    });
    expect(decodeURIComponent(url)).toContain('attachment; filename=');
    expect(decodeURIComponent(url)).toContain("export-1.mp4");
  });

  it("不传就不带 —— 播放用的 URL 必须保持逐字节稳定，否则浏览器缓存全部落空", async () => {
    setOssEnv(false);
    const { store } = await fresh();
    const a = store.resolveArtifactUrl("oss://renders/a.mp4");
    const b = store.resolveArtifactUrl("oss://renders/a.mp4");
    expect(a).toBe(b);
    expect(a).not.toContain("content-disposition");
  });
});

/**
 * 缩略图（OSS 实时图片处理）。
 *
 * 这里省下的是**下行流量**，而流量包只有 2 GB/月且已经打穿过一次 ——
 * 所以「该缩的没缩」和「不该缩的缩了」是两类都不能出的错。
 */
describe("缩略图", () => {
  it("图片带上 x-oss-process，尺寸进签名", async () => {
    setOssEnv(false);
    const { store } = await fresh();
    const url = decodeURIComponent(store.resolveArtifactUrl("oss://frames/x.png", { thumbWidth: 320 }));
    expect(url).toContain("image/resize,w_320");
    // 不放大：原图比目标窄时保持原样，否则只是把小图插值成糊的大图
    expect(url).toContain("m_lfit");
    expect(url).toContain("format,webp");
  });

  it("不传宽度就是原图 —— 与改造前逐字节一致", async () => {
    setOssEnv(false);
    const { store } = await fresh();
    expect(store.resolveArtifactUrl("oss://frames/x.png")).not.toContain("x-oss-process");
  });

  it("非图片（视频/音频）静默忽略缩略图参数", async () => {
    setOssEnv(false);
    const { store } = await fresh();
    // uploadUrl 是纯客户端函数，拿到的只是一个不透明引用，分不清图片和视频；
    // 传错了只该「没省到流量」，绝不能让视频 403 播不出来
    for (const ref of ["oss://videos/a.mp4", "oss://bgm/b.wav"]) {
      expect(store.resolveArtifactUrl(ref, { thumbWidth: 320 })).not.toContain("x-oss-process");
    }
  });

  it("同宽度的 URL 逐字节稳定 —— 否则浏览器缓存永远落空", async () => {
    setOssEnv(false);
    const { store } = await fresh();
    const a = store.resolveArtifactUrl("oss://frames/x.png", { thumbWidth: 160 });
    const b = store.resolveArtifactUrl("oss://frames/x.png", { thumbWidth: 160 });
    expect(a).toBe(b);
    expect(a).not.toBe(store.resolveArtifactUrl("oss://frames/x.png", { thumbWidth: 640 }));
  });

  it("缩略图也走公网端点", async () => {
    setOssEnv(true);
    const { store } = await fresh();
    const url = store.resolveArtifactUrl("oss://frames/x.png", { thumbWidth: 320 });
    expect(url).not.toContain("-internal");
  });
});
