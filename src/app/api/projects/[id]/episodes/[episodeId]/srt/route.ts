import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, storyboardVersions } from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { extractDialoguesFromMotionScript } from "@/lib/storyboard/extract-dialogues-from-motion-script";

/**
 * GET /api/projects/:id/episodes/:episodeId/srt?versionId=xxx
 *
 * 从 shots.motionScript bracket 提取台词，生成 SRT 字幕文件。
 * 时间计算：前序镜头时长累加 = 当前镜头起始时间；同镜多条台词按字数加权分配时长。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId, episodeId } = await params;
  const url = new URL(_request.url);
  let versionId = url.searchParams.get("versionId") ?? undefined;

  // 若未指定 versionId，取最新版本
  if (!versionId) {
    const [latest] = await db
      .select({ id: storyboardVersions.id })
      .from(storyboardVersions)
      .where(
        and(
          eq(storyboardVersions.projectId, projectId),
          eq(storyboardVersions.episodeId, episodeId)
        )
      )
      .orderBy(desc(storyboardVersions.versionNum))
      .limit(1);
    versionId = latest?.id;
  }

  if (!versionId) {
    return NextResponse.json({ error: "No storyboard version found" }, { status: 404 });
  }

  // 按顺序取所有分镜（含 motionScript）
  const projectShots = await db
    .select({
      id: shots.id,
      sequence: shots.sequence,
      duration: shots.duration,
      motionScript: shots.motionScript,
    })
    .from(shots)
    .where(
      and(
        eq(shots.projectId, projectId),
        eq(shots.episodeId, episodeId),
        eq(shots.versionId, versionId)
      )
    )
    .orderBy(asc(shots.sequence));

  if (projectShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 404 });
  }

  // 构建 SRT
  const srtBlocks: string[] = [];
  let index = 1;
  let offsetSeconds = 0;
  let totalDialogues = 0;

  for (const shot of projectShots) {
    const shotDuration = shot.duration ?? 5;
    const shotDialogues = extractDialoguesFromMotionScript(shot.motionScript ?? "");

    if (shotDialogues.length > 0) {
      totalDialogues += shotDialogues.length;

      // 按字数加权分配时长，每条最短 1.2s
      const MIN_SUB = 1.2;
      const totalChars = shotDialogues.reduce((s, d) => s + (d.text?.length ?? 1), 0) || 1;
      const rawDurs = shotDialogues.map((d) =>
        Math.max(MIN_SUB, ((d.text?.length ?? 1) / totalChars) * shotDuration)
      );
      const rawTotal = rawDurs.reduce((s, v) => s + v, 0);
      const scale = rawTotal > 0 ? shotDuration / rawTotal : 1;

      let dCursor = offsetSeconds;
      shotDialogues.forEach((d, i) => {
        const dDuration = Math.max(MIN_SUB, rawDurs[i] * scale);
        const capped = Math.min(dDuration, offsetSeconds + shotDuration - dCursor);
        if (capped < 0.3) return;

        const startSec = dCursor;
        const endSec = dCursor + capped;

        const typeTag = d.type === "vo" ? "【旁白】" : d.type === "os" ? "【OS】" : "";
        const line = `${typeTag}${d.characterName}：${d.text}`;

        srtBlocks.push(
          `${index}\n${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n${line}`
        );
        index++;
        dCursor += capped;
      });
    }

    offsetSeconds += shotDuration;
  }

  if (totalDialogues === 0) {
    return NextResponse.json({ error: "No dialogues found for this episode" }, { status: 404 });
  }

  const srtContent = srtBlocks.join("\n\n") + "\n";

  return new NextResponse(srtContent, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="dialogue.srt"`,
    },
  });
}

/** 将秒数格式化为 SRT 时间戳 hh:mm:ss,ms */
function formatSrtTime(totalSeconds: number): string {
  const ms = Math.round((totalSeconds % 1) * 1000);
  const s = Math.floor(totalSeconds) % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function pad3(n: number) {
  return String(n).padStart(3, "0");
}
