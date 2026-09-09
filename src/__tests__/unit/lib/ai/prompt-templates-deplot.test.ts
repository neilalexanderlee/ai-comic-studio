import { join, relative } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  BANNED_PLOT_TERMS_IN_TEMPLATES,
  PROMPT_TEMPLATE_SOURCE_FILES,
  REPO_DEPLOT_EXCLUDE_RELATIVE,
} from "@/lib/ai/prompts/prompt-template-standards";

const ROOT = process.cwd();
const PROMPTS_DIR = join(ROOT, "src/lib/ai/prompts");

let readFileSync: typeof import("node:fs").readFileSync;
let readdirSync: typeof import("node:fs").readdirSync;
let statSync: typeof import("node:fs").statSync;
let existsSync: typeof import("node:fs").existsSync;

beforeAll(async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  readFileSync = fs.readFileSync;
  readdirSync = fs.readdirSync;
  statSync = fs.statSync;
  existsSync = fs.existsSync;
});

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, acc);
    } else if (/\.(ts|tsx|md)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function repoScanFiles(): string[] {
  const files: string[] = [];
  for (const top of ["src", "docs"]) {
    // ⚠️ `docs/` 在 .gitignore 里 —— **全新克隆的仓库里它根本不存在**，
    // 无条件 readdirSync 会直接 ENOENT，于是别人 clone 下来第一次跑测试就是红的。
    // 这类「只在本机存在的目录」必须判存在，否则本地永远绿、别人永远红。
    const dir = join(ROOT, top);
    if (!existsSync(dir)) continue;
    walkFiles(dir, files);
  }
  const exclude = new Set<string>(REPO_DEPLOT_EXCLUDE_RELATIVE);
  return files
    .map((f) => relative(ROOT, f))
    .filter((rel) => !exclude.has(rel));
}

function bannedHits(text: string): string[] {
  return BANNED_PLOT_TERMS_IN_TEMPLATES.filter((term) => text.includes(term));
}

describe("prompt templates de-plot (defaults + registry)", () => {
  for (const file of PROMPT_TEMPLATE_SOURCE_FILES) {
    it(`${file} contains no banned plot-specific terms`, () => {
      const text = readFileSync(join(PROMPTS_DIR, file), "utf8");
      const hits = bannedHits(text);
      expect(hits, `Found in ${file}: ${hits.join(", ")}`).toEqual([]);
    });
  }
});

describe("repo de-plot (src + docs, excluding standards & user scripts)", () => {
  it("no banned plot-specific terms in scanned files", () => {
    const violations: string[] = [];
    for (const rel of repoScanFiles()) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      const hits = bannedHits(text);
      if (hits.length > 0) {
        violations.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
