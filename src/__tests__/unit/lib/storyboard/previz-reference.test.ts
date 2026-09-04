import { describe, it, expect } from "vitest";
import { decidePrevizReference } from "@/lib/storyboard/previz-reference";
import { resolveVideoCapability } from "@/lib/ai/video-capabilities";

const seedance25 = resolveVideoCapability("doubao-seedance-2-5-260628", "seedance");
const seedance20 = resolveVideoCapability("doubao-seedance-2-0-260128", "seedance");
const kling = resolveVideoCapability("kling-v3", "kling");

const base = {
  mode: "multimodal" as const,
  capability: seedance25,
  selectedId: "previz-1",
  previzVideoUrl: "oss://projects/p/previz/a.mp4",
  isRemoteRef: true,
};

describe("decidePrevizReference", () => {
  it("Seedance 2.5 + multimodal + OSS 引用 → 使用", () => {
    expect(decidePrevizReference(base)).toEqual({
      use: true,
      ref: "oss://projects/p/previz/a.mp4",
    });
  });

  it("没选预演 → 不使用且不提示（正常状态）", () => {
    expect(decidePrevizReference({ ...base, selectedId: null })).toEqual({ use: false });
  });

  it("选中的 take 已被删除 → 悬空 id 当作没选，不报错", () => {
    expect(decidePrevizReference({ ...base, previzVideoUrl: null })).toEqual({ use: false });
  });

  it("模型不支持参考视频（Seedance 2.0）→ 不使用但必须给出理由", () => {
    const d = decidePrevizReference({ ...base, capability: seedance20 });
    expect(d.use).toBe(false);
    expect((d as { note?: string }).note).toContain("不支持参考视频");
  });

  it("模型完全没有参考素材能力（Kling）→ 不使用但必须给出理由", () => {
    const d = decidePrevizReference({ ...base, capability: kling });
    expect(d.use).toBe(false);
    expect((d as { note?: string }).note).toBeTruthy();
  });

  it("首尾帧 / 严格首帧模式 → 不使用但必须给出理由", () => {
    for (const mode of ["keyframe", "initialImage"] as const) {
      const d = decidePrevizReference({ ...base, mode });
      expect(d.use).toBe(false);
      expect((d as { note?: string }).note).toBeTruthy();
    }
  });

  /**
   * 参考视频的时长限制是**异步**校验的：任务照常创建、几十秒后才报错。
   * 所以必须在提交前挡下 —— 否则用户看到的只是「又失败了一次」，
   * 且失败信息里根本不会提到"运镜预演"四个字。
   *
   * 本地 3D 渲染的预演时长等于镜头时长，镜头时长是用户自己填的，
   * 所以下界（<2s 的快切镜头）是真实可达的。
   */
  describe("时长限制", () => {
    it("在区间内 → 使用", () => {
      expect(decidePrevizReference({ ...base, durationSec: 3.5 }).use).toBe(true);
      expect(decidePrevizReference({ ...base, durationSec: 30 }).use).toBe(true);
      expect(decidePrevizReference({ ...base, durationSec: 2 }).use).toBe(true);
    });

    it("低于下界（快切镜头）→ 不使用，理由里要带上具体数字", () => {
      const d = decidePrevizReference({ ...base, durationSec: 1.5 });
      expect(d.use).toBe(false);
      expect((d as { note?: string }).note).toContain("1.5s");
      expect((d as { note?: string }).note).toContain("2–30s");
    });

    it("高于上界 → 不使用", () => {
      expect(decidePrevizReference({ ...base, durationSec: 31 }).use).toBe(false);
    });

    it("时长未知（历史记录没写这一列）→ 放行，不能因为不知道就挡掉", () => {
      expect(decidePrevizReference({ ...base, durationSec: null }).use).toBe(true);
      expect(decidePrevizReference({ ...base }).use).toBe(true);
    });

    it("能力表没声明限制的模型 → 不检查（编数字比让上游报错更糟）", () => {
      const mini = resolveVideoCapability("doubao-seedance-2-0-mini-260615", "seedance");
      expect(mini.refVideoLimits).toBeUndefined();
      expect(
        decidePrevizReference({ ...base, capability: mini, durationSec: 1 }).use,
      ).toBe(true);
    });
  });

  it("预演存在本地（未配 OSS）→ 不使用但必须给出理由", () => {
    const d = decidePrevizReference({
      ...base,
      previzVideoUrl: "uploads/previz/a.mp4",
      isRemoteRef: false,
    });
    expect(d.use).toBe(false);
    expect((d as { note?: string }).note).toContain("公网");
  });
});
