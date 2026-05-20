/**
 * AI Eval Runner
 *
 * A lightweight framework for evaluating AI generation quality in AIComicBuilder.
 * Runs eval cases against real AI providers and scores outputs using rubrics
 * or LLM-as-judge.
 *
 * Usage:
 *   pnpm eval                  # runs all eval suites
 *   pnpm eval --suite prompt   # runs only prompt-enhancement suite
 *   pnpm eval --suite char     # runs only character-routing suite
 *
 * Requires real API keys in environment. Set:
 *   OPENAI_API_KEY or ARK_API_KEY etc.
 */

export type EvalVerdict = "pass" | "fail" | "skip";

export interface EvalCase {
  /** Human-readable name, shown in output */
  name: string;
  /** What property/behaviour this case checks */
  aspect: string;
  /** Run the case. Throw or return "fail" to indicate failure. */
  run(): Promise<EvalVerdict | void>;
}

export interface EvalSuite {
  name: string;
  description: string;
  cases: EvalCase[];
}

export interface EvalResult {
  suite: string;
  case: string;
  aspect: string;
  verdict: EvalVerdict;
  durationMs: number;
  error?: string;
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runSuite(suite: EvalSuite): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  console.log(`\n▶ Suite: ${suite.name} — ${suite.description}`);

  for (const evalCase of suite.cases) {
    const start = Date.now();
    let verdict: EvalVerdict = "pass";
    let error: string | undefined;

    try {
      const returned = await evalCase.run();
      if (returned === "fail") verdict = "fail";
      else if (returned === "skip") verdict = "skip";
    } catch (err) {
      verdict = "fail";
      error = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - start;
    const icon = verdict === "pass" ? "✅" : verdict === "skip" ? "⏭" : "❌";
    console.log(
      `  ${icon} [${verdict.toUpperCase()}] ${evalCase.name} (${durationMs}ms)${
        error ? `\n     Error: ${error}` : ""
      }`
    );

    results.push({
      suite: suite.name,
      case: evalCase.name,
      aspect: evalCase.aspect,
      verdict,
      durationMs,
      error,
    });
  }

  const passed = results.filter((r) => r.verdict === "pass").length;
  const failed = results.filter((r) => r.verdict === "fail").length;
  const skipped = results.filter((r) => r.verdict === "skip").length;
  console.log(`\n  Summary: ${passed} passed / ${failed} failed / ${skipped} skipped\n`);

  return results;
}

export async function runAllSuites(suites: EvalSuite[]): Promise<void> {
  const allResults: EvalResult[] = [];

  for (const suite of suites) {
    const results = await runSuite(suite);
    allResults.push(...results);
  }

  const total = allResults.length;
  const passed = allResults.filter((r) => r.verdict === "pass").length;
  const failed = allResults.filter((r) => r.verdict === "fail").length;

  console.log("═".repeat(60));
  console.log(`EVAL TOTAL: ${passed}/${total} passed, ${failed} failed`);
  console.log("═".repeat(60));

  if (failed > 0) {
    console.log("\nFailed cases:");
    allResults
      .filter((r) => r.verdict === "fail")
      .forEach((r) => {
        console.log(`  • [${r.suite}] ${r.case}: ${r.error ?? "assertion failed"}`);
      });
    process.exit(1);
  }
}

// ── LLM-as-judge helper ───────────────────────────────────────────────────────

/**
 * Ask a judge LLM to evaluate whether `output` satisfies `criteria`.
 * Returns true if the judge agrees.
 *
 * Requires a real text provider.
 */
export async function llmJudge(
  output: string,
  criteria: string,
  judgeProvider: { generateText(p: string, o?: object): Promise<string> }
): Promise<boolean> {
  const prompt = `
You are a strict quality evaluator. Given the OUTPUT below, determine if it satisfies the CRITERIA.
Reply with exactly one word: YES or NO.

CRITERIA:
${criteria}

OUTPUT:
${output}
`.trim();

  const verdict = await judgeProvider.generateText(prompt, {
    temperature: 0,
    maxTokens: 5,
  });
  return verdict.trim().toUpperCase().startsWith("YES");
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

export function assertContains(text: string, substring: string, label?: string): void {
  if (!text.includes(substring)) {
    throw new Error(
      `${label ?? "Output"} does not contain expected substring: "${substring}"\nActual: ${text.slice(0, 200)}`
    );
  }
}

export function assertNotContains(text: string, substring: string, label?: string): void {
  if (text.includes(substring)) {
    throw new Error(
      `${label ?? "Output"} unexpectedly contains: "${substring}"`
    );
  }
}

export function assertMinLength(text: string, minChars: number): void {
  if (text.trim().length < minChars) {
    throw new Error(
      `Output too short: ${text.trim().length} chars (expected ≥ ${minChars})`
    );
  }
}
