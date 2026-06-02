import { describe, expect, it } from "vitest";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";

describe("buildRefVideoPromptRequest", () => {
  it("locks the generated video prompt to the current opening frame before scene context", () => {
    const request = buildRefVideoPromptRequest({
      motionScript:
        "0-2s: 建立极远景城镇剪影，手持轻微横移营造紧迫感。2-4s: 跳切至两个孩子惊愕面孔。",
      sceneDescription:
        "远处木屋屋顶橙红色火舌窜起，黑色甲胄魔族士兵举着火把从小镇北侧涌入，村民四散奔逃。",
      startFrameDesc:
        "远景，小镇轮廓上方忽然亮起橙红，浓烟柱在满月前展开，两道小小身影从稻草堆里探出头。",
      endFrameDesc:
        "两张孩子的脸被火光映红，嘴微张，眼白里有火焰倒影。",
      cameraDirection:
        "jump cut接handheld push in - 远景镇子方向火光蹿起后跳切至两人惊愕的脸，再快速推进",
      duration: 11,
      frameCount: 2,
    });

    expect(request).toContain("FRAME GROUND TRUTH (highest priority)");
    expect(request).toContain("Opening frame at 0s");
    expect(request).toContain("远景，小镇轮廓");
    expect(request).toContain("Closing frame at 11s");
    expect(request).toContain("first sentence");
    expect(request).toContain("Do not open with later plot beats");
    expect(request).toContain("supplemental only");
    expect(request.indexOf("FRAME GROUND TRUTH")).toBeLessThan(
      request.indexOf("Scene description")
    );
  });

  it("uses only the opening frame as a temporal anchor in first-frame reference mode", () => {
    const request = buildRefVideoPromptRequest({
      motionScript: "远景里火光从屋顶边缘变亮，镜头缓慢推近。",
      startFrameDesc: "月夜远景，小镇屋顶安静，远处一点橙红初亮。",
      endFrameDesc: "不应出现",
      cameraDirection: "slow push in from wide shot",
      duration: 6,
      frameCount: 1,
    });

    expect(request).toContain("ONE image provided");
    expect(request).toContain("Opening frame at 0s");
    expect(request).not.toContain("Closing frame at 6s");
  });
});
