import type { SingleVideoMode } from "@/lib/storyboard/shot-video-readiness.server";

export function shouldResolveSeedanceMultimodalCharacterRefs(params: {
  singleVideoMode: SingleVideoMode;
  isSeedanceProtocol: boolean;
  namedCharacterCount: number;
}): boolean {
  return (
    params.singleVideoMode === "multimodal" &&
    params.isSeedanceProtocol &&
    params.namedCharacterCount > 0
  );
}
