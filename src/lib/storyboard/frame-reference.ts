export type FrameReferenceType = "anchor_first" | "anchor_last_ai" | "cut_point";

export type FrameReferencePayload = {
  shotId: string;
  frameType: FrameReferenceType;
};

export function frameReferenceTypeLabel(frameType: FrameReferenceType): string {
  switch (frameType) {
    case "anchor_first":
      return "首帧";
    case "anchor_last_ai":
      return "AI尾帧";
    case "cut_point":
      return "视频尾帧";
  }
}

export function formatChainSourceHint(
  sourceSequence: number | null | undefined,
  chainSourceType: string | null | undefined
): string | null {
  if (sourceSequence == null || !chainSourceType) return null;
  const type =
    chainSourceType === "anchor_first" ||
    chainSourceType === "anchor_last_ai" ||
    chainSourceType === "cut_point"
      ? frameReferenceTypeLabel(chainSourceType)
      : chainSourceType;
  return `首帧来自 · 镜${sourceSequence} · ${type}`;
}
