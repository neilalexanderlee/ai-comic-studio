/**
 * One-off: run structured shot extraction on a script slice and print stats.
 * Usage: pnpm dlx tsx scripts/extract-shot-stats.ts <path-to-markdown>
 */
import { readFileSync } from "node:fs";
import { extractShotsFromScript } from "../src/lib/storyboard/extract-shot-script";

const path = process.argv[2];
if (!path) {
  console.error("Usage: pnpm dlx tsx scripts/extract-shot-stats.ts <script.md>");
  process.exit(1);
}

const script = readFileSync(path, "utf8");
const { detection, shots, warnings } = extractShotsFromScript(script);

const timecodeBlocks =
  script.match(/\*\*\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*\|/g) ?? [];
const dialogueLines =
  script.split(/\r?\n/).filter((l) => /[「"].*[」"]/.test(l) && /^\s*-\s*/.test(l))
    .length;

let dialogueSlots = 0;
for (const s of shots) {
  dialogueSlots += s.dialogues.length;
}

console.log(JSON.stringify(
  {
    file: path,
    detection: {
      matched: detection.matched,
      score: detection.score,
      reasons: detection.reasons,
    },
    extractedShots: shots.length,
    timecodeBlocksInSource: timecodeBlocks.length,
    timecodesMatchShotCount: timecodeBlocks.length === shots.length,
    dialogueLikeBulletsInSource: dialogueLines,
    dialoguesAttachedToShots: dialogueSlots,
    warnings,
    shotsPreview: shots.slice(0, 5).map((s) => ({
      sequence: s.sequence,
      sceneTitle: s.sceneTitle,
      promptLen: s.prompt.length,
      motionLen: (s.motionScript ?? "").length,
      dialogueCount: s.dialogues.length,
      completeness: s.completeness,
    })),
  },
  null,
  2
));
