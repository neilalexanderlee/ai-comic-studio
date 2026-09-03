/**
 * 结构性防回归测试：守住「新增视频品牌/版本时漏同步某处」这一类 bug。
 *
 * 视频相关的数据分散在四处：
 *   1. `video-capabilities.ts` 的 VIDEO_CAPABILITIES（能力）
 *   2. `provider-factory.ts` 的 createVideoProvider switch（实例化）
 *   3. `model-store.ts` 的 Protocol 联合类型（前端类型）
 *   4. `models/list/route.ts` 的 fallback 模型列表（用户能选到的 model id）
 *
 * 四者必须一一对应。本文件只做结构性断言（key/case/id 是否存在、字段是否自洽），
 * 不碰任何具体数值的"正确性"——那些要靠真实 API 验证，测试锁不住。
 *
 * 验收标准：以后加一个品牌只需改 (1)(2)，若漏了 (3)(4) 会在这里直接失败。
 */

import { describe, it, expect, vi } from "vitest";

// 全局 setup.ts 为其他单测 mock 了 node:fs；这个测试要读真实源码文件做文本扫描，
// 必须用回真实 fs（与 art-style-consistency.test.ts / prompt-templates-deplot.test.ts 同一模式）。
vi.mock("node:fs", async (importOriginal) => importOriginal());

import fs from "node:fs";
import path from "node:path";

import {
  VIDEO_CAPABILITIES,
  UNKNOWN_VIDEO_CAPABILITY,
  resolveVideoCapability,
  getModelMaxDuration,
  downgradeVideoMode,
  isKnownVideoModel,
  type VideoMode,
} from "@/lib/ai/video-capabilities";

const SRC = path.resolve(process.cwd(), "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf-8");

describe("VIDEO_CAPABILITIES ↔ provider-factory", () => {
  it("每个注册表协议在 createVideoProvider 里都有对应 case，反之亦然", () => {
    const factory = read("lib/ai/provider-factory.ts");
    // 只取真正做实例化的那个 switch 的 case。
    // 导出的 createVideoProvider 现在是个薄包装（外面套了一层存储桥，
    // 负责把 oss:// 引用物化成本地文件再交给 provider），switch 在 …Raw 里。
    const start = factory.indexOf("function createVideoProviderRaw");
    expect(start).toBeGreaterThan(-1);
    const body = factory.slice(start, factory.indexOf("\n}", start));

    const factoryProtocols = new Set(
      [...body.matchAll(/case\s+"([^"]+)":/g)].map((m) => m[1])
    );
    const registryProtocols = new Set(VIDEO_CAPABILITIES.map((c) => c.protocol));

    expect([...registryProtocols].sort()).toEqual([...factoryProtocols].sort());
  });
});

describe("VIDEO_CAPABILITIES ↔ model-store Protocol 联合类型", () => {
  it("每个注册表协议都是 Protocol 联合类型的成员", () => {
    const store = read("stores/model-store.ts");
    const start = store.indexOf("export type Protocol");
    expect(start).toBeGreaterThan(-1);
    const union = store.slice(start, store.indexOf(";", start));

    for (const cap of VIDEO_CAPABILITIES) {
      expect(union, `Protocol 联合类型缺少 "${cap.protocol}"`).toContain(`"${cap.protocol}"`);
    }
  });
});

describe("VIDEO_CAPABILITIES ↔ models/list 可选模型", () => {
  it("用户能在模型列表里选到的视频 model id 都能解析到真实能力条目（而非兜底）", () => {
    const listRoute = read("app/api/models/list/route.ts");
    // 视频类 model id 的命名前缀（与各家 fallback 列表一致）
    const videoIdPattern = /"((?:doubao-seedance|veo|kling-v|jimeng_i2v|MiniMax-H3)[^"]*)"/g;
    const ids = [...new Set([...listRoute.matchAll(videoIdPattern)].map((m) => m[1]))];

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(isKnownVideoModel(id), `model id "${id}" 在 VIDEO_CAPABILITIES 里没有对应条目`).toBe(
        true
      );
    }
  });
});

describe("VIDEO_CAPABILITIES 自洽性", () => {
  it.each(VIDEO_CAPABILITIES.map((c) => [c.label, c] as const))(
    "%s 的字段自洽",
    (_label, cap) => {
      expect(cap.label.trim()).not.toBe("");
      expect(cap.modes.length).toBeGreaterThan(0);
      expect(cap.duration.min).toBeGreaterThan(0);
      expect(cap.duration.max).toBeGreaterThanOrEqual(cap.duration.min);
      // 至少有一种方式能被匹配到，否则这条永远是死条目
      expect(cap.modelIds.length + cap.families.length).toBeGreaterThan(0);

      // refs 数量与 refTransport 必须同时有或同时无，否则会出现
      // "声明支持 N 张参考图但没有任何传输方式"这种自相矛盾的配置
      for (const kind of ["image", "audio", "video"] as const) {
        const count = cap.refs[kind];
        const transports = cap.refTransport[kind];
        expect(
          count > 0 ? transports.length > 0 : transports.length === 0,
          `${cap.label} 的 ${kind}: refs=${count} 与 refTransport=[${transports}] 不自洽`
        ).toBe(true);
      }

      // 声明支持多模态就必须能接收参考图
      if (cap.modes.includes("multimodal")) {
        expect(cap.refs.image, `${cap.label} 声明支持 multimodal 但 refs.image 为 0`).toBeGreaterThan(0);
      }

      // 音色克隆能力与音频参考上限必须一致
      expect(cap.features.voiceClone, `${cap.label} 的 voiceClone 与 refs.audio 不一致`).toBe(
        cap.refs.audio > 0
      );

      // 锁定的比例必须是该模型声明支持的比例之一
      for (const [mode, locked] of Object.entries(cap.ratioLockedModes ?? {})) {
        expect(cap.ratios, `${cap.label} 在 ${mode} 下锁定了未声明支持的比例 ${locked}`).toContain(
          locked
        );
      }

      // service_tier 只能声明在该模型真正支持的模式上
      for (const mode of cap.features.serviceTierModes) {
        expect(
          cap.modes,
          `${cap.label} 在不支持的模式 ${mode} 上声明了 service_tier`
        ).toContain(mode);
      }

      // 参考生视频（r2v）不接受 service_tier —— 实测被 API 同步拒绝，
      // 漏掉这条会让"参考生视频 + flex"这类组合在提交时 400。
      expect(
        cap.features.serviceTierModes,
        `${cap.label} 不应在 multimodal（r2v）上声明 service_tier`
      ).not.toContain("multimodal");
    }
  );

  it("精确 model id 不重复（否则解析结果取决于声明顺序）", () => {
    const all = VIDEO_CAPABILITIES.flatMap((c) => c.modelIds);
    expect(all.length).toBe(new Set(all).size);
  });
});

describe("getModelMaxDuration 行为保持（重构前 model-limits.ts 的口径）", () => {
  it.each([
    ["doubao-seedance-2-0-260128", 15],
    ["doubao-seedance-2-0-fast-260128", 15],
    ["doubao-seedance-1-5-pro-251215", 12],
    ["doubao-seedance-1-5-lite-250601", 10],
    ["veo-3.0-generate-001", 8],
    ["veo-3.1-fast-generate-001", 8],
    ["kling-v3", 15],
    ["kling-v2.5-turbo", 10],
    ["jimeng_i2v_v30", 10],
    ["jimeng_i2v_v30_1080", 10],
    ["minimax-h3", 15],
  ])("%s → %ss", (modelId, expected) => {
    expect(getModelMaxDuration(modelId)).toBe(expected);
  });

  it("家族兜底：未知版本落到家族值", () => {
    expect(getModelMaxDuration("doubao-seedance-2-0-fast-999999")).toBe(15);
    expect(getModelMaxDuration("doubao-seedance-1-5-lite-999999")).toBe(10);
    expect(getModelMaxDuration("doubao-seedance-9-9-999999")).toBe(12);
    expect(getModelMaxDuration("veo-9.9-generate-999")).toBe(8);
  });

  it("完全未知 / 空值 → 12", () => {
    expect(getModelMaxDuration("some-brand-new-model")).toBe(12);
    expect(getModelMaxDuration(undefined)).toBe(12);
    expect(getModelMaxDuration(null)).toBe(12);
    expect(getModelMaxDuration("")).toBe(12);
  });
});

describe("resolveVideoCapability", () => {
  it("精确 id 优先于家族匹配", () => {
    // "doubao-seedance-2-0-fast-260128" 同时含子串 "seedance-2-0"，必须命中 fast 那条
    expect(resolveVideoCapability("doubao-seedance-2-0-fast-260128").label).toBe(
      "Doubao Seedance 2.0 Fast"
    );
  });

  it("家族匹配取更长（更具体）的那个", () => {
    expect(resolveVideoCapability("doubao-seedance-1-5-lite-xxx").label).toBe(
      "Doubao Seedance 1.5 Lite"
    );
    expect(resolveVideoCapability("kling-v3-preview").label).toBe("Kling v3");
  });

  it("无 modelId 时按协议返回该协议的首条", () => {
    expect(resolveVideoCapability(null, "kling").protocol).toBe("kling");
    expect(resolveVideoCapability(undefined, "gemini").protocol).toBe("gemini");
  });

  it("完全无法识别时返回兜底而不是抛异常", () => {
    expect(resolveVideoCapability("totally-unknown-model")).toBe(UNKNOWN_VIDEO_CAPABILITY);
    expect(isKnownVideoModel("totally-unknown-model")).toBe(false);
  });
});

describe("downgradeVideoMode", () => {
  const seedance = resolveVideoCapability("doubao-seedance-2-0-260128");
  const kling = resolveVideoCapability("kling-v3");

  it("provider 支持时原样返回，不标记降级", () => {
    for (const mode of ["initialImage", "keyframe", "multimodal"] as VideoMode[]) {
      const d = downgradeVideoMode(mode, seedance);
      expect(d).toEqual({ mode, downgraded: false, requested: mode });
    }
  });

  it("Kling / Veo / 即梦 不支持 multimodal —— 降级为 initialImage 而不是崩溃", () => {
    // 这是本次重构修掉的真实线上问题：multimodal 是绝大多数镜头的默认模式，
    // 而 kling-video.ts / veo.ts / jimeng-video.ts 都只实现了首帧和首尾帧两种 body。
    for (const modelId of ["kling-v3", "kling-v1", "veo-3.0-generate-001", "jimeng_i2v_v30"]) {
      const cap = resolveVideoCapability(modelId);
      const d = downgradeVideoMode("multimodal", cap);
      expect(d.mode, `${modelId} 应降级为 initialImage`).toBe("initialImage");
      expect(d.downgraded).toBe(true);
      expect(d.requested).toBe("multimodal");
    }
  });

  it("降级结果一定在该 provider 声明支持的模式里", () => {
    for (const cap of VIDEO_CAPABILITIES) {
      for (const mode of ["initialImage", "keyframe", "multimodal"] as VideoMode[]) {
        expect(cap.modes).toContain(downgradeVideoMode(mode, cap).mode);
      }
    }
  });

  it("keyframe / initialImage 在 Kling 上不降级", () => {
    expect(downgradeVideoMode("keyframe", kling).downgraded).toBe(false);
    expect(downgradeVideoMode("initialImage", kling).downgraded).toBe(false);
  });
});
