export function buildCharacterTurnaroundPrompt(description: string, characterName?: string): string {
  return `Character four-view reference sheet — professional character design document.

=== CRITICAL: ART STYLE ===
Read the CHARACTER DESCRIPTION below carefully. The description specifies or implies an art style (e.g. anime, manga, photorealistic, cartoon, watercolor, pixel art, oil painting, etc.).
You MUST match that exact art style in your output. Do NOT default to photorealism. Do NOT override the described style.
- If the description says "动漫" / "漫画" / "anime" / "manga" → produce anime/manga-style illustration
- If the description says "写实" / "真人" / "photorealistic" → produce photorealistic rendering
- If the description implies any other style → follow that style faithfully
- If no style is mentioned at all → infer the most appropriate style from the character's setting and genre

=== CHARACTER DESCRIPTION ===
${characterName ? `Name: ${characterName}\n` : ''}${description}

=== FACE — HIGH DETAIL ===
Render the face with high precision appropriate to the chosen art style:
- Clear, consistent facial features: bone structure, eye shape, nose, mouth — all matching the described appearance
- Eyes: expressive, detailed, with catchlights and depth — adapted to art style (anime eyes for anime, realistic iris detail for photorealism, etc.)
- Hair: well-defined volume, color, and flow with style-appropriate rendering (individual strands for realism, bold clumps with highlight bands for anime, etc.)
- Skin: style-appropriate rendering — smooth cel-shading for anime, pore-level detail for photorealism, etc.
- Overall: the face should be striking and memorable, with strong visual identity

=== WEAPONS & EQUIPMENT (if applicable) ===
- Render all weapons, armor, and equipment in the same art style as the character
- Show material detail appropriate to the style: realistic wear for photorealism, clean stylized lines for anime/cartoon
- All equipment must be anatomically correct in scale relative to the character's body

=== FOUR-VIEW LAYOUT ===
Four views arranged LEFT to RIGHT on a clean pure white canvas, consistent medium shot (waist to crown) across all four:
1. FRONT — facing viewer directly, arms relaxed at sides showing full outfit and any held weapons
2. THREE-QUARTER — rotated ~45° right, showing face depth and dimensional form
3. SIDE PROFILE — perfect 90° facing right, clear silhouette of nose, hair, and any weapons
4. BACK — fully facing away, hairstyle from behind, clothing back detail, any back-mounted equipment

=== LIGHTING & RENDERING ===
- Clean, professional lighting: key light from above-front, fill from opposite side, rim light for separation
- Pure white background for clean character separation
- Style-appropriate rendering quality — the highest quality achievable within the chosen art style
- Consistent light direction across all four views

=== CONSISTENCY ACROSS ALL FOUR VIEWS ===
- Identical character identity in every view — same face, same proportions, same exact colors
- Identical outfit, accessories, weapon placement, hair color and style
- Heads aligned at the same top edge, waist at the same bottom edge across all four views
- Consistent expression and personality across all views

=== CHARACTER NAME LABEL ===
${characterName ? `Display the character's name "${characterName}" as a clean typographic label below the four-view layout. Use a modern sans-serif font, dark text on white background, centered alignment. The name should be clearly legible and presented in a professional reference-sheet style.` : 'No character name label required.'}

=== FINAL OUTPUT STANDARD ===
Professional character design reference sheet. Highest quality for the chosen art style. Zero AI artifacts, zero inconsistencies between views. This is the single canonical reference — all future generated frames MUST reproduce this exact character in this exact style.`;
}
