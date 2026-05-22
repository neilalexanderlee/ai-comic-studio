/**
 * shot-split.ts — User prompt builder for shot_split.
 *
 * The SYSTEM prompt is now fully owned by the registry (registry.ts → shotSplitDef).
 * This file only builds the USER prompt that wraps the screenplay + character data.
 *
 * Usage in route.ts:
 *   const slots   = await resolveSlotContents("shot_split", { userId, projectId });
 *   const system  = getPromptDefinition("shot_split")!.buildFullPrompt(slots, { maxDuration });
 *   const prompt  = buildShotSplitPrompt(screenplay, characters, ...);
 */

export function buildShotSplitPrompt(
  screenplay: string,
  characters: string,
  characterVisualHints?: Array<{ name: string; visualHint: string }>,
  targetDurationSeconds?: number | null,
  visualStyleTag?: string,
  /** Max shot duration in seconds — used for duration-budget calculations */
  maxShotDuration: number = 15
): string {
  const styleBlock = visualStyleTag
    ? `\n⚠️ ART STYLE LOCK — HIGHEST PRIORITY:\nThis project's visual style is LOCKED to: ${visualStyleTag}\nEvery startFrame and endFrame description MUST explicitly state this style. NEVER describe photorealistic or 3D-render appearances. Character and environment descriptions must match this art style exactly.\n`
    : "";

  const hintBlock = characterVisualHints?.length
    ? `\n--- CHARACTER VISUAL IDENTIFIERS (MANDATORY) ---\n${characterVisualHints.map((c) => `${c.name}：${c.visualHint}`).join("\n")}\n--- END ---\n\nCRITICAL: Whenever a character appears in videoScript, motionScript, startFrame, or endFrame, you MUST write their name followed by their visual identifier in parentheses using EXACTLY the text above. Example: 天枢真君（银发金瞳）. Never invent alternative descriptions — always reuse the exact identifier string provided.`
    : "";

  // Inject a narrative-coverage constraint when target duration is known.
  // Placed BEFORE the screenplay so the LLM internalises the budget first.
  const coverageRule = targetDurationSeconds
    ? (() => {
        const targetMin = Math.floor(targetDurationSeconds / 60);
        const targetSec = targetDurationSeconds % 60;
        const targetLabel = targetSec > 0 ? `${targetMin}分${targetSec}秒` : `${targetMin}分钟`;
        const tolerance = Math.round(targetDurationSeconds * 0.1); // ±10%
        const low = targetDurationSeconds - tolerance;
        const high = targetDurationSeconds + tolerance;
        const minShots = Math.ceil(low / maxShotDuration);
        const typicalShots = Math.ceil(targetDurationSeconds / 10);
        return `
🎬 DURATION BUDGET — READ THIS BEFORE LOOKING AT THE SCREENPLAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Target total duration: ${targetLabel} (${targetDurationSeconds}s). Acceptable range: ${low}s – ${high}s.
At a typical 10s per shot, you need approximately ${typicalShots} shots.
At the maximum ${maxShotDuration}s per shot, you need at least ${minShots} shots.

MANDATORY RULES — violation = failed output:
① The screenplay's shot count is a STORY OUTLINE, NOT a shot list ceiling. You MUST generate as many shots as needed to reach ${low}s+.
② NEVER stretch a single shot's duration to pad time — pacing matters. Split or insert instead.
③ AFTER writing all shots, SUM every "duration" field silently:
   • Sum in range [${low}s, ${high}s] → output as-is.
   • Sum < ${low}s → YOU MUST INSERT additional shots (see types below) until sum ≥ ${low}s. Do not submit under-length output.
   • Sum > ${high}s → trim establishing/atmosphere shots first (cap at 8–10s each).

TYPES OF SHOTS TO INSERT (choose based on story context):
  - REACTION SHOT: after key dialogue, cut to the listener's micro-response — held breath, hand tightening, gaze shifting away
  - CHARACTER BEAT: internal conflict made visible — hesitation before a decision, a contradicting gesture, doubt behind the eyes
  - ENVIRONMENT DETAIL: a world element that foreshadows, mirrors, or ironically contrasts the emotional beat (not random scenery)
  - TRANSITION SHOT: character moving between locations, pace and posture carrying story subtext
  - PARALLEL ACTION: what another character is simultaneously doing, adding irony or tension

EVERY INSERTED SHOT MUST MEET S-GRADE STANDARDS:
  ✅ videoScript: 30–60 word Seedance prose, character name + visual ID, ONE action verb, camera formula, ONE sensory detail
  ✅ startFrame / endFrame: character position, expression, lighting, emotional tone
  ✅ motionScript: time-segmented, max 3s per segment
  ✅ Must advance: plot, character relationship, emotional state, or world-building
  ❌ No template videoScripts, no shots under 25 characters, no "character walks/sits" with no subtext
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      })()
    : "";

  return `Adapt this screenplay into an S-grade shot list following the system instructions above. Elevate every description — fix physical impossibilities, insert missing beats, smooth broken transitions. NO template phrases. NO literal copying of source text.
${styleBlock}${coverageRule}
--- SCREENPLAY ---
${screenplay}
--- END ---

--- CHARACTER REFERENCE DESCRIPTIONS ---
${characters}
--- END ---
${hintBlock}
Important: reference characters by their exact names and ensure their visual descriptions in startFrame/endFrame align with the character references above.

IMPORTANT: Your output language MUST match the language of the screenplay above. If it is in Chinese, write all fields in Chinese (except cameraDirection).`;
}
