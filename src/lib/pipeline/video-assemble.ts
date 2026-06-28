import { db } from "@/lib/db";
import { shots, projects } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { assembleVideo } from "@/lib/video/ffmpeg";
import type { Task } from "@/lib/task-queue";
import { extractDialoguesFromMotionScript } from "@/lib/storyboard/extract-dialogues-from-motion-script";

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

  // Get dialogues for subtitles (from motionScript brackets, no DB query needed)
  const allDialogues: Array<{ text: string; characterName: string; sequence: number; shotSequence: number }> = [];
  for (const shot of projectShots) {
    for (const d of extractDialoguesFromMotionScript(shot.motionScript ?? "")) {
      allDialogues.push({ text: d.text, characterName: d.characterName, sequence: d.sequence, shotSequence: shot.sequence ?? 0 });
    }
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
