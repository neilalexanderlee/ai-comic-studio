/**
 * Eval entrypoint
 *
 * Run with:  pnpm eval
 * Or:        npx tsx src/lib/evals/index.ts
 *
 * Flags:
 *   --suite char     only character-routing suite
 *   --suite prompt   only prompt-enhancement suite
 */

import { runAllSuites, runSuite } from "./runner";
import { characterRoutingSuite } from "./cases/character-routing";
import { promptEnhancementSuite } from "./cases/prompt-enhancement";

const args = process.argv.slice(2);
const suiteFlag = args.indexOf("--suite");
const selectedSuite = suiteFlag !== -1 ? args[suiteFlag + 1] : null;

const allSuites = [characterRoutingSuite, promptEnhancementSuite];

async function main() {
  console.log("AI漫剧工坊 — AI Eval Runner");
  console.log("================================\n");

  if (selectedSuite) {
    const suite = allSuites.find((s) => s.name.startsWith(selectedSuite));
    if (!suite) {
      console.error(`Unknown suite: "${selectedSuite}". Available: ${allSuites.map((s) => s.name).join(", ")}`);
      process.exit(1);
    }
    await runSuite(suite);
  } else {
    await runAllSuites(allSuites);
  }
}

main().catch((err) => {
  console.error("Eval runner crashed:", err);
  process.exit(1);
});
