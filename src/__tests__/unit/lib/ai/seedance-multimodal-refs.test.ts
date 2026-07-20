import { describe, expect, it } from "vitest";
import { shouldResolveSeedanceMultimodalCharacterRefs } from "@/lib/ai/seedance-multimodal-refs";

describe("shouldResolveSeedanceMultimodalCharacterRefs", () => {
  it("resolves character refs for Seedance multimodal even when videoPrompt already exists", () => {
    expect(
      shouldResolveSeedanceMultimodalCharacterRefs({
        singleVideoMode: "multimodal",
        isSeedanceProtocol: true,
        namedCharacterCount: 2,
      })
    ).toBe(true);
  });

  it("does not resolve refs for keyframe / initialImage / non-Seedance / no named characters", () => {
    expect(
      shouldResolveSeedanceMultimodalCharacterRefs({
        singleVideoMode: "keyframe",
        isSeedanceProtocol: true,
        namedCharacterCount: 2,
      })
    ).toBe(false);
    expect(
      shouldResolveSeedanceMultimodalCharacterRefs({
        singleVideoMode: "initialImage",
        isSeedanceProtocol: true,
        namedCharacterCount: 2,
      })
    ).toBe(false);
    expect(
      shouldResolveSeedanceMultimodalCharacterRefs({
        singleVideoMode: "multimodal",
        isSeedanceProtocol: false,
        namedCharacterCount: 2,
      })
    ).toBe(false);
    expect(
      shouldResolveSeedanceMultimodalCharacterRefs({
        singleVideoMode: "multimodal",
        isSeedanceProtocol: true,
        namedCharacterCount: 0,
      })
    ).toBe(false);
  });
});
