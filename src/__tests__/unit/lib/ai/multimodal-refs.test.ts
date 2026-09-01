import { describe, expect, it } from "vitest";
import { shouldResolveMultimodalCharacterRefs } from "@/lib/ai/multimodal-refs";
import { resolveVideoCapability } from "@/lib/ai/video-capabilities";

const seedance = resolveVideoCapability("doubao-seedance-2-0-260128", "seedance");
const kling = resolveVideoCapability("kling-v3", "kling");

describe("shouldResolveMultimodalCharacterRefs", () => {
  it("resolves character refs for Seedance multimodal even when videoPrompt already exists", () => {
    expect(
      shouldResolveMultimodalCharacterRefs({
        singleVideoMode: "multimodal",
        capability: seedance,
        namedCharacterCount: 2,
      })
    ).toBe(true);
  });

  it("does not resolve refs for keyframe / initialImage / no named characters", () => {
    expect(
      shouldResolveMultimodalCharacterRefs({
        singleVideoMode: "keyframe",
        capability: seedance,
        namedCharacterCount: 2,
      })
    ).toBe(false);
    expect(
      shouldResolveMultimodalCharacterRefs({
        singleVideoMode: "initialImage",
        capability: seedance,
        namedCharacterCount: 2,
      })
    ).toBe(false);
    expect(
      shouldResolveMultimodalCharacterRefs({
        singleVideoMode: "multimodal",
        capability: seedance,
        namedCharacterCount: 0,
      })
    ).toBe(false);
  });

  it("does not resolve refs for providers without multimodal reference support", () => {
    expect(
      shouldResolveMultimodalCharacterRefs({
        singleVideoMode: "multimodal",
        capability: kling,
        namedCharacterCount: 2,
      })
    ).toBe(false);
  });
});
