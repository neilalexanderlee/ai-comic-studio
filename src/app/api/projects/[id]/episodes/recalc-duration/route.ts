/**
 * POST /api/projects/[id]/episodes/recalc-duration
 *
 * Re-reads the project's global script, extracts per-episode duration rules,
 * and updates targetDurationSeconds for every episode in the project.
 *
 * The global script header typically contains lines like:
 *   "单集时长:常规集 4 分 30 秒；特殊集：第17/28/29集 5 分钟；第30集 3 分钟"
 *
 * Body: {} (no body required)
 * Response: { updated: number, details: Array<{ seq, title, targetDurationSeconds }> }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { parseTargetDurationSeconds } from "@/lib/utils/parse-duration";

/**
 * Parse duration override rules from a global script header.
 * Returns a map of { episodeSequence → durationSeconds }.
 *
 * Handles patterns like:
 *   "第17/28/29集 5 分钟"  → sequences [17, 28, 29] → 300s
 *   "第30集 3 分钟"        → sequence [30] → 180s
 *   "常规集 4 分 30 秒"    → default → 270s
 */
function parseGlobalDurationRules(script: string): {
  defaultSeconds: number | null;
  overrides: Map<number, number>;
} {
  const overrides = new Map<number, number>();
  let defaultSeconds: number | null = null;

  // Find the "单集时长" line
  const durationLineMatch = script.match(
    /单集时长[：:]\s*(.+?)(?:\n|$)/
  );
  if (!durationLineMatch) {
    return { defaultSeconds, overrides };
  }

  const durationLine = durationLineMatch[1];

  // Split on Chinese sentence-end chars to get individual clauses
  const clauses = durationLine.split(/[；;，,]/);

  for (const clause of clauses) {
    const trimmed = clause.trim();
    if (!trimmed) continue;

    // Try to find episode number references like "第17/28/29集" or "第30集"
    const epNums = trimmed.match(/第\s*([\d\/]+)\s*集/);
    const durationSecs = parseTargetDurationSeconds(trimmed);

    if (!durationSecs) continue;

    if (epNums) {
      // Parse slash-separated episode numbers
      const seqs = epNums[1].split("/").map((s) => parseInt(s.trim())).filter(
        (n) => !isNaN(n) && n > 0
      );
      for (const seq of seqs) {
        overrides.set(seq, durationSecs);
      }
    } else if (trimmed.includes("常规") || trimmed.includes("默认") || trimmed.includes("普通")) {
      defaultSeconds = durationSecs;
    } else if (!defaultSeconds) {
      // First duration without episode spec → treat as default
      defaultSeconds = durationSecs;
    }
  }

  return { defaultSeconds, overrides };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(req);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const globalScript = project.script?.trim() ?? "";
  const { defaultSeconds, overrides } = parseGlobalDurationRules(globalScript);

  if (!defaultSeconds && overrides.size === 0) {
    return NextResponse.json(
      { error: "在项目全局剧本中未能找到「单集时长」规则，请检查剧本头部是否包含该字段" },
      { status: 422 }
    );
  }

  // Load all episodes for this project
  const allEpisodes = await db
    .select({ id: episodes.id, sequence: episodes.sequence, title: episodes.title })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));

  const details: Array<{ seq: number; title: string; targetDurationSeconds: number }> = [];
  let updated = 0;

  for (const ep of allEpisodes) {
    const target = overrides.get(ep.sequence) ?? defaultSeconds;
    if (!target) continue;

    await db
      .update(episodes)
      .set({ targetDurationSeconds: target })
      .where(eq(episodes.id, ep.id));

    details.push({ seq: ep.sequence, title: ep.title, targetDurationSeconds: target });
    updated++;
  }

  return NextResponse.json({ updated, details });
}
