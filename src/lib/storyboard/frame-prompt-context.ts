/**
 * 首尾帧 prompt 组装语义（字段合同 → registry 参数）
 * 对齐 Seedream「视频静帧」与 shot_split 的 start/end 静止态定义。
 */

export type FrameShotKind = "character" | "environment";

/** @deprecated 使用 FrameShotKind */
export type FirstFrameShotKind = FrameShotKind;

export type FrameReferenceMode = "none" | "continuity" | "character_sheet";

function cleanCameraDirection(cameraDirection?: string | null): string | undefined {
  const text = cameraDirection?.replace(/^\*+\s*/, "").replace(/\*+$/, "").trim();
  return text || undefined;
}

function splitCameraSegments(text: string): string[] {
  return text.split(/\s*(?:→|->|—>)\s*/).map((s) => s.trim()).filter(Boolean);
}

/** 整段运镜只取起幅，避免把「推到面部特写」画进首帧 */
export function extractOpeningCameraDirection(
  cameraDirection?: string | null
): string | undefined {
  const text = cleanCameraDirection(cameraDirection);
  if (!text) return undefined;
  const segments = splitCameraSegments(text);
  if (segments.length > 1) {
    const opening = segments[0];
    return `${opening}（首帧仅采用此起幅构图，勿使用后续跳切/推进/特写等运镜段）`;
  }
  return text;
}

/** 尾帧只取落幅段（链式运镜的最后一段） */
export function extractClosingCameraDirection(
  cameraDirection?: string | null
): string | undefined {
  const text = cleanCameraDirection(cameraDirection);
  if (!text) return undefined;
  const segments = splitCameraSegments(text);
  if (segments.length > 1) {
    const closing = segments[segments.length - 1];
    return `${closing}（尾帧仅采用此落幅/收束构图，勿使用起幅或中间运镜段）`;
  }
  return text;
}

export function resolveFrameShotKind(namedCharacterCount: number): FrameShotKind {
  return namedCharacterCount > 0 ? "character" : "environment";
}

/** @deprecated */
export const resolveFirstFrameShotKind = resolveFrameShotKind;

export function resolveFrameReferenceMode(params: {
  hasContinuityReference: boolean;
  hasCharacterSheetRefs: boolean;
}): FrameReferenceMode {
  if (params.hasContinuityReference) return "continuity";
  if (params.hasCharacterSheetRefs) return "character_sheet";
  return "none";
}

export function shouldUseStartFrameAsPrimaryEnvironment(startFrameDesc?: string | null): boolean {
  return !!startFrameDesc?.trim();
}

export function shouldUseEndFrameAsPrimaryEnvironment(endFrameDesc?: string | null): boolean {
  return !!endFrameDesc?.trim();
}

type ShotFrameFields = {
  prompt?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  cameraDirection?: string | null;
};

type PickFramePromptOpts = {
  shot: ShotFrameFields;
  characterDescriptions: string;
  namedCharacterCount: number;
  visualStyleTag?: string;
  cameraDirection?: string;
  slotContents?: Record<string, string>;
};

/** 供 buildFirstFramePrompt（生成 / 预览） */
export function pickFirstFramePromptBuildParams(
  opts: PickFramePromptOpts & {
    hasContinuityReference: boolean;
    hasCharacterSheetRefs: boolean;
    previousLastFrame?: string;
  }
) {
  const cleanedCamera =
    cleanCameraDirection(opts.cameraDirection) ||
    cleanCameraDirection(opts.shot.cameraDirection);

  return {
    sceneDescription: opts.shot.prompt || "",
    startFrameDesc: opts.shot.startFrameDesc || opts.shot.prompt || "",
    characterDescriptions: opts.characterDescriptions,
    shotKind: resolveFrameShotKind(opts.namedCharacterCount),
    frameReferenceMode: resolveFrameReferenceMode({
      hasContinuityReference: opts.hasContinuityReference,
      hasCharacterSheetRefs: opts.hasCharacterSheetRefs,
    }),
    visualStyleTag: opts.visualStyleTag,
    cameraDirection: extractOpeningCameraDirection(cleanedCamera),
    slotContents: opts.slotContents,
    previousLastFrame: opts.previousLastFrame,
  };
}

/** 供 buildLastFramePrompt（生成 / 预览） */
export function pickLastFramePromptBuildParams(
  opts: PickFramePromptOpts & {
    hasAnchorFirst: boolean;
    hasCharacterSheetRefs: boolean;
  }
) {
  const cleanedCamera =
    cleanCameraDirection(opts.cameraDirection) ||
    cleanCameraDirection(opts.shot.cameraDirection);

  return {
    sceneDescription: opts.shot.prompt || "",
    endFrameDesc: opts.shot.endFrameDesc || opts.shot.prompt || "",
    characterDescriptions: opts.characterDescriptions,
    shotKind: resolveFrameShotKind(opts.namedCharacterCount),
    hasAnchorFirst: opts.hasAnchorFirst,
    hasCharacterSheetRefs: opts.hasCharacterSheetRefs,
    visualStyleTag: opts.visualStyleTag,
    cameraDirection: extractClosingCameraDirection(cleanedCamera),
    slotContents: opts.slotContents,
  };
}
