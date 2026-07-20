import { describe, expect, it } from "vitest";
import { STORYBOARD_REWRITE_SYSTEM } from "@/lib/ai/prompts/storyboard-supervision";

describe("STORYBOARD_REWRITE_SYSTEM", () => {
  it("keeps camera equipment out of start/end frame descriptions", () => {
    expect(STORYBOARD_REWRITE_SYSTEM).toContain(
      "首帧/尾帧描述只写\"画面中实际可见的内容\""
    );
    expect(STORYBOARD_REWRITE_SYSTEM).toContain(
      "摄影机的位置、支撑方式、运镜意图全部写入 cameraDirection 字段"
    );
    expect(STORYBOARD_REWRITE_SYSTEM).not.toContain(
      "① 机位空间坐标"
    );
    expect(STORYBOARD_REWRITE_SYSTEM).not.toContain(
      "格式：「摄影机在[主体][方位][距离/贴近]，镜头高度[身体部位]」"
    );
  });
});
