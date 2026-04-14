import { getPromptDefinition } from "./registry";

type CharacterRef = { name: string; visualHint?: string | null };

function buildCharacterLine(characters?: CharacterRef[]): string | null {
  const withHints = (characters ?? []).filter((c) => c.visualHint);
  if (!withHints.length) return null;
  return withHints.map((c) => `${c.name}（${c.visualHint}）`).join("，");
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
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  slotContents?: Record<string, string>;
}): string {
  const lines: string[] = [];

  if (params.duration) {
    lines.push(`Duration: ${params.duration}s.`);
    lines.push(``);
  }

  const charLine = buildCharacterLine(params.characters);
  if (charLine) {
    lines.push(`角色形象：${charLine}。`);
    lines.push(``);
  }

  lines.push(params.videoScript);

  lines.push(``);
  lines.push(`Camera: ${params.cameraDirection}.`);

  if (params.dialogues?.length) {
    // Resolve dialogue format slot to extract labels
    const dialogueFormatText = resolveSlot(
      params.slotContents,
      "ref_video_generate",
      "dialogue_format",
      ""
    );

    // Extract labels from the slot content, or use defaults
    const onScreenLabel = extractLabel(dialogueFormatText, "画内对白", "【对白口型】");
    const offScreenLabel = extractLabel(dialogueFormatText, "画外旁白", "【画外音】");

    lines.push(``);
    for (const d of params.dialogues) {
      if (d.offscreen) {
        lines.push(`${offScreenLabel}${d.characterName}: "${d.text}"`);
      } else {
        const label = d.visualHint ? `${d.characterName}（${d.visualHint}）` : d.characterName;
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
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  slotContents?: Record<string, string>;
}): string {
  const lines: string[] = [];

  if (params.duration) {
    lines.push(`Duration: ${params.duration}s.`);
    lines.push(``);
  }

  const charLine = buildCharacterLine(params.characters);
  if (charLine) {
    lines.push(`角色形象：${charLine}。`);
    lines.push(``);
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

  const hasStart = !!params.startFrameDesc;
  const hasEnd = !!params.endFrameDesc;
  if (hasStart || hasEnd) {
    // Resolve frame_anchors slot for label text
    const frameAnchorsText = resolveSlot(
      params.slotContents,
      "video_generate",
      "frame_anchors",
      ""
    );

    // Extract anchor header and labels from slot content, or use defaults
    const anchorHeader = extractAnchorHeader(frameAnchorsText, "[FRAME ANCHORS]");
    const openingLabel = extractFrameLabel(frameAnchorsText, "首帧", "Opening frame:");
    const closingLabel = extractFrameLabel(frameAnchorsText, "尾帧", "Closing frame:");

    lines.push(``);
    lines.push(anchorHeader);
    if (hasStart) lines.push(`${openingLabel} ${params.startFrameDesc}`);
    if (hasEnd) lines.push(`${closingLabel} ${params.endFrameDesc}`);
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

    lines.push(``);
    for (const d of params.dialogues) {
      if (d.offscreen) {
        lines.push(`${offScreenLabel}${d.characterName}: "${d.text}"`);
      } else {
        const label = d.visualHint ? `${d.characterName}（${d.visualHint}）` : d.characterName;
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
