import { getPromptDefinition } from "./registry";

export type CharacterRef = { name: string; visualHint?: string | null; description?: string | null };

/**
 * 从 Seedream 角色描述中提取适用于 Seedance 视频提示词的外貌/服装信息。
 * Seedream 描述格式：「日本现代2D动漫风格...——【体态】...【面部】...【服装】...」
 * 视频提示词只需要【体态】【服装】的关键信息，去掉画风前缀。
 */
function extractAppearanceForVideo(description: string): string {
  if (!description) return "";
  // 找到第一个【】标记，去掉 Seedream 画风前缀
  const firstMarker = description.indexOf("【");
  const content = firstMarker > 0 ? description.slice(firstMarker) : description;
  // 截取合理长度，避免视频提示词过长
  return content.slice(0, 200).trimEnd();
}

function buildCharacterSection(
  characters?: CharacterRef[],
  options?: { slim?: boolean }
): string[] {
  const valid = (characters ?? []).filter((c) => c.name && (c.visualHint || c.description));
  if (!valid.length) return [];

  if (options?.slim) {
    const labels = valid.map((c) => {
      const hint = c.visualHint ? `（${c.visualHint}）` : "";
      return `${c.name}${hint}`;
    });
    return [`在场角色（外貌以参考帧为准）：${labels.join("、")}`, ``];
  }

  if (valid.length === 1) {
    const c = valid[0];
    const hint = c.visualHint ? `（${c.visualHint}）` : "";
    const appearance = c.description ? extractAppearanceForVideo(c.description) : "";
    if (appearance) return [`角色形象：${c.name}${hint}：${appearance}`, ``];
    return [`角色形象：${c.name}${hint}`, ``];
  }

  const lines = [`角色形象：`];
  for (const c of valid) {
    const hint = c.visualHint ? `（${c.visualHint}）` : "";
    const appearance = c.description ? extractAppearanceForVideo(c.description) : "";
    if (appearance) {
      lines.push(`- ${c.name}${hint}：${appearance}`);
    } else {
      lines.push(`- ${c.name}${hint}`);
    }
  }
  lines.push(``);
  return lines;
}

/**
 * Resolve a single slot value: use slotContents override, then registry default, then hardcoded fallback.
 */
function resolveSlot(
  slotContents: Record<string, string> | undefined,
  promptKey: string,
  slotKey: string,
  hardcodedFallback: string
): string {
  if (slotContents && slotKey in slotContents) return slotContents[slotKey];
  const def = getPromptDefinition(promptKey);
  if (def) {
    const s = def.slots.find((sl) => sl.key === slotKey);
    if (s) return s.defaultContent;
  }
  return hardcodedFallback;
}

/** Dialogue entry for a single line of spoken text in a video shot. */
type DialogueEntry = {
  characterName: string;
  text: string;
  offscreen?: boolean;
  /** Visual descriptor used to identify the character on screen (e.g. "穿红衣女子"). */
  visualHint?: string;
  /**
   * Voice characteristic hint following Seedance 1.5-pro formula:
   * 性别+年龄区间+声音属性+语速+情绪基线
   * Example: "女性，约20岁，声音明亮轻快，语速中等偏快，情绪积极略带兴奋"
   */
  voiceHint?: string;
};

/**
 * Prompt for reference-image-based video generation (Toonflow/Kling reference mode).
 * Seedance-style format: Shot description (prose) → Camera → 【对白口型】.
 * No frame interpolation header, no [FRAME ANCHORS] — the reference image provides visual context.
 */
export function buildReferenceVideoPrompt(params: {
  videoScript: string;
  cameraDirection: string;
  duration?: number;
  characters?: CharacterRef[];
  dialogues?: DialogueEntry[];
  slotContents?: Record<string, string>;
  /** 项目画风标签，用于注入画风锁定前缀（如 "日本现代2D动漫风格，8K高清，赛璐珞渲染——"）*/
  visualStyleTag?: string;
  /** 场景级音效提示（来自 【音效】 标签，注入视频 prompt 引导模型生成原生 SFX）*/
  soundEffectNote?: string | null;
  /** 参考图已提供角色外貌时，仅保留 visualHint 一行标识 */
  slimCharacterSection?: boolean;
}): string {
  const lines: string[] = [];

  if (params.duration) {
    lines.push(`Duration: ${params.duration}s.`);
    lines.push(``);
  }

  if (params.visualStyleTag) {
    lines.push(`【画风硬锁】${params.visualStyleTag}严禁写实风格。严禁3D CG风格。`);
    lines.push(``);
  }

  lines.push(
    ...buildCharacterSection(params.characters, {
      slim: params.slimCharacterSection ?? (params.characters?.length ?? 0) > 0,
    })
  );

  lines.push(params.videoScript);

  lines.push(``);
  lines.push(`Camera: ${params.cameraDirection}.`);

  // 音效提示：来自剧本 【音效】 标签，引导 Seedance/Kling 生成原生 SFX
  if (params.soundEffectNote) {
    lines.push(``);
    lines.push(`【音效】${params.soundEffectNote}`);
  }

  if (params.dialogues?.length) {
    // Resolve dialogue format slot to extract labels
    const dialogueFormatText = resolveSlot(
      params.slotContents,
      "video_generate",
      "dialogue_format",
      ""
    );

    // Extract labels from the slot content, or use defaults
    const onScreenLabel = extractLabel(dialogueFormatText, "画内对白", "【对白口型】");
    const offScreenLabel = extractLabel(dialogueFormatText, "画外旁白", "【画外音】");

    lines.push(``);
    lines.push(`NOTE: The following are the ONLY lines of speech. Do not repeat or infer additional dialogue from the scene description above.`);
    for (const d of params.dialogues) {
      if (d.offscreen) {
        // 画外音：可附加声音属性
        const voiceSuffix = d.voiceHint ? `（${d.voiceHint}）` : "";
        lines.push(`${offScreenLabel}${d.characterName}${voiceSuffix}: "${d.text}"`);
      } else {
        // 画内对白：视觉标识 + 可选声音属性
        const visualPart = d.visualHint ? `（${d.visualHint}）` : "";
        const voicePart = d.voiceHint ? `，声音属性：${d.voiceHint}` : "";
        const label = `${d.characterName}${visualPart}${voicePart}`;
        lines.push(`${onScreenLabel}${label}: "${d.text}"`);
      }
    }
  }

  return lines.join("\n");
}

export function buildVideoPrompt(params: {
  videoScript: string;
  cameraDirection: string;
  startFrameDesc?: string;
  endFrameDesc?: string;
  sceneDescription?: string;       // kept for call-site compatibility, not used in output
  duration?: number;
  characters?: CharacterRef[];
  dialogues?: DialogueEntry[];
  slotContents?: Record<string, string>;
  /** 项目画风标签，用于注入画风锁定前缀（如 "日本现代2D动漫风格，8K高清，赛璐珞渲染——"）*/
  visualStyleTag?: string;
  /** 场景级音效提示（来自 【音效】 标签，注入视频 prompt 引导模型生成原生 SFX）*/
  soundEffectNote?: string | null;
  /** 首尾帧图像已附：弱化人设块与文字帧锚点 */
  hasVisualFrameAnchors?: boolean;
}): string {
  const lines: string[] = [];

  if (params.duration) {
    lines.push(`Duration: ${params.duration}s.`);
    lines.push(``);
  }

  if (params.visualStyleTag) {
    lines.push(`【画风硬锁】${params.visualStyleTag}严禁写实风格。严禁3D CG风格。`);
    lines.push(``);
  }

  const useSlimChars =
    params.hasVisualFrameAnchors ?? false;
  if (!useSlimChars || (params.characters?.length ?? 0) > 0) {
    lines.push(
      ...buildCharacterSection(params.characters, { slim: useSlimChars })
    );
  }

  // Interpolation header from slot or registry default
  const interpolationHeader = resolveSlot(
    params.slotContents,
    "video_generate",
    "interpolation_header",
    "Smoothly interpolate from the opening frame to the closing frame."
  );
  lines.push(interpolationHeader);
  lines.push(``);

  lines.push(params.videoScript);

  lines.push(``);
  lines.push(`Camera: ${params.cameraDirection}.`);

  // 音效提示：来自剧本 【音效】 标签，引导 Seedance/Kling 生成原生 SFX
  if (params.soundEffectNote) {
    lines.push(``);
    lines.push(`【音效】${params.soundEffectNote}`);
  }

  const hasStart = !!params.startFrameDesc;
  const hasEnd = !!params.endFrameDesc;
  if (hasStart || hasEnd) {
    lines.push(``);
    if (params.hasVisualFrameAnchors) {
      lines.push(
        `[FRAME ANCHORS] Opening and closing frames are attached as images. Interpolate motion between them; do not restate full frame descriptions in text.`
      );
    } else {
      const frameAnchorsText = resolveSlot(
        params.slotContents,
        "video_generate",
        "frame_anchors",
        ""
      );
      const anchorHeader = extractAnchorHeader(frameAnchorsText, "[FRAME ANCHORS]");
      const openingLabel = extractFrameLabel(frameAnchorsText, "首帧", "Opening frame:");
      const closingLabel = extractFrameLabel(frameAnchorsText, "尾帧", "Closing frame:");
      const duration = params.duration ?? 10;

      lines.push(anchorHeader);
      if (hasStart) lines.push(`${openingLabel} [0s] ${params.startFrameDesc}`);
      if (hasEnd) lines.push(`${closingLabel} [${duration}s] ${params.endFrameDesc}`);
    }
  }

  if (params.dialogues?.length) {
    // Resolve dialogue format slot to extract labels
    const dialogueFormatText = resolveSlot(
      params.slotContents,
      "video_generate",
      "dialogue_format",
      ""
    );

    const onScreenLabel = extractLabel(dialogueFormatText, "画内对白", "【对白口型】");
    const offScreenLabel = extractLabel(dialogueFormatText, "画外旁白", "【画外音】");

    // Add a disambiguation note so the model doesn't double-voice dialogue that
    // may also appear as prose in the videoScript above.
    lines.push(``);
    lines.push(`NOTE: The following are the ONLY lines of speech. Do not repeat or infer additional dialogue from the scene description above.`);
    for (const d of params.dialogues) {
      if (d.offscreen) {
        const voiceSuffix = d.voiceHint ? `（${d.voiceHint}）` : "";
        lines.push(`${offScreenLabel}${d.characterName}${voiceSuffix}: "${d.text}"`);
      } else {
        const visualPart = d.visualHint ? `（${d.visualHint}）` : "";
        const voicePart = d.voiceHint ? `，声音属性：${d.voiceHint}` : "";
        const label = `${d.characterName}${visualPart}${voicePart}`;
        lines.push(`${onScreenLabel}${label}: "${d.text}"`);
      }
    }
  }

  return lines.join("\n");
}

// ── Helpers for extracting labels from slot content ──────

/**
 * Extract dialogue label (e.g. 【对白口型】or 【画外音】) from the slot format text.
 */
function extractLabel(
  slotText: string,
  _lineHint: string,
  fallback: string
): string {
  if (!slotText) return fallback;
  // Match patterns like 【对白口型】 or 【画外音】 from the slot content
  const lines = slotText.split("\n");
  for (const line of lines) {
    if (line.includes(_lineHint)) {
      const match = line.match(/(【[^】]+】)/);
      if (match) return match[1];
    }
  }
  return fallback;
}

/**
 * Extract the anchor section header (e.g. [FRAME ANCHORS] or [帧锚点]) from slot text.
 */
function extractAnchorHeader(slotText: string, fallback: string): string {
  if (!slotText) return fallback;
  const match = slotText.match(/^\[([^\]]+)\]/m);
  if (match) return `[${match[1]}]`;
  return fallback;
}

/**
 * Extract frame label (e.g. "Opening frame:" or "首帧：") from slot text.
 */
function extractFrameLabel(slotText: string, lineHint: string, fallback: string): string {
  if (!slotText) return fallback;
  const lines = slotText.split("\n");
  for (const line of lines) {
    if (line.includes(lineHint)) {
      // Extract label before the placeholder (e.g. "首帧：" from "首帧：{{START_FRAME_DESC}}")
      const match = line.match(/^([^{]+)/);
      if (match) return match[1].trim();
    }
  }
  return fallback;
}
