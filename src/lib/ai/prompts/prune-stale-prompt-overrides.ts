import { db } from "@/lib/db";
import { promptTemplates } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getPromptDefinition } from "./registry";

/** Registry keys removed in 2026-05 Reference 双轨清理 */
export const REMOVED_PROMPT_KEYS = new Set([
  "scene_frame_generate",
  "ref_video_generate",
  "shot_complete",
]);

/**
 * Rewired to resolvePrompt + new slot layout — one-time reset clears stale Chinese/legacy slots.
 */
export const RESET_WIRED_PROMPT_KEYS = new Set([
  "ref_video_prompt",
  "character_extract",
  "import_character_extract",
  "outline_expand",
  "single_shot_rewrite",
]);

export type PromptTemplateRow = {
  id: string;
  promptKey: string;
  slotKey: string | null;
};

/**
 * Pure: which template row IDs should be deleted.
 * @param resetWired When true, drop ALL overrides for RESET_WIRED_PROMPT_KEYS (migration-equivalent).
 */
export function collectStalePromptTemplateIds(
  rows: PromptTemplateRow[],
  options?: { resetWired?: boolean }
): string[] {
  const resetWired = options?.resetWired ?? false;
  const toDelete: string[] = [];

  for (const row of rows) {
    if (REMOVED_PROMPT_KEYS.has(row.promptKey)) {
      toDelete.push(row.id);
      continue;
    }
    if (resetWired && RESET_WIRED_PROMPT_KEYS.has(row.promptKey)) {
      toDelete.push(row.id);
      continue;
    }
    const def = getPromptDefinition(row.promptKey);
    if (!def) {
      toDelete.push(row.id);
      continue;
    }
    if (row.slotKey == null) continue;
    const valid = new Set(def.slots.map((s) => s.key));
    if (!valid.has(row.slotKey)) {
      toDelete.push(row.id);
    }
  }

  return toDelete;
}

export type PruneStalePromptOverridesResult = {
  deleted: number;
  removedKeys: string[];
  orphanSlots: Array<{ promptKey: string; slotKey: string }>;
};

/**
 * Delete stale prompt_templates rows (orphan slots + unknown keys).
 * Does NOT wipe RESET_WIRED_PROMPT_KEYS unless `resetWired: true` (use migration / manual script).
 */
export async function pruneStalePromptOverrides(options?: {
  resetWired?: boolean;
}): Promise<PruneStalePromptOverridesResult> {
  const rows = await db
    .select({
      id: promptTemplates.id,
      promptKey: promptTemplates.promptKey,
      slotKey: promptTemplates.slotKey,
    })
    .from(promptTemplates);

  const ids = collectStalePromptTemplateIds(rows, options);
  const removedKeys = new Set<string>();
  const orphanSlots: Array<{ promptKey: string; slotKey: string }> = [];

  for (const row of rows) {
    if (!ids.includes(row.id)) continue;
    if (REMOVED_PROMPT_KEYS.has(row.promptKey)) {
      removedKeys.add(row.promptKey);
    } else if (row.slotKey) {
      orphanSlots.push({ promptKey: row.promptKey, slotKey: row.slotKey });
    }
  }

  if (ids.length > 0) {
    await db.delete(promptTemplates).where(inArray(promptTemplates.id, ids));
  }

  return {
    deleted: ids.length,
    removedKeys: [...removedKeys],
    orphanSlots,
  };
}
