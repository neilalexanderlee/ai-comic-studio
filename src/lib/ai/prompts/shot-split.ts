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
  // DESIGN NOTE: Post-hoc "SUM after writing" instructions don't work — LLMs generate
  // tokens sequentially and cannot go back. Instead, we use a PLAN-FIRST approach:
  // the model must commit to a per-scene shot distribution BEFORE writing any JSON.
  const coverageRule = targetDurationSeconds
    ? (() => {
        const targetMin = Math.floor(targetDurationSeconds / 60);
        const targetSec = targetDurationSeconds % 60;
        const targetLabel = targetSec > 0 ? `${targetMin}分${targetSec}秒` : `${targetMin}分钟`;
        // Only enforce a minimum (no cap) — overage is fine, underage is not.
        const low = Math.round(targetDurationSeconds * 0.9);
        const high = targetDurationSeconds + Math.round(targetDurationSeconds * 0.2);
        const minShots = Math.ceil(low / maxShotDuration);
        // Plan at 9s/shot average (LLMs tend to generate 8-9s; planning at 10s leaves a structural gap)
        const typicalShots = Math.ceil(targetDurationSeconds / 9);
        return `
🎬 DURATION BUDGET — PLAN FIRST, THEN WRITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Target total duration: ${targetLabel} (${targetDurationSeconds}s).
HARD MINIMUM: ${low}s — underage output is a FAILED output. There is no acceptable underage.
Soft ceiling: ${high}s — trim only if necessary.
Minimum shot count: AT LEAST ${minShots} shots (at max ${maxShotDuration}s each).
Typical target: AT LEAST ${typicalShots} shots (averaging 9s each).

DURATION FLOOR — do not go below these minimums without a specific reason:
  Dialogue / emotional beat shots: 10s minimum (slower pacing → more weight)
  Environment / atmosphere shots: 9s minimum (need time to breathe)
  Action / transition shots: 8s minimum (only pure cuts may be shorter)

══ STEP 1 — MANDATORY PLANNING COMMENT (output this FIRST, before the JSON array) ══
Begin your response with ONE line in exactly this format — then write the JSON:

<!-- PLAN: Scene1=Ns(Xshots) | Scene2=Ns(Xshots) | ... | Total=Ns(Xshots) -->

Example: <!-- PLAN: 篝火开场=30s(3shots) | 龙渊灵瑶对话=45s(4shots) | 白夜追击=50s(5shots) | 结尾=30s(3shots) | Total=155s(15shots) -->

Commit to a shot count that reaches ≥${low}s TOTAL. Then write EXACTLY those shots.
This planning step is MANDATORY — output without it is a protocol violation.

══ STEP 2 — PER-SCENE EXPANSION RULES (apply while writing each scene) ══
These are HARD MINIMUMS per scene type, not suggestions:

DIALOGUE SCENE → AT LEAST: 1 speaker shot + 1 distinct listener reaction shot (≥2 shots per exchange)
  Expand with: additional speaker/listener alternating cuts; environment reaction shots; pause/beat shots
NEW LOCATION REVEAL → AT LEAST: 1 establishing wide shot + 2 character/action shots (≥3 shots)
  Expand with: detail shots of props/environment; character exploration of space
EMOTIONAL BEAT (realisation, confession, confrontation) → AT LEAST: 1 face close-up + 1 environment/reaction shot (≥2 shots)
  Expand with: silent pause shots; other characters' reactions; symbolic environment details
FIGHT/ACTION SEQUENCE → AT LEAST: wide approach + action contact + character response + aftermath (≥4 shots)
  Expand with: weapon detail shots; spectator reactions; terrain/physics shots
LOCATION TRANSITION → AT LEAST: 1 movement/bridging shot per transition
CROWD/ATMOSPHERE SCENE → AT LEAST: 1 wide establishing + 1 detail/texture shot (≥2 shots)

══ STEP 3 — SHOT INSERTION TYPES (use freely to reach the minimum) ══
These shot types ADD duration without padding or stretching existing shots:
  REACTION SHOT — listener's micro-response after dialogue: held breath, hand tightening, gaze shifting away (9–12s)
  CHARACTER BEAT — internal conflict made visible: hesitation, contradicting gesture, doubt behind eyes (9–12s)
  ENVIRONMENT DETAIL — world element that foreshadows or contrasts the emotional beat (9–14s)
  PARALLEL ACTION — what another character simultaneously does, adding irony or tension (9–12s)
  TRANSITION SHOT — character moving between locations, pace/posture carrying story subtext (8–11s)

EVERY SHOT (including inserted ones) MUST MEET S-GRADE STANDARDS:
  ✅ videoScript: 30–60 word Seedance prose, character name + visual ID, ONE action verb, camera formula, ONE sensory detail
  ✅ startFrame / endFrame: character position, expression, lighting, emotional tone — NOT mid-motion
  ✅ motionScript: time-segmented, max 3s per segment, all four layers (character/environment/camera/physics)
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
