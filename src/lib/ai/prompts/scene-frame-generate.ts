import { getPromptDefinition } from "./registry";

export function buildSceneFramePrompt(params: {
  sceneDescription: string;
  charRefMapping: string;
  characterDescriptions: string;
  cameraDirection?: string | null;
  startFrameDesc?: string | null;
  motionScript?: string | null;
  /** Pre-resolved slot contents from the resolver (if available) */
  slotContents?: Record<string, string>;
}): string {
  const def = getPromptDefinition("scene_frame_generate");
  if (!def) {
    throw new Error("scene_frame_generate prompt definition not found in registry");
  }

  return def.buildFullPrompt(params.slotContents ?? {}, {
    sceneDescription: params.sceneDescription,
    charRefMapping: params.charRefMapping,
    characterDescriptions: params.characterDescriptions,
    cameraDirection: params.cameraDirection ?? "",
    startFrameDesc: params.startFrameDesc ?? "",
    motionScript: params.motionScript ?? "",
  });
}
