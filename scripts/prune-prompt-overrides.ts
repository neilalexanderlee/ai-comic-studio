/**
 * One-shot: reset rewired prompt overrides + prune orphan slots.
 * Usage: pnpm prune-prompt-overrides
 */
import { runMigrations } from "../src/lib/db";
import { pruneStalePromptOverrides } from "../src/lib/ai/prompts/prune-stale-prompt-overrides";

async function main() {
  runMigrations();
  const wired = await pruneStalePromptOverrides({ resetWired: true });
  const orphans = await pruneStalePromptOverrides({ resetWired: false });

  console.log("[prune-prompt-overrides] reset wired prompts:", wired.deleted, "rows");
  if (wired.removedKeys.length) {
    console.log("  removed registry keys:", wired.removedKeys.join(", "));
  }
  if (wired.orphanSlots.length) {
    console.log(
      "  orphan slots:",
      wired.orphanSlots.map((o) => `${o.promptKey}.${o.slotKey}`).join(", ")
    );
  }
  console.log("[prune-prompt-overrides] ongoing orphan pass:", orphans.deleted, "rows");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
