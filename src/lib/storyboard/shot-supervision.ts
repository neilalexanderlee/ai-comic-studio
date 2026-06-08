/**
 * 分镜质量监督层（Toonflow production_agent_supervision.md 移植）
 *
 * 两层实现：
 * 1. 确定性规则校验（纯逻辑，无 LLM，始终执行）
 * 2. LLM 语义判断（当 enhancePrompts=true 时启用）
 *
 * 评分标准：
 * - A级：严重问题 0，中等问题 ≤ 2 → 直接通过
 * - B级：严重问题 0，中等问题 ≤ 5 → 小修后可用
 * - C级：严重问题 1-2 → 较大修改
 * - D级：严重问题 ≥ 3 → 建议重做
 */

export type IssueSeverity = "critical" | "warning";

export type SupervisionIssue = {
  shotId: string;
  shotSequence: number;
  ruleId: string;
  severity: IssueSeverity;
  description: string;
  suggestion?: string;
};

export type SupervisionGrade = "A" | "B" | "C" | "D";

export type SupervisionResult = {
  grade: SupervisionGrade;
  passCount: number;
  failCount: number;
  criticalCount: number;
  warningCount: number;
  issues: SupervisionIssue[];
  summary: string;
};

export type SupervisionShot = {
  id: string;
  sequence: number;
  prompt?: string | null;
  motionScript?: string | null;
  soundEffectNote?: string | null;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  dialogues?: Array<{ characterName: string; text: string }>;
};

export type ProjectChar = {
  id: string;
  name: string;
};

// ── 6 条红线（确定性规则） ────────────────────────────────────

const RED_LINES = [
  {
    id: "R1",
    label: "朝向标注完整",
    check: (shot: SupervisionShot) => {
      // 有命名角色的镜头，motionScript 末尾必须有 ｜朝向：标注
      const hasNamedChars = shot.dialogues && shot.dialogues.length > 0;
      if (!hasNamedChars) return null; // 群演/环境镜不要求
      if (shot.motionScript && /｜朝向：/.test(shot.motionScript)) return null;
      return {
        severity: "warning" as IssueSeverity,
        description: "motionScript 缺少 ｜朝向：标注",
        suggestion: "运行「重新生成文本」以补全角色朝向标注",
      };
    },
  },
  {
    id: "R2",
    label: "首尾帧非空",
    check: (shot: SupervisionShot) => {
      if (!shot.startFrameDesc?.trim()) {
        return {
          severity: "warning" as IssueSeverity,
          description: "startFrameDesc（首帧描述）为空",
          suggestion: "补充首帧静止构图描述",
        };
      }
      return null;
    },
  },
  {
    id: "R3",
    label: "朝向标注",
    check: (shot: SupervisionShot) => {
      // 有命名角色的镜头才检查（通过台词或 prompt 中的角色名判断）
      const hasNamedChar = (shot.dialogues?.length ?? 0) > 0;
      if (!hasNamedChar) return null;
      if (shot.motionScript && /｜朝向：/.test(shot.motionScript)) return null;
      return {
        severity: "warning" as IssueSeverity,
        description: "motionScript 末尾缺少 ｜朝向：标注",
        suggestion: "在 motionScript 末尾加上角色朝向，如「｜朝向：角色甲3/4侧面朝右」",
      };
    },
  },
  {
    id: "R4",
    label: "禁用模板词",
    check: (shot: SupervisionShot) => {
      const bannedPhrases = [
        "说话人面部表情随台词情绪流动，神情专注",
        "中景跟拍：捕捉",
        "特写推镜：捕捉情绪细节",
        "角色情绪丰富",
        "神情坚定",
        "眼神复杂",
      ];
      const fields = [shot.prompt, shot.motionScript, shot.startFrameDesc, shot.endFrameDesc].filter(Boolean).join(" ");
      const found = bannedPhrases.filter((p) => fields.includes(p));
      if (found.length === 0) return null;
      return {
        severity: "critical" as IssueSeverity,
        description: `包含禁用模板语：${found.slice(0, 2).join(" / ")}`,
        suggestion: "用具体的身体解剖描述替换情绪形容词",
      };
    },
  },
  {
    id: "R5",
    label: "motionScript 长度",
    check: (shot: SupervisionShot) => {
      const vs = shot.motionScript || "";
      if (vs.length > 200) {
        return {
          severity: "warning" as IssueSeverity,
          description: `motionScript 过长（${vs.length} 字），建议 ≤ 120 字`,
          suggestion: "精简为主体+动作+运镜+感官细节四要素",
        };
      }
      return null;
    },
  },
  {
    id: "R6",
    label: "BGM 禁注入视频 prompt",
    check: (shot: SupervisionShot) => {
      const bgmKeywords = ["配乐响起", "悲壮BGM", "弦乐渐强", "背景音乐", "主题曲", "BGM"];
      const fields = [shot.motionScript, shot.prompt].filter(Boolean).join(" ");
      const found = bgmKeywords.filter((k) => fields.includes(k));
      if (found.length === 0) return null;
      return {
        severity: "critical" as IssueSeverity,
        description: `视频 prompt 中含音乐描述：${found.join("、")}`,
        suggestion: "将音乐说明移至 bgmNote 字段，不注入视频生成 prompt",
      };
    },
  },
] as const;

// ── 评分逻辑 ──────────────────────────────────────────────

function calculateGrade(issues: SupervisionIssue[]): SupervisionGrade {
  const criticals = issues.filter((i) => i.severity === "critical").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  if (criticals === 0 && warnings <= 2) return "A";
  if (criticals === 0 && warnings <= 5) return "B";
  if (criticals <= 2) return "C";
  return "D";
}

// ── 主函数：确定性规则校验 ─────────────────────────────────

/**
 * 对分镜列表运行6条红线确定性校验。
 * 不调用 LLM，始终同步执行。
 */
export function superviseShots(
  shotList: SupervisionShot[],
  projectChars?: ProjectChar[]
): SupervisionResult {
  const issues: SupervisionIssue[] = [];
  let passCount = 0;

  for (const shot of shotList) {
    let shotPassed = true;
    for (const rule of RED_LINES) {
      const result = rule.check(shot);
      if (result) {
        issues.push({
          shotId: shot.id,
          shotSequence: shot.sequence,
          ruleId: rule.id,
          severity: result.severity,
          description: result.description,
          suggestion: result.suggestion,
        });
        shotPassed = false;
      }
    }
    if (shotPassed) passCount++;
  }

  const grade = calculateGrade(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  const summary = buildSummary(grade, shotList.length, criticalCount, warningCount);

  return {
    grade,
    passCount,
    failCount: shotList.length - passCount,
    criticalCount,
    warningCount,
    issues,
    summary,
  };
}

function buildSummary(
  grade: SupervisionGrade,
  total: number,
  criticals: number,
  warnings: number
): string {
  const gradeLabel: Record<SupervisionGrade, string> = {
    A: "A级 — 可直接使用",
    B: "B级 — 小修后可用",
    C: "C级 — 需较大修改",
    D: "D级 — 建议重做",
  };
  const parts = [`${gradeLabel[grade]}，共 ${total} 个分镜`];
  if (criticals > 0) parts.push(`严重问题 ${criticals} 个`);
  if (warnings > 0) parts.push(`警告 ${warnings} 个`);
  return parts.join("，");
}

// ── LLM 监督层（enhancePrompts=true 时启用）─────────────────

export const SUPERVISION_LLM_SYSTEM = `你是专业分镜质量审核 Agent，负责对 AI 生成的分镜进行语义层面的深度审核。

## 审核维度（在确定性规则通过后执行）

1. **内容忠实性**：分镜 prompt（画面描述）与 motionScript、startFrameDesc 是否逻辑一致，无矛盾
2. **首帧状态合理性**：startFrameDesc 是否为静止稳定状态（非 mid-motion），是否符合首帧识别规则；光影描述是否为静态主光而非动态进展
3. **首尾帧差异**：endFrameDesc 是否与 startFrameDesc 有可见构图/姿态差异（体现动作起止位移）
4. **台词类型合理性**：os（内心OS）的台词内容是否适合内心独白（不应是外部对话）

## 输出格式（JSON）

{
  "issues": [
    {
      "shotSequence": 1,
      "ruleId": "LLM-1",
      "severity": "critical|warning",
      "description": "一句话描述问题",
      "suggestion": "具体修改建议"
    }
  ],
  "overallAssessment": "一句话总评"
}

如果没有问题，输出 {"issues": [], "overallAssessment": "语义层面审核通过"}。
只输出 JSON，不附加任何解释文字。`;

export function buildSupervisionUserPrompt(shots: SupervisionShot[]): string {
  const items = shots.map((shot) => ({
    sequence: shot.sequence,
    prompt: shot.prompt?.slice(0, 100),
    startFrameDesc: shot.startFrameDesc?.slice(0, 100),
    endFrameDesc: shot.endFrameDesc?.slice(0, 100),
    motionScript: shot.motionScript?.slice(0, 120),
    dialogues: shot.dialogues?.slice(0, 3),
  }));
  return `请审核以下 ${shots.length} 个分镜：\n${JSON.stringify(items, null, 2)}`;
}
