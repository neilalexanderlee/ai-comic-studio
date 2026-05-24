/**
 * Eval suite: Character Routing
 *
 * Tests that filterShotCharacters correctly identifies which characters
 * appear in a given shot, and critically, that crowd/extras scenes
 * receive an empty character list (not all characters).
 *
 * These are deterministic tests — no AI calls required.
 */

import type { EvalSuite } from "../runner";
import { assertNotContains } from "../runner";
import {
  ALL_CHARACTERS,
  SHOT_WITH_NAMED_CHARACTERS,
  SHOT_CROWD_SCENE,
  SHOT_PURE_ACTION,
  SHOT_SINGLE_CHARACTER,
  CHARACTERS,
} from "../fixtures/shots";
import { filterShotCharacters } from "@/lib/storyboard/filter-shot-characters";

// ── Eval suite ────────────────────────────────────────────────────────────────

export const characterRoutingSuite: EvalSuite = {
  name: "character-routing",
  description: "filterShotCharacters 角色过滤行为验证",
  cases: [
    {
      name: "named-characters-detected",
      aspect: "正确识别镜头中明确出现的角色",
      async run() {
        const shotText = [
          SHOT_WITH_NAMED_CHARACTERS.prompt,
          SHOT_WITH_NAMED_CHARACTERS.startFrameDesc,
        ].join(" ");
        const result = filterShotCharacters(shotText, ALL_CHARACTERS);
        const names = result.map((c) => c.name);

        if (!names.includes("龙渊")) {
          throw new Error(`Expected 龙渊 to be detected. Got: ${names.join(", ")}`);
        }
        // 云烟（少女形态）应该通过 base name "云烟" 匹配
        if (!names.some((n) => n.startsWith("云烟"))) {
          throw new Error(`Expected 云烟 to be detected (via base name). Got: ${names.join(", ")}`);
        }
      },
    },

    {
      name: "crowd-scene-returns-empty",
      aspect: "群演场景必须返回空列表——CRITICAL",
      async run() {
        const shotText = [
          SHOT_CROWD_SCENE.prompt,
          SHOT_CROWD_SCENE.startFrameDesc,
          SHOT_CROWD_SCENE.videoScript,
        ]
          .filter(Boolean)
          .join(" ");

        const result = filterShotCharacters(shotText, ALL_CHARACTERS);

        if (result.length !== 0) {
          throw new Error(
            `Crowd scene should return empty array. Got ${result.length} characters: ${result.map((c) => c.name).join(", ")}\n` +
              `This would inject ${result.length * 14} reference images into an extras shot.`
          );
        }
      },
    },

    {
      name: "pure-action-shot-returns-empty",
      aspect: "纯动作/环境镜头（无角色名）返回空列表",
      async run() {
        const shotText = [SHOT_PURE_ACTION.prompt, SHOT_PURE_ACTION.videoScript].join(" ");
        const result = filterShotCharacters(shotText, ALL_CHARACTERS);
        if (result.length !== 0) {
          throw new Error(
            `Pure action shot should have no character refs. Got: ${result.map((c) => c.name).join(", ")}`
          );
        }
      },
    },

    {
      name: "single-character-matched",
      aspect: "单角色镜头只返回该角色",
      async run() {
        const shotText = [
          SHOT_SINGLE_CHARACTER.prompt,
          SHOT_SINGLE_CHARACTER.videoScript,
        ].join(" ");
        const result = filterShotCharacters(shotText, ALL_CHARACTERS);
        const names = result.map((c) => c.name);

        if (!names.includes("林峰")) {
          throw new Error(`Expected 林峰 to be detected. Got: ${names.join(", ")}`);
        }
        if (names.includes("龙渊") || names.some((n) => n.startsWith("云烟"))) {
          throw new Error(
            `Single-character shot should only contain 林峰, not others. Got: ${names.join(", ")}`
          );
        }
      },
    },

    {
      name: "base-name-matching",
      aspect: "带括号后缀的角色名通过 base name 匹配",
      async run() {
        // "云烟（少女形态）" should match when text contains just "云烟"
        const shotText = "云烟缓步走出竹林，神情漠然";
        const result = filterShotCharacters(shotText, [CHARACTERS.yunYan]);
        if (result.length !== 1) {
          throw new Error(
            `Expected 云烟（少女形态）to match via base name "云烟". Got ${result.length} matches.`
          );
        }
      },
    },

    {
      name: "empty-shot-text",
      aspect: "空文本不崩溃，返回空列表",
      async run() {
        const result = filterShotCharacters("", ALL_CHARACTERS);
        if (result.length !== 0) {
          throw new Error(`Empty shot text should return []. Got ${result.length} chars.`);
        }
      },
    },

    {
      name: "no-fallback-to-all-characters",
      aspect: "无匹配时绝不 fallback 到全量角色（防回归）",
      async run() {
        // This test documents the specific bug that was fixed.
        // Before the fix: shotCharacters.length > 0 ? shotCharacters : projectCharacters
        // After the fix: always use shotCharacters (may be empty)
        const irrelevantText = "镜头扫过空旷的战场废墟，硝烟弥漫";
        const matched = filterShotCharacters(irrelevantText, ALL_CHARACTERS);

        if (matched.length === ALL_CHARACTERS.length) {
          throw new Error(
            "REGRESSION: filterShotCharacters returned all characters for an irrelevant shot. " +
              "This was the bug where crowd scenes received every character's reference image."
          );
        }
        // Expect 0 matches for this irrelevant text
        if (matched.length !== 0) {
          throw new Error(
            `Expected 0 matches for irrelevant text. Got: ${matched.map((c) => c.name).join(", ")}`
          );
        }
      },
    },
  ],
};
