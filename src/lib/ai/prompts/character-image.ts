export function buildCharacterTurnaroundPrompt(
  slotContents: Record<string, string>,
  characterName: string,
  description: string
): string {
  // Use the registry definition to assemble the prompt
  // But we have to replicate the buildFullPrompt logic here because we need to pass dynamic params
  const r = (k: string) => slotContents[k] || "";

  let nameLabelText: string;
  if (characterName) {
    nameLabelText = `=== 角色名标签 ===\n在四视图布局下方居中显示角色名"${characterName}"。使用现代无衬线字体，白色背景上的深色文字，居中对齐。名字清晰可读，呈现专业设定集风格。`;
  } else {
    nameLabelText = `=== 角色名标签 ===\n无需角色名标签。`;
  }

  return [
    `角色四视图参考设定图——专业角色设计文档。`,
    "",
    r("style_matching"),
    "",
    `=== 角色描述 ===`,
    `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
    "",
    r("face_detail"),
    "",
    r("weapons_equipment"),
    "",
    r("four_view_layout"),
    "",
    r("lighting_rendering"),
    "",
    r("consistency_rules"),
    "",
    nameLabelText,
    "",
    r("final_output_standard"),
  ].join("\n");
}

export function buildBeautyImagePrompt(
  slotContents: Record<string, string>,
  characterName: string,
  description: string
): string {
  const r = (k: string) => slotContents[k] || "";
  return [
    r("role_definition"),
    "",
    r("style_matching"),
    "",
    `=== 角色描述 ===`,
    `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
    "",
    r("beauty_rules"),
    "",
    r("face_detail"),
    "",
    r("lighting_rendering"),
  ].join("\n");
}

export function buildCombatImagePrompt(
  slotContents: Record<string, string>,
  characterName: string,
  description: string
): string {
  const r = (k: string) => slotContents[k] || "";
  return [
    r("role_definition"),
    "",
    r("style_matching"),
    "",
    `=== 角色描述 ===`,
    `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
    "",
    r("combat_rules"),
    "",
    r("weapons_equipment"),
    "",
    r("lighting_rendering"),
  ].join("\n");
}
