import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { FrameReferencePayload, FrameReferenceType } from "./frame-reference";
import { frameReferenceTypeLabel } from "./frame-reference";

export function shotFrameFileOnDisk(framePath: string | null | undefined): boolean {
  if (!framePath) return false;
  try {
    return fs.existsSync(path.resolve(framePath));
  } catch {
    return false;
  }
}

export function resolveShotFrameByType(
  shot: {
    anchorFirst?: string | null;
    anchorLastAi?: string | null;
    cutPoint?: string | null;
  },
  frameType: FrameReferenceType
): string | undefined {
  const candidate =
    frameType === "anchor_first"
      ? shot.anchorFirst
      : frameType === "anchor_last_ai"
        ? shot.anchorLastAi
        : shot.cutPoint;
  return shotFrameFileOnDisk(candidate) ? candidate! : undefined;
}

/** 可选参考图解析：优先视频切点，其次 AI 尾帧（仅作参考，不自动写入下一镜）。 */
export function resolveChainFramePath(shot: {
  cutPoint?: string | null;
  anchorLastAi?: string | null;
}): string | undefined {
  return resolveShotFrameByType(shot, "cut_point") ?? resolveShotFrameByType(shot, "anchor_last_ai");
}

/** 解析用户选择的参考帧（同 project；UI 仅暴露本集当前版本，仅校验 projectId + 磁盘文件存在）。 */
export async function resolveFrameReferenceForProject(
  projectId: string,
  ref: FrameReferencePayload
): Promise<{
  path: string;
  shotId: string;
  frameType: FrameReferenceType;
  sourceSequence: number;
} | null> {
  const [sourceShot] = await db
    .select()
    .from(shots)
    .where(and(eq(shots.id, ref.shotId), eq(shots.projectId, projectId)))
    .limit(1);
  if (!sourceShot) return null;
  const path = resolveShotFrameByType(sourceShot, ref.frameType);
  if (!path) return null;
  return {
    path,
    shotId: ref.shotId,
    frameType: ref.frameType,
    sourceSequence: sourceShot.sequence,
  };
}

export function frameReferenceContinuityLabel(
  sourceSequence: number,
  frameType: FrameReferenceType
): string {
  return `镜${sourceSequence}·${frameReferenceTypeLabel(frameType)}`;
}
