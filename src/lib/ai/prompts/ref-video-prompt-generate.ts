/**
 * 直出模式下复用的视频动作脚本工具函数。
 *
 * ⚠️ 此文件不再包含 Vision-LLM 视频提示词精炼系统（已被 buildDirectVideoPrompt 直出架构替代，
 * 见 shot-video-prompt-sync.server.ts 与 CLAUDE.md 约定 12）。旧的 ref_video_prompt 系统提示词、
 * buildRefVideoPromptRequest 等已随该架构一并移除（无调用方，registry.ts 已废弃 ref_video_prompt 注册）。
 */

/** Expand bracket-format motionScript into natural prose.
 *
 * Format stored in DB:
 *   `0-3s: [单角色/共同动作] 3-7s: [角色A:动作1→动作2] [角色B:动作3→动作4] | 朝向：xxx`
 *
 * Expansion rules:
 * - `[content]` (no colon prefix) → content as-is, `→` replaced with `、`
 * - `[角色名:动作1→动作2]` → `角色名动作1、动作2`
 * - Multiple `[]` in same stage → joined with `；随后`
 * - Old format without `[]` passes through unchanged (backward compatibility)
 *
 * opts.prose = true（直出模式）：去除时间码前缀，跨段用「，随后」衔接，输出纯散文。
 *   示例："角色甲回头望向角色乙、迈步走近，随后角色乙嘴唇微颤无声"
 *
 * opts.prose = false / 默认：保留时间码，供 LLM 精炼时理解分段意图。
 *   示例："0-3s: 角色甲回头望向角色乙 3-7s: 角色乙嘴唇微颤无声"
 */
export function expandMotionScriptBrackets(motionScript: string, opts?: { prose?: boolean }): string {
  const trimmed = motionScript.trim();
  if (!trimmed.includes('[')) return trimmed; // old format — pass through

  // Separate camera direction suffix  `| 朝向：xxx`
  const dirMatch = trimmed.match(/\s*[|｜]\s*朝向\s*[:：]\s*(.+)$/);
  const dirSuffix = dirMatch ? dirMatch[1].trim() : undefined;
  const body = dirSuffix ? trimmed.slice(0, dirMatch!.index!).trim() : trimmed;

  /** 展开单个时间段里的 bracket 内容为文字列表 */
  function expandBracketSection(bracketSection: string): string[] {
    return [...bracketSection.matchAll(/\[([^\]]*)\]/g)]
      .map((m) => m[1].trim())
      .filter(Boolean)
      .map((content) => {
        const colonIdx = content.search(/[:：]/);
        if (colonIdx > 0) {
          const potentialName = content.slice(0, colonIdx).trim();
          // Character names are short (≤8 chars) and contain no punctuation
          if (potentialName.length <= 8 && !/[，。、\s]/.test(potentialName)) {
            const actions = content.slice(colonIdx + 1).trim().replace(/→/g, '、');
            return `${potentialName}${actions}`;
          }
        }
        return content.replace(/→/g, '、');
      });
  }

  // Match each time stage: `Xs-Ys:` followed by one or more `[...]` blocks
  const stageRe = /(\d+(?:\.\d+)?s?\s*[-–]\s*\d+(?:\.\d+)?s\s*[:：]\s*)((?:\[[^\]]*\]\s*)*)/g;

  if (opts?.prose) {
    // 散文直出模式：去掉时间码，跨段用「，随后」衔接
    const stageTexts: string[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(stageRe.source, 'g');
    while ((match = re.exec(body)) !== null) {
      const parts = expandBracketSection(match[2]);
      if (parts.length) stageTexts.push(parts.join('；随后'));
    }
    if (!stageTexts.length) {
      // 没有匹配到带时间码的时间段（如单一主体/共同动作场景 `[李明:点头]`，无 "Xs-Ys:" 前缀）：
      // 整体按单段落展开 bracket，而不是把方括号原样透传进最终 prompt。
      const parts = expandBracketSection(body);
      const proseBody = parts.length ? parts.join('、') : body;
      return dirSuffix ? `${proseBody}，朝向${dirSuffix}` : proseBody;
    }
    const proseBody = stageTexts.join('，随后');
    return dirSuffix ? `${proseBody}，朝向${dirSuffix}` : proseBody;
  }

  // 默认模式：保留时间码（给 LLM 看的结构化输入）
  const expanded = body.replace(stageRe, (_match, timeCode: string, bracketSection: string) => {
    const parts = expandBracketSection(bracketSection);
    if (!parts.length) return timeCode;
    return `${timeCode}${parts.join('；随后')}`;
  });

  const result = expanded.replace(/\s{2,}/g, ' ').trim();
  return dirSuffix ? `${result} | 朝向：${dirSuffix}` : result;
}

/**
 * 分镜字段拆分：动作主文案 vs 场景描述（shots.prompt）
 *
 * motionScript = 详细时间线，用户可编辑，唯一生成输入来源。
 *                对应 Toonflow 里"每个 shot 只有一条动作描述"的设计原则。
 */
export function resolveVideoMotionAndScene(shot: {
  prompt?: string | null;
  motionScript?: string | null;
}): { motionText: string; sceneDescription?: string } {
  const sceneRaw = shot.prompt?.trim() ?? "";
  const primary = (shot.motionScript || "").trim();
  if (primary) {
    const motionText = primary;
    const sceneDescription =
      sceneRaw && sceneRaw !== primary ? sceneRaw : undefined;
    return { motionText, sceneDescription };
  }
  return { motionText: sceneRaw, sceneDescription: undefined };
}
