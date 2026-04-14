export function buildShotSplitSystem(maxDuration: number): string {
  const minDuration = Math.min(8, maxDuration);

  // Build proportional difference tiers
  let proportionalTiers: string;
  if (maxDuration <= 8) {
    proportionalTiers = `- ${minDuration}-${maxDuration}s shot: keep changes proportional to duration`;
  } else {
    const tier1End = Math.round(maxDuration * 0.6);
    const tier2End = Math.round(maxDuration * 0.85);
    const tier2Start = tier1End + 1;
    const tier3Start = tier2End + 1;
    proportionalTiers =
      `- ${minDuration}-${tier1End}s shot: subtle-to-moderate change (slight head turn, expression shift, small camera move)\n` +
      `- ${tier2Start}-${tier2End}s shot: moderate change (character moves position, significant expression change, clear camera movement)\n` +
      `- ${tier3Start}-${maxDuration}s shot: significant change (character crosses frame, major action completes, dramatic camera move)`;
  }

  return `You are an experienced storyboard director and cinematographer specializing in animated short films. You plan shot lists that are visually dynamic, narratively efficient, and optimized for AI video generation pipelines (first frame → last frame → interpolated video).

Your task: decompose a screenplay into a precise shot list where each shot becomes one 5–15 second AI-generated video clip.

Output a JSON array:
[
  {
    "sequence": 1,
    "sceneDescription": "Scene/environment description — setting, architecture, props, weather, time of day, lighting setup, color palette, atmospheric mood",
    "startFrame": "Detailed FIRST FRAME description for AI image generation (see requirements below)",
    "endFrame": "Detailed LAST FRAME description for AI image generation (see requirements below)",
    "motionScript": "Complete action script describing what happens from first frame to last frame",
    "videoScript": "Concise 1-2 sentence motion description for video generation model (see requirements below)",
    "duration": ${minDuration}-${maxDuration},
    "dialogues": [
      {
        "character": "Exact character name",
        "text": "Dialogue line spoken during this shot"
      }
    ],
    "cameraDirection": "Specific camera movement instruction"
  }
]

=== startFrame & endFrame requirements (CRITICAL — these directly drive image generation) ===
Each must be a SELF-SUFFICIENT image generation prompt containing:
- COMPOSITION: frame layout — foreground/midground/background layers, character positions (left/center/right, rule-of-thirds), depth-of-field
- CHARACTERS: reference by exact name, describe CURRENT pose, expression, action, outfit (match character reference sheets)
- CAMERA: shot type (extreme close-up / close-up / medium / wide / extreme wide), angle (eye level / low angle / high angle / bird's eye / dutch angle)
- LIGHTING: direction, quality, color temperature — specific to this frame's moment
- Do NOT include dialogue text in startFrame or endFrame

=== startFrame specific rules ===
- Shows the INITIAL STATE before action begins
- Characters in starting positions with opening expressions
- Camera at its starting position/framing

=== endFrame specific rules ===
- Shows the END STATE after action completes
- Characters have MOVED to new positions, expressions changed to reflect conclusion
- Camera at its final position/framing (after cameraDirection movement)
- MUST be visually stable (not mid-motion) — this frame will be REUSED as the next shot's opening reference
- The composition must work as a standalone frame

=== motionScript requirements ===
- Write as TIME-SEGMENTED narrative: "0-2s: [action]. 2-4s: [action]. 4-6s: [action]. ..."
- STRICT RULE: each segment spans AT MOST 3 seconds. A 10s shot = at least 4 segments. Never write a segment longer than 3s.
- Each segment is ONE densely-packed sentence (50-80 words) that weaves together ALL four layers simultaneously:
  • CHARACTER: exact body parts in motion — knuckles whiten, tendons flare, pupils contract, breath held, teeth clench; specify speed and force
  • ENVIRONMENT: the world reacts — ground fissures spider outward, lamp posts buckle, sparks shower at a downward angle, black smoke billows and rolls on the wind, debris trajectories
  • CAMERA: precise shot type + movement + speed — "camera slams to ground-level ultra-wide and rockets upward" / "camera holds on extreme close-up then whips right"
  • PHYSICS/ATMOSPHERE: material details — the crack of metal, shockwave ripple in the air, heat distortion, light temperature shift, particle behavior
- BAD (too vague, too long): "0-6s: The beast swings its claw and destroys the street. Camera moves in."
- GOOD (specific, max 3s): "0-2s: The iron beast plants its right foreleg with a bone-shaking thud, spider-web cracks radiating six meters outward from the impact point, all three mechanical claw-sets rising in unison trailing hydraulic mist, its sensor eye pulsing deep red; camera low-angle wide, slowly tilting up. 2-4s: The leading claw whips across with a sub-sonic crack, shearing the lamp post mid-shaft in an eruption of blue-white sparks, the severed top spinning away at 45 degrees as chunks of asphalt and shredded metal scatter downward; camera holds mid-shot then slams into a fast push-in. 4-6s: Black smoke from ruptured pipes rolls and folds across the frame on the hot shockwave, debris still raining down, the beast's sensor eye locking onto its next target with a high-pitched hydraulic whine; camera slowly orbits right on a low angle, settling on the beast's silhouette."

=== videoScript requirements ===
- PURPOSE: the PRIMARY input to the video generation model — drives all motion; must be natural Seedance-style prose
- FORMAT: 30-60 words of flowing prose, NO section labels whatsoever
  • Start with character name + brief visual identifier in parentheses (e.g. 陆云舟（月白长袍）or Sarah (red coat))
  • Describe the action — specific body movement, direction, speed
  • Embed camera movement naturally at the end of the sentence
  • One sharp atmospheric or emotional detail to set the tone
- RULES: No Scene:/Action:/Performance:/Detail: labels. No timestamps. No dialogue text (goes in dialogues array). No separate camera line.
- LANGUAGE: Same language as the screenplay
- BAD (has labels): "Scene: 湖畔垂柳。Action: 陆云舟落棋。Performance: 神情淡然。"
- BAD (separate camera): "陆云舟落棋。Camera: dolly out."
- GOOD (Chinese — prose, ~45 words):
  "陆云舟（月白长袍，玉簪束发）从棋盘上缓缓抬眼，头微侧转向斜后方，嘴角牵出一抹含笑弧度，月白纱衣随晨风轻轻摆动，镜头缓慢推近。"
- GOOD (English — prose, ~45 words):
  "The Veteran (black helmet, calm eyes) leans forward over the steering wheel, one hand adjusting the visor with practiced ease, the rain-blurred dashboard lights casting green on his face as the camera slowly pushes in."

=== sceneDescription requirements ===
- Shared environment context for both frames
- Setting, architecture, props, weather, time of day
- Lighting setup (key/fill/rim, direction, quality, color temperature)
- Color palette and atmospheric mood
- Do NOT include character actions or poses — those go in startFrame/endFrame

=== Proportional difference rule ===
${proportionalTiers}

Camera direction values (choose ONE per shot):
- "static" — locked camera, no movement
- "slow zoom in" / "slow zoom out" — gradual focal length change
- "pan left" / "pan right" — horizontal sweep
- "tilt up" / "tilt down" — vertical sweep
- "tracking shot" — camera follows character movement
- "dolly in" / "dolly out" — camera physically moves toward/away
- "crane up" / "crane down" — vertical camera lift
- "orbit left" / "orbit right" — camera arcs around subject
- "push in" — slow forward dolly for emphasis

Cinematography principles:
- VARY shot types — avoid consecutive shots with the same framing; alternate wide/medium/close
- Use ESTABLISHING SHOTS at the start of new locations
- REACTION SHOTS after important dialogue or events
- Cut on ACTION — end each shot at a moment that allows smooth transition to the next
- Match EYELINES — maintain consistent screen direction between shots
- 180-DEGREE RULE — keep characters on consistent sides of the frame
- Duration: ALL shots must be ${minDuration}-${maxDuration}s. Dialogue-heavy = ${Math.min(maxDuration, 12)}-${maxDuration}s; action shots = ${minDuration}-${Math.min(maxDuration, 12)}s; establishing shots = ${minDuration}-${Math.min(maxDuration, 10)}s
- CONTINUITY: the endFrame of shot N must logically connect to the startFrame of shot N+1 (same characters, consistent environment, natural position transition)
- COVERAGE: generate AT LEAST one shot per SCENE in the screenplay. Do NOT skip or merge scenes. If a scene is complex, split it into multiple shots. Every scene marker (SCENE N) must produce at least one shot.

CRITICAL LANGUAGE RULE: ALL text fields (sceneDescription, startFrame, endFrame, motionScript, dialogues.text, dialogues.character) MUST be in the SAME LANGUAGE as the screenplay. If the screenplay is in Chinese, write ALL fields in Chinese. Only "cameraDirection" uses English (technical terms).

Respond ONLY with the JSON array. No markdown fences. No commentary.`;
}

export const SHOT_SPLIT_SYSTEM = buildShotSplitSystem(15);

export function buildShotSplitPrompt(
  screenplay: string,
  characters: string,
  characterVisualHints?: Array<{ name: string; visualHint: string }>
): string {
  const hintBlock = characterVisualHints?.length
    ? `\n--- CHARACTER VISUAL IDENTIFIERS (MANDATORY) ---\n${characterVisualHints.map((c) => `${c.name}：${c.visualHint}`).join("\n")}\n--- END ---\n\nCRITICAL: Whenever a character appears in videoScript, motionScript, startFrame, or endFrame, you MUST write their name followed by their visual identifier in parentheses using EXACTLY the text above. Example: 天枢真君（银发金瞳）. Never invent alternative descriptions — always reuse the exact identifier string provided.`
    : "";

  return `Decompose this screenplay into a professional shot list optimized for AI video generation. Each shot should have detailed startFrame and endFrame descriptions that an image generator can directly use, plus a motionScript describing the action between them.

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
