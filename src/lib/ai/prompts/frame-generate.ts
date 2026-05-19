import { getPromptDefinition } from "./registry";

export function buildFirstFramePrompt(params: {
  sceneDescription: string;
  startFrameDesc: string;
  characterDescriptions: string;
  previousLastFrame?: string;
  /**
   * 项目画风标签（来自 projects.visualStyle → VISUAL_STYLE_PRESETS[style].tag）。
   * 例如："日本现代2D动漫风格，8K高清，纯色背景，赛璐珞渲染，清晰线稿——"
   * 注入为 prompt 首行，锁定画风，防止模型漂移为写实风。
   */
  visualStyleTag?: string;
  /**
   * 运镜方向（来自 shot.cameraDirection，已去除 ** 前缀）。
   * 例如："crane up — 镜头从地面麦秸缓缓升起"
   * 指定首帧应采用的构图视角，确保帧与视频运动逻辑一致。
   */
  cameraDirection?: string;
  /** 分镜段标题（来自 shot.sceneTitle），提供构图语义。 */
  sceneTitle?: string;
  slotContents?: Record<string, string>;
}): string {
  const def = getPromptDefinition("frame_generate_first");
  if (def) {
    return def.buildFullPrompt(params.slotContents ?? {}, {
      sceneDescription: params.sceneDescription,
      startFrameDesc: params.startFrameDesc,
      characterDescriptions: params.characterDescriptions,
      previousLastFrame: params.previousLastFrame,
      visualStyleTag: params.visualStyleTag,
      cameraDirection: params.cameraDirection,
      sceneTitle: params.sceneTitle,
    });
  }

  // Fallback: hardcoded prompt (should not be reached if registry is intact)
  const lines: string[] = [];

  // 画风硬锁（最高优先级）
  if (params.visualStyleTag) {
    lines.push(`视频静帧画面。${params.visualStyleTag}生成此镜头的首帧——构图稳定，主体清晰，专为视频帧插值优化。`);
  } else {
    lines.push(`视频静帧画面。Create the OPENING FRAME of this shot as a single high-quality image optimized for video frame interpolation.`);
  }
  lines.push(``);
  lines.push(`=== CRITICAL: ART STYLE (HIGHEST PRIORITY) ===`);
  if (params.visualStyleTag) {
    lines.push(`【强制画风】本项目画风已由制作方锁定为：${params.visualStyleTag}`);
    lines.push(`严禁输出写实照片风格。严禁输出3D渲染风格。必须严格遵守上述画风标签。`);
  } else {
    lines.push(`Read the CHARACTER DESCRIPTIONS and SCENE DESCRIPTION below. They specify or imply an art style.`);
    lines.push(`You MUST match that exact art style. Do NOT default to photorealism.`);
    lines.push(`- If descriptions mention 动漫/漫画/anime/manga/卡通/cartoon → produce anime/manga-style illustration`);
    lines.push(`- If descriptions mention 写实/真人/photorealistic → produce photorealistic image`);
    lines.push(`- If reference images are attached, their visual style is the ground truth — match it exactly`);
  }
  lines.push(``);
  if (params.sceneTitle) {
    lines.push(`=== 分镜段落 ===`);
    lines.push(params.sceneTitle);
    lines.push(``);
  }
  if (params.cameraDirection) {
    lines.push(`=== 运镜与构图视角 ===`);
    lines.push(`按以下运镜方式构图首帧：${params.cameraDirection}`);
    lines.push(``);
  }
  lines.push(`=== SCENE ENVIRONMENT ===`);
  lines.push(params.sceneDescription);
  lines.push(``);
  lines.push(`=== FRAME DESCRIPTION ===`);
  lines.push(params.startFrameDesc);
  lines.push(``);
  lines.push(`=== CHARACTER DESCRIPTIONS ===`);
  lines.push(params.characterDescriptions);
  lines.push(``);
  lines.push(`=== REFERENCE IMAGES (CHARACTER SHEETS) ===`);
  lines.push(`Each attached reference image is a CHARACTER SHEET showing 4 views (front, three-quarter, side, back).`);
  lines.push(`The character's NAME is printed at the bottom of each sheet — use it to identify which character it represents.`);
  lines.push(`MANDATORY CONSISTENCY RULES:`);
  lines.push(`- Match the character name in the sheet to the character name in the scene description`);
  lines.push(`- CLOTHING MUST BE IDENTICAL to the reference — same garment type, color, material, accessories. Do NOT substitute (e.g. do NOT replace 青色常服 with 龙袍)`);
  lines.push(`- Face, hairstyle, hair color, body type, skin tone must match EXACTLY`);
  lines.push(`- All accessories (帽子, 佩刀, 发簪, jewelry) shown in the reference MUST appear`);
  lines.push(`- Art style must match the reference images exactly`);
  lines.push(``);

  if (params.previousLastFrame) {
    lines.push(`=== CONTINUITY REQUIREMENT ===`);
    lines.push(`This shot DIRECTLY follows the previous shot. The attached reference includes the previous shot's final frame. Maintain visual continuity:`);
    lines.push(`- Same characters must appear in consistent outfits and proportions`);
    lines.push(`- Same art style — do NOT switch between anime and photorealism`);
    lines.push(`- Environmental lighting and color temperature should transition smoothly`);
    lines.push(`- Character positions should logically follow from where the previous shot ended`);
    lines.push(``);
  }

  lines.push(`=== RENDERING ===`);
  lines.push(`Textures: Rich detail appropriate to the art style`);
  lines.push(`Lighting: Cinematic lighting with motivated light sources. Use rim lighting for character separation.`);
  lines.push(`Backgrounds: Fully rendered, detailed environment. No blank or abstract backgrounds.`);
  lines.push(`Characters: Match reference images exactly in appearance AND art style. Expressive faces, natural dynamic poses.`);
  lines.push(`Composition: Cinematographic framing with clear focal point and depth-of-field.`);

  return lines.join("\n");
}

export function buildLastFramePrompt(params: {
  sceneDescription: string;
  endFrameDesc: string;
  characterDescriptions: string;
  firstFramePath: string;
  /** 项目画风标签（同 buildFirstFramePrompt），锁定尾帧画风一致性。 */
  visualStyleTag?: string;
  /** 运镜方向，用于指定尾帧构图视角。 */
  cameraDirection?: string;
  /** 分镜段标题，提供语义上下文。 */
  sceneTitle?: string;
  slotContents?: Record<string, string>;
}): string {
  const def = getPromptDefinition("frame_generate_last");
  if (def) {
    return def.buildFullPrompt(params.slotContents ?? {}, {
      sceneDescription: params.sceneDescription,
      endFrameDesc: params.endFrameDesc,
      characterDescriptions: params.characterDescriptions,
      visualStyleTag: params.visualStyleTag,
      cameraDirection: params.cameraDirection,
      sceneTitle: params.sceneTitle,
    });
  }

  // Fallback: hardcoded prompt (should not be reached if registry is intact)
  const lines: string[] = [];

  if (params.visualStyleTag) {
    lines.push(`视频静帧画面。${params.visualStyleTag}生成此镜头的尾帧——构图稳定，姿态完整，专为视频帧插值优化。`);
  } else {
    lines.push(`视频静帧画面。Create the CLOSING FRAME of this shot as a single high-quality image optimized for video frame interpolation.`);
  }
  lines.push(``);
  lines.push(`=== CRITICAL: ART STYLE (HIGHEST PRIORITY) ===`);
  if (params.visualStyleTag) {
    lines.push(`【强制画风】本项目画风已锁定：${params.visualStyleTag}`);
    lines.push(`你同时必须精确匹配已附带的首帧图像的画风。严禁在画风之间切换。`);
  } else {
    lines.push(`You MUST match the EXACT art style of the first frame image (attached).`);
    lines.push(`If the first frame is anime/manga style → this frame MUST also be anime/manga style.`);
    lines.push(`If the first frame is photorealistic → this frame MUST also be photorealistic.`);
    lines.push(`Do NOT change or mix art styles. This is non-negotiable.`);
  }
  lines.push(``);
  lines.push(`=== SCENE ENVIRONMENT ===`);
  lines.push(params.sceneDescription);
  lines.push(``);
  lines.push(`=== FRAME DESCRIPTION ===`);
  lines.push(params.endFrameDesc);
  lines.push(``);
  lines.push(`=== CHARACTER DESCRIPTIONS ===`);
  lines.push(params.characterDescriptions);
  lines.push(``);
  lines.push(`=== REFERENCE IMAGES ===`);
  lines.push(`The FIRST attached image is the OPENING FRAME of this same shot — use it as your visual anchor.`);
  lines.push(`The remaining attached images are CHARACTER SHEETS (4 views each, name printed at bottom).`);
  lines.push(`Match each character sheet's name to the characters in the scene.`);
  lines.push(``);
  lines.push(`=== RELATIONSHIP TO FIRST FRAME ===`);
  lines.push(`This closing frame shows the END STATE of the shot's action. Compared to the first frame:`);
  lines.push(`- Same environment, lighting setup, and color palette`);
  lines.push(`- Same art style — absolutely no style changes`);
  lines.push(`- IDENTICAL clothing — characters wear the EXACT same outfit as in their reference sheets and the first frame. No costume changes.`);
  lines.push(`- Same face, hairstyle, accessories — only pose/expression/position change`);
  lines.push(`- Character positions, poses, and expressions have CHANGED as described in the frame description above`);
  lines.push(``);
  lines.push(`=== AS NEXT SHOT'S STARTING POINT ===`);
  lines.push(`This frame will be reused as the next shot's opening frame. Ensure:`);
  lines.push(`- The pose is STABLE — not mid-motion or blurred`);
  lines.push(`- The composition is COMPLETE and works as a standalone frame`);
  lines.push(`- The framing allows natural transition to a different camera angle`);
  lines.push(``);
  lines.push(`=== RENDERING ===`);
  lines.push(`Textures: Rich detail matching the first frame's style`);
  lines.push(`Lighting: Same lighting setup as the first frame. Changes only if motivated by action.`);
  lines.push(`Backgrounds: Must match the first frame's environment.`);
  lines.push(`Characters: Match reference images exactly. Show emotional state at END of the shot's action.`);
  lines.push(`Composition: Natural conclusion of the shot, ready to cut to the next.`);

  return lines.join("\n");
}
