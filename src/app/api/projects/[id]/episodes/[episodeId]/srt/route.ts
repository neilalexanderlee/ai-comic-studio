import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, dialogues, characters, storyboardVersions } from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";

/**
 * GET /api/projects/:id/episodes/:episodeId/srt?versionId=xxx
 *
 * 根据 dialogues 表生成 SRT 字幕文件。
 * 时间计算：前序镜头时长累加 = 当前镜头起始时间；同镜多条台词均分镜头时长。
 * 返回：Content-Type text/plain，filename dialogue.srt
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

  // 按顺序取所有分镜
  const projectShots = await db
    .select({
      id: shots.id,
      sequence: shots.sequence,
      duration: shots.duration,
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

  // 取所有台词（按镜头分组）
  type DialogueRow = {
    shotId: string;
    text: string;
    characterName: string;
    sequence: number;
    type: string;
  };

  const allDialogues: DialogueRow[] = await db
    .select({
      shotId: dialogues.shotId,
      text: dialogues.text,
      characterName: characters.name,
      sequence: dialogues.sequence,
      type: dialogues.type,
    })
    .from(dialogues)
    .innerJoin(characters, eq(dialogues.characterId, characters.id))
    .innerJoin(shots, eq(dialogues.shotId, shots.id))
    .where(
      and(
        eq(shots.episodeId, episodeId),
        eq(shots.versionId, versionId)
      )
    )
    .orderBy(asc(shots.sequence), asc(dialogues.sequence));

  if (allDialogues.length === 0) {
    return NextResponse.json({ error: "No dialogues found for this episode" }, { status: 404 });
  }

  // 按 shotId 分组台词
  const dialoguesByShotId = new Map<string, DialogueRow[]>();
  for (const d of allDialogues) {
    if (!dialoguesByShotId.has(d.shotId)) dialoguesByShotId.set(d.shotId, []);
    dialoguesByShotId.get(d.shotId)!.push(d);
  }

  // 构建 SRT
  const srtBlocks: string[] = [];
  let index = 1;
  let offsetSeconds = 0;

  for (const shot of projectShots) {
    const shotDuration = shot.duration ?? 5;
    const shotDialogues = dialoguesByShotId.get(shot.id) ?? [];

    if (shotDialogues.length > 0) {
      // 同一镜头的多条台词均分时长，每条最短 1s
      const slotDuration = Math.max(1, shotDuration / shotDialogues.length);

      shotDialogues.forEach((d, i) => {
        const startSec = offsetSeconds + i * slotDuration;
        const endSec = Math.min(offsetSeconds + shotDuration, startSec + slotDuration);

        // 仅对白显示角色名前缀；OS/VO 加标注
        const typeTag = d.type === "vo" ? "【旁白】" : d.type === "os" ? "【OS】" : "";
        const line = `${typeTag}${d.characterName}：${d.text}`;

        srtBlocks.push(
          `${index}\n${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n${line}`
        );
        index++;
      });
    }

    offsetSeconds += shotDuration;
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
