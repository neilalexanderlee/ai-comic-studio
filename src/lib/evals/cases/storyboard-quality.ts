/**
 * Eval suite: Storyboard Quality
 *
 * 用 LLM-as-judge 评估分镜字段的结构化质量。不测试 LLM 生成内容，
 * 而是测试「已生成内容的字段格式是否符合规范」。
 *
 * 涵盖：
 * 1. startFrameDesc 五要素完整性（机位空间坐标为第一要素）
 * 2. cameraDirection 叙事目的格式（起幅→运动→落幅，含目的：xxx）
 * 3. 禁用模板词检测（deterministic，无需 API）
 * 4. motionScript bracket 格式展开产出质量（prose 模式）
 *
 * 运行：
 *   pnpm eval -- --suite storyboard
 */

import type { EvalSuite } from "../runner";
import { llmJudge, assertNotContains } from "../runner";
import { expandMotionScriptBrackets } from "@/lib/ai/prompts/ref-video-prompt-generate";
import {
  FRAME_DESC_FIVE_ELEMENTS_VALID,
  FRAME_DESC_MISSING_CAMERA_POSITION,
  CAMERA_DIRECTION_WITH_PURPOSE,
  CAMERA_DIRECTION_NO_PURPOSE,
  MOTION_SCRIPT_BRACKET_MULTI,
  MOTION_SCRIPT_BRACKET_SINGLE,
} from "../fixtures/shots";
import type { AIProvider } from "@/lib/ai/types";

// ── Provider loader ───────────────────────────────────────────────────────────

function getTextProvider(): AIProvider {
  const apiKey = process.env.ARK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No API key found. Set ARK_API_KEY or OPENAI_API_KEY to run storyboard quality evals."
    );
  }
  if (process.env.ARK_API_KEY) {
    const { OpenAIProvider } = require("@/lib/ai/providers/openai");
    return new OpenAIProvider({
      apiKey: process.env.ARK_API_KEY,
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      model: process.env.EVAL_TEXT_MODEL || "ep-20250522120922-xxxxx",
    });
  }
  const { OpenAIProvider } = require("@/lib/ai/providers/openai");
  return new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
  });
}

// ── Eval suite ────────────────────────────────────────────────────────────────

export const storyboardQualitySuite: EvalSuite = {
  name: "storyboard-quality",
  description: "分镜字段格式与质量规范验证（五要素 + cameraDirection + 禁用词）",
  cases: [
    // ── 1. startFrameDesc 五要素 — 合规样本 pass ─────────────────────────────

    {
      name: "frame-desc-five-elements-valid",
      aspect: "符合规范的 startFrameDesc 被 LLM judge 认定合规",
      async run() {
        let provider: AIProvider;
        try { provider = getTextProvider(); } catch { return "skip"; }

        const isValid = await llmJudge(
          FRAME_DESC_FIVE_ELEMENTS_VALID,
          [
            "The text explicitly describes the camera's physical position relative to the subject (e.g., 摄影机在[主体][方位][距离])",
            "The text includes a shot size / framing description (远景/全景/中景/近景/特写)",
            "The text includes the character's precise position and static posture",
            "The text includes a detailed lighting description (color + direction + spread effect)",
            "The text ends with an emotional body-anatomy phrase and scene anchor word (e.g., 嘴角绷紧眼眸下垂——书房)",
          ].join("\n"),
          provider
        );

        if (!isValid) {
          throw new Error(
            `Valid startFrameDesc failed LLM quality check.\nSample:\n${FRAME_DESC_FIVE_ELEMENTS_VALID}`
          );
        }
      },
    },

    // ── 2. startFrameDesc 缺少机位坐标 — 应被 judge 拒绝 ──────────────────

    {
      name: "frame-desc-missing-camera-position-detected",
      aspect: "缺少机位空间坐标的 startFrameDesc 被判定不合规",
      async run() {
        let provider: AIProvider;
        try { provider = getTextProvider(); } catch { return "skip"; }

        const isValid = await llmJudge(
          FRAME_DESC_MISSING_CAMERA_POSITION,
          [
            "The text explicitly states the camera's physical position relative to the subject",
            "specifically uses the pattern 摄影机在[subject][direction][distance]",
          ].join("\n"),
          provider
        );

        // We expect judge to say NO (= isValid false) — flip to assert
        if (isValid) {
          throw new Error(
            `REGRESSION: Incomplete startFrameDesc (missing camera position) passed quality check.\n` +
              `Sample: ${FRAME_DESC_MISSING_CAMERA_POSITION}`
          );
        }
        // If judge correctly says NO → test passes (returns void)
      },
    },

    // ── 3. cameraDirection 含叙事目的 — 合规 ────────────────────────────────

    {
      name: "camera-direction-with-purpose-valid",
      aspect: "含「目的：」的 cameraDirection 被 judge 认定合规",
      async run() {
        let provider: AIProvider;
        try { provider = getTextProvider(); } catch { return "skip"; }

        const isValid = await llmJudge(
          CAMERA_DIRECTION_WITH_PURPOSE,
          [
            "The text describes a camera movement with a start position, motion type, and end position",
            "The text explicitly states the narrative purpose of the camera move (目的：...)",
          ].join("\n"),
          provider
        );

        if (!isValid) {
          throw new Error(
            `Valid cameraDirection failed quality check.\nSample: ${CAMERA_DIRECTION_WITH_PURPOSE}`
          );
        }
      },
    },

    // ── 4. cameraDirection 无叙事目的 — 应被拒绝 ────────────────────────────

    {
      name: "camera-direction-no-purpose-detected",
      aspect: "缺少叙事目的的 cameraDirection 被判定不合规",
      async run() {
        let provider: AIProvider;
        try { provider = getTextProvider(); } catch { return "skip"; }

        const isValid = await llmJudge(
          CAMERA_DIRECTION_NO_PURPOSE,
          [
            "The text describes both the camera movement AND its narrative purpose (why this move was chosen)",
            "It specifies start position, motion type, and end position",
          ].join("\n"),
          provider
        );

        if (isValid) {
          throw new Error(
            `REGRESSION: cameraDirection without narrative purpose passed quality check.\n` +
              `Sample: ${CAMERA_DIRECTION_NO_PURPOSE}`
          );
        }
      },
    },

    // ── 5. 禁用模板词检测 — 确定性，无需 API ────────────────────────────────

    {
      name: "banned-template-words-not-in-valid-frame-desc",
      aspect: "合规 startFrameDesc 不含禁用模板词",
      async run() {
        const BANNED = [
          "神情坚定",
          "眼神复杂",
          "角色情绪丰富",
          "说话人面部表情随台词情绪流动",
          "神情专注",
          "情绪丰富",
        ];

        for (const word of BANNED) {
          assertNotContains(
            FRAME_DESC_FIVE_ELEMENTS_VALID,
            word,
            `Valid sample startFrameDesc (should be clean)`
          );
        }
      },
    },

    {
      name: "video-script-no-bgm-description",
      aspect: "videoScript/motionScript 不含 BGM/配乐描述词",
      async run() {
        const BGM_BANNED = ["配乐响起", "悲壮BGM", "弦乐渐强", "背景音乐", "BGM", "配乐"];
        const samples = [MOTION_SCRIPT_BRACKET_MULTI, MOTION_SCRIPT_BRACKET_SINGLE];

        for (const sample of samples) {
          for (const word of BGM_BANNED) {
            assertNotContains(sample, word, "motionScript fixture");
          }
        }
      },
    },

    // ── 6. motionScript bracket 展开产出质量 ────────────────────────────────

    {
      name: "bracket-prose-output-quality",
      aspect: "bracket motionScript 展开 prose 后可作视频提示词",
      async run() {
        let provider: AIProvider;
        try { provider = getTextProvider(); } catch { return "skip"; }

        const prose = expandMotionScriptBrackets(MOTION_SCRIPT_BRACKET_MULTI, { prose: true });

        // Deterministic checks first
        if (!prose || prose.trim().length < 10) {
          throw new Error(`expandMotionScriptBrackets returned empty/too-short result: "${prose}"`);
        }
        if (prose.includes("[") || prose.includes("]")) {
          throw new Error(`prose output still contains bracket characters: "${prose}"`);
        }
        if (/\d+-\d+s/.test(prose)) {
          throw new Error(`prose output still contains time codes: "${prose}"`);
        }

        // LLM judge: is this suitable as a video generation action description?
        const isGood = await llmJudge(
          prose,
          [
            "The text describes character actions in natural prose (no time codes like 0-3s)",
            "The text does not contain square brackets [ ]",
            "Multiple characters' actions are described in a logical sequence",
            "The text is suitable as an action description for video generation",
          ].join("\n"),
          provider
        );

        if (!isGood) {
          throw new Error(
            `LLM judge rated bracket→prose expansion as unsuitable for video generation.\n` +
              `Input: ${MOTION_SCRIPT_BRACKET_MULTI}\nProse: ${prose}`
          );
        }
      },
    },

    // ── 7. bracket 展开不变更叙事顺序 — 确定性 ─────────────────────────────

    {
      name: "bracket-prose-preserves-order",
      aspect: "prose 展开保持 bracket 中定义的叙事先后顺序",
      async run() {
        // MOTION_SCRIPT_BRACKET_MULTI: 角色甲先转身，角色丁后嘴唇微颤，最后角色甲推开门
        const prose = expandMotionScriptBrackets(MOTION_SCRIPT_BRACKET_MULTI, { prose: true });

        // 角色甲的动作（转身/迈步）必须在角色丁之前
        const posA1 = prose.indexOf("角色甲");
        const posD = prose.indexOf("角色丁");
        const posA2 = prose.lastIndexOf("角色甲");

        if (posA1 === -1 || posD === -1) {
          throw new Error(`Expected both 角色甲 and 角色丁 in prose output. Got: "${prose}"`);
        }
        if (posA1 >= posD) {
          throw new Error(
            `Order violation: 角色甲 (pos ${posA1}) should appear before 角色丁 (pos ${posD}).\nProse: "${prose}"`
          );
        }
        // 最后一次出现的角色甲（推开门）应在角色丁之后
        if (posA2 <= posD) {
          throw new Error(
            `Order violation: last 角色甲 action (pos ${posA2}) should appear after 角色丁 (pos ${posD}).\nProse: "${prose}"`
          );
        }
      },
    },
  ],
};
