/**
 * 从 motionScript bracket 格式中提取台词记录。
 *
 * 支持三种格式：
 *   [角色名（动作描述）说：「台词」（嘴型同步）]   → dialogue
 *   [角色名（动作描述）画外音VO：「台词」]         → vo
 *   [角色名（内心）OS：「台词」]                   → os
 *
 * 角色名约束：1-8 个中文字符（含括号内汉字变体，如「龙渊（10岁）」需先裁剪）
 */

export type DialogueType = "dialogue" | "os" | "vo";

export interface ExtractedDialogue {
  characterName: string;
  text: string;
  type: DialogueType;
  sequence: number;
}

// 中文字符范围（含常用扩展）
const HAN = "[\\u4e00-\\u9fff\\u3400-\\u4dbf]";
// 角色名：1-10 个汉字，可含·（如「龙渊·白夜」）
const CHAR_NAME = `(${HAN}{1,10}(?:[·•]${HAN}{1,10})*)`;
// 括号内的可选描述（俯视灵瑶、内心、10岁…）
const OPT_DESC = `(?:（[^）]{0,20}）)?`;

const RE_DIALOGUE = new RegExp(
  `^${CHAR_NAME}${OPT_DESC}\\s*(?:说|道|讲|喊|叫)[:：]「([^」]+)」`,
  "u"
);
const RE_VO = new RegExp(
  `^${CHAR_NAME}${OPT_DESC}\\s*画外音\\s*VO[:：]「([^」]+)」`,
  "u"
);
const RE_OS = new RegExp(
  `^${CHAR_NAME}${OPT_DESC}\\s*(?:内心\\s*)?OS[:：]「([^」]+)」`,
  "u"
);

export function extractDialoguesFromMotionScript(
  motionScript: string
): ExtractedDialogue[] {
  if (!motionScript) return [];

  const results: ExtractedDialogue[] = [];
  let seq = 0;

  for (const m of motionScript.matchAll(/\[([^\]]+)\]/gu)) {
    const content = m[1].trim();

    // 捕获组：[1]=角色名, [2]=可选描述（OPT_DESC 是非捕获组，不占位）, 实际[2]=台词文本
    // OPT_DESC 用 (?:...) 非捕获，所以只有两个捕获组：角色名[1]、台词[2]
    const vo = content.match(RE_VO);
    if (vo) {
      results.push({ characterName: vo[1], text: vo[2], type: "vo", sequence: seq++ });
      continue;
    }
    const os = content.match(RE_OS);
    if (os) {
      results.push({ characterName: os[1], text: os[2], type: "os", sequence: seq++ });
      continue;
    }
    const dl = content.match(RE_DIALOGUE);
    if (dl) {
      results.push({ characterName: dl[1], text: dl[2], type: "dialogue", sequence: seq++ });
    }
  }

  return results;
}
