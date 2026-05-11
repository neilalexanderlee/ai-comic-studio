/**
 * POST /api/projects/[id]/import/storyboard
 *
 * Batch-extracts shots from the script of each given episode and persists
 * them as the initial storyboard version. Used as Step 5 of the auto-pipeline
 * so the user doesn't have to manually trigger shot_split for every episode.
 *
 * Body: { episodeIds: string[] }
 * Returns: { results: Array<{ episodeId, shots, mode, warnings }> }
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { episodes, projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import { extractShotsFromScript } from "@/lib/storyboard/extract-shot-script";
import { finalizeExtractedShotsForDb } from "@/lib/storyboard/complete-extracted-shots";
import {
  persistStoryboardVersion,
  getShotCharacters,
} from "@/lib/storyboard/persist-storyboard-version";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as { episodeIds: string[] };
  const { episodeIds } = body;

  if (!episodeIds?.length) {
    return NextResponse.json({ error: "No episodeIds provided" }, { status: 400 });
  }

  await addImportLog(
    projectId,
    5,
    "running",
    `开始批量生成分镜，共 ${episodeIds.length} 集`
  );

  const results: Array<{
    episodeId: string;
    shots: number;
    mode: string;
    warnings: string[];
    error?: string;
  }> = [];

  for (let i = 0; i < episodeIds.length; i++) {
    const episodeId = episodeIds[i];

    try {
      const [episode] = await db
        .select()
        .from(episodes)
        .where(eq(episodes.id, episodeId));

      if (!episode) {
        results.push({ episodeId, shots: 0, mode: "error", warnings: [], error: "Episode not found" });
        continue;
      }

      const script = episode.script?.trim() ?? "";
      if (!script) {
        results.push({ episodeId, shots: 0, mode: "skipped", warnings: ["Empty script"], error: undefined });
        continue;
      }

      await addImportLog(
        projectId,
        5,
        "running",
        `[${i + 1}/${episodeIds.length}] 正在解析第 ${episode.sequence} 集：${episode.title}`
      );

      const extracted = extractShotsFromScript(script);

      if (!extracted.detection.matched || extracted.shots.length === 0) {
        results.push({
          episodeId,
          shots: 0,
          mode: "no_match",
          warnings: [`Detection score=${extracted.detection.score}, shots=${extracted.shots.length}`],
        });
        await addImportLog(
          projectId,
          5,
          "running",
          `[${i + 1}/${episodeIds.length}] 第 ${episode.sequence} 集未检测到结构化分镜（score=${extracted.detection.score}），跳过`
        );
        continue;
      }

      const persistableShots = finalizeExtractedShotsForDb(extracted.shots);
      const warnings = extracted.warnings.length > 0 ? extracted.warnings : undefined;
      persistableShots.forEach((shot) => { shot.warnings = warnings; });

      const shotCharacters = await getShotCharacters(projectId, episodeId);

      const persisted = await persistStoryboardVersion({
        projectId,
        episodeId,
        shotCharacters,
        shots: persistableShots,
      });

      results.push({
        episodeId,
        shots: persisted.shotCount,
        mode: "extracted",
        warnings: extracted.warnings,
      });

      await addImportLog(
        projectId,
        5,
        "running",
        `[${i + 1}/${episodeIds.length}] 第 ${episode.sequence} 集完成，提取 ${persisted.shotCount} 个分镜`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ episodeId, shots: 0, mode: "error", warnings: [], error: msg });
      await addImportLog(projectId, 5, "running", `[${i + 1}] 出错: ${msg}`);
    }
  }

  const totalShots = results.reduce((s, r) => s + r.shots, 0);
  const successCount = results.filter((r) => r.shots > 0).length;

  await addImportLog(
    projectId,
    5,
    "done",
    `分镜生成完成：${successCount}/${episodeIds.length} 集成功，共 ${totalShots} 个分镜`,
    { totalShots, successCount }
  );

  return NextResponse.json({ results, totalShots, successCount });
}
