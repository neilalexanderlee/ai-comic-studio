import { db } from "@/lib/db";
import { shots, projects, dialogues, characters } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { assembleVideo } from "@/lib/video/ffmpeg";
import type { Task } from "@/lib/task-queue";

export async function handleVideoAssemble(task: Task) {
  const payload = task.payload as { projectId: string };

  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, payload.projectId))
    .orderBy(asc(shots.sequence));

  const videoPaths = projectShots
    .map((s) => s.videoUrl)
    .filter(Boolean) as string[];

  if (videoPaths.length === 0) {
    throw new Error("No video clips to assemble");
  }

  // Get dialogues for subtitles
  const allDialogues = [];
  for (const shot of projectShots) {
    const shotDialogues = await db
      .select({
        text: dialogues.text,
        characterName: characters.name,
        sequence: dialogues.sequence,
        shotSequence: shots.sequence,
      })
      .from(dialogues)
      .innerJoin(characters, eq(dialogues.characterId, characters.id))
      .innerJoin(shots, eq(dialogues.shotId, shots.id))
      .where(eq(dialogues.shotId, shot.id))
      .orderBy(asc(dialogues.sequence));
    allDialogues.push(...shotDialogues);
  }

  const outputPath = await assembleVideo({
    videoPaths,
    subtitles: allDialogues.map((d) => ({
      text: `${d.characterName}: ${d.text}`,
      shotSequence: d.shotSequence,
    })),
    projectId: payload.projectId,
    shotDurations: projectShots.map((s) => s.duration ?? 10),
  });

  await db
    .update(projects)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(projects.id, payload.projectId));

  return { outputPath };
}
