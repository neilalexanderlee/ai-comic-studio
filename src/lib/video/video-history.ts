/**
 * video-history.ts
 *
 * 工具函数：保存分镜视频历史、裁剪旧历史（超 MAX_HISTORY 时删文件+记录）。
 * 在每次覆盖 shot.videoUrl 之前调用 saveVideoToHistory()，
 * 实现"旧文件不孤立 + 最多保留 5 个版本"两个目标。
 */

import fs from "fs";
import { db } from "@/lib/db";
import { shotVideoHistory } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { ulid } from "ulid";

const MAX_HISTORY = 5;

function tryDeleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore — file may already be gone
  }
}

/**
 * 在覆盖 shot.videoUrl 之前调用此函数。
 * 1. 把当前 videoUrl 写入 shot_video_history。
 * 2. 若历史条数超过 MAX_HISTORY，删除最旧的记录和对应文件。
 *
 * @param shotId      shot 的 ID
 * @param videoUrl    即将被覆盖的旧视频路径（可能为 null/undefined，直接跳过）
 * @param resolution  旧视频的分辨率
 * @param label       描述标签，如 "生成" / "增强↑720p"
 */
export async function saveVideoToHistory(
  shotId: string,
  videoUrl: string | null | undefined,
  resolution: string | null | undefined,
  label: string = "生成"
) {
  if (!videoUrl) return; // 没有旧视频，无需保存

  // 1. 插入历史记录
  await db.insert(shotVideoHistory).values({
    id: ulid(),
    shotId,
    videoUrl,
    resolution: resolution ?? null,
    label,
    createdAt: Date.now(),
  });

  // 2. 裁剪超出 MAX_HISTORY 的最旧记录
  const all = await db
    .select({ id: shotVideoHistory.id, videoUrl: shotVideoHistory.videoUrl })
    .from(shotVideoHistory)
    .where(eq(shotVideoHistory.shotId, shotId))
    .orderBy(asc(shotVideoHistory.createdAt));

  if (all.length > MAX_HISTORY) {
    const toRemove = all.slice(0, all.length - MAX_HISTORY);
    for (const row of toRemove) {
      tryDeleteFile(row.videoUrl);
      await db.delete(shotVideoHistory).where(eq(shotVideoHistory.id, row.id));
    }
  }
}

/**
 * 获取某个分镜的视频历史列表（最新在前）。
 */
export async function getVideoHistory(shotId: string) {
  const rows = await db
    .select()
    .from(shotVideoHistory)
    .where(eq(shotVideoHistory.shotId, shotId))
    .orderBy(asc(shotVideoHistory.createdAt));

  // 最新的排在前面
  return rows.reverse();
}

/**
 * 从历史中删除一条记录（同时删除对应文件）。
 */
export async function deleteHistoryEntry(historyId: string) {
  const [row] = await db
    .select({ videoUrl: shotVideoHistory.videoUrl })
    .from(shotVideoHistory)
    .where(eq(shotVideoHistory.id, historyId));
  if (row) tryDeleteFile(row.videoUrl);
  await db.delete(shotVideoHistory).where(eq(shotVideoHistory.id, historyId));
}
