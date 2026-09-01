import { describe, it, expect } from "vitest";
import {
  quoteCredits,
  CREDIT_MARKUP,
  CREDIT_UNIT_YUAN,
} from "@/lib/billing/pricing";

describe("quoteCredits", () => {
  it("视频：时长和分辨率都影响报价", () => {
    const base = quoteCredits({
      kind: "video",
      modelId: "doubao-seedance-2-0-260128",
      durationSeconds: 5,
      resolution: "480p",
    });
    const longer = quoteCredits({
      kind: "video",
      modelId: "doubao-seedance-2-0-260128",
      durationSeconds: 10,
      resolution: "480p",
    });
    const higherRes = quoteCredits({
      kind: "video",
      modelId: "doubao-seedance-2-0-260128",
      durationSeconds: 5,
      resolution: "720p",
    });

    expect(longer.credits).toBeGreaterThan(base.credits);
    expect(higherRes.credits).toBeGreaterThan(base.credits);
    // 时长翻倍 → 报价翻倍（允许取整误差）
    expect(longer.credits).toBeCloseTo(base.credits * 2, -1);
  });

  it("2.5 比 2.0 贵，fast 比标准版便宜", () => {
    const q = (modelId: string) =>
      quoteCredits({ kind: "video", modelId, durationSeconds: 5, resolution: "480p" }).credits;
    expect(q("doubao-seedance-2-5-260628")).toBeGreaterThan(q("doubao-seedance-2-0-260128"));
    expect(q("doubao-seedance-2-0-fast-260128")).toBeLessThan(q("doubao-seedance-2-0-260128"));
  });

  it("时长按能力表 clamp —— 传夸张值不会把报价撑爆", () => {
    // 2.0 上限 15s，传 9999 应按 15s 计价
    const huge = quoteCredits({
      kind: "video",
      modelId: "doubao-seedance-2-0-260128",
      durationSeconds: 9999,
      resolution: "480p",
    });
    const capped = quoteCredits({
      kind: "video",
      modelId: "doubao-seedance-2-0-260128",
      durationSeconds: 15,
      resolution: "480p",
    });
    expect(huge.credits).toBe(capped.credits);
  });

  it("时长下限同样 clamp —— 传 0 或负数不会白嫖", () => {
    for (const d of [0, -5, 1]) {
      const q = quoteCredits({
        kind: "video",
        modelId: "doubao-seedance-2-0-260128",
        durationSeconds: d,
        resolution: "480p",
      });
      expect(q.credits).toBeGreaterThan(0);
    }
  });

  it("未知模型按中位价计费，不返回 0（否则可无限白嫖）", () => {
    const q = quoteCredits({
      kind: "video",
      modelId: "some-brand-new-model",
      durationSeconds: 5,
    });
    expect(q.credits).toBeGreaterThan(0);
  });

  it("图片按张数线性计价", () => {
    const one = quoteCredits({ kind: "image", imageCount: 1 });
    const four = quoteCredits({ kind: "image", imageCount: 4 });
    expect(four.credits).toBeCloseTo(one.credits * 4, -1);
  });

  it("图片张数缺省或非法时至少按 1 张计", () => {
    expect(quoteCredits({ kind: "image" }).credits).toBeGreaterThan(0);
    expect(quoteCredits({ kind: "image", imageCount: 0 }).credits).toBeGreaterThan(0);
    expect(quoteCredits({ kind: "image", imageCount: -3 }).credits).toBeGreaterThan(0);
  });

  it("音乐最低按 30 秒计（火山单段下限）", () => {
    const short = quoteCredits({ kind: "music", durationSeconds: 5 });
    const thirty = quoteCredits({ kind: "music", durationSeconds: 30 });
    expect(short.credits).toBe(thirty.credits);
  });

  it("文本当前不计费", () => {
    expect(quoteCredits({ kind: "text" }).credits).toBe(0);
  });

  it("报价 = 上游成本 × 倍数 / 单位面值，向上取整", () => {
    const q = quoteCredits({
      kind: "video",
      modelId: "doubao-seedance-2-0-260128",
      durationSeconds: 10,
      resolution: "480p",
    });
    const expected = Math.ceil((q.upstreamCostYuan * CREDIT_MARKUP) / CREDIT_UNIT_YUAN);
    expect(q.credits).toBe(expected);
  });

  it("explain 带上模型标签与参数，供前端展示", () => {
    const q = quoteCredits({
      kind: "video",
      modelId: "doubao-seedance-2-5-260628",
      durationSeconds: 8,
      resolution: "720p",
    });
    expect(q.explain).toContain("2.5");
    expect(q.explain).toContain("8s");
    expect(q.explain).toContain("720p");
  });
});
