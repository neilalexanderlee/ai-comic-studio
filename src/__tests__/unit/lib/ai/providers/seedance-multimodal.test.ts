import { describe, expect, it } from "vitest";
import { seedanceSupportsMultimodalReference } from "@/lib/ai/providers/seedance";

describe("seedanceSupportsMultimodalReference", () => {
  it("allows Seedance 2.0 models", () => {
    expect(seedanceSupportsMultimodalReference("doubao-seedance-2-0-260128")).toBe(true);
    expect(seedanceSupportsMultimodalReference("doubao-seedance-2-0-fast-260128")).toBe(true);
    expect(seedanceSupportsMultimodalReference("dreamina-seedance-2-0-fast-260128")).toBe(true);
  });

  it("rejects Seedance 1.5 models (no r2v)", () => {
    expect(seedanceSupportsMultimodalReference("doubao-seedance-1-5-pro-251215")).toBe(false);
    expect(seedanceSupportsMultimodalReference("doubao-seedance-1-5-lite-250601")).toBe(false);
  });
});
