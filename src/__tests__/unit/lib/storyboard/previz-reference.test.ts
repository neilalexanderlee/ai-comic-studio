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
