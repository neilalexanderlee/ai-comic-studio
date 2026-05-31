import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANNED_PLOT_TERMS_IN_TEMPLATES,
  PROMPT_TEMPLATE_SOURCE_FILES,
} from "@/lib/ai/prompts/prompt-template-standards";

const PROMPTS_DIR = join(process.cwd(), "src/lib/ai/prompts");

describe("prompt templates de-plot (defaults + registry)", () => {
  for (const file of PROMPT_TEMPLATE_SOURCE_FILES) {
    it(`${file} contains no banned plot-specific terms`, () => {
      const text = readFileSync(join(PROMPTS_DIR, file), "utf8");
      const hits: string[] = [];
      for (const term of BANNED_PLOT_TERMS_IN_TEMPLATES) {
        if (text.includes(term)) hits.push(term);
      }
      expect(hits, `Found in ${file}: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
