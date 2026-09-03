import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { FrameReferencePayload, FrameReferenceType } from "./frame-reference";
import { frameReferenceTypeLabel } from "./frame-reference";

/**
 * 这个帧引用是否可用（可以拿去参与生成）。
 *
 * ⚠️ 曾经叫 `shotFrameUsable`，实现就是 `fs.existsSync(path.resolve(ref))`。
 * 产物迁到 OSS 之后，`oss://frames/x.png` 会被 `path.resolve` 拧成
 * `<cwd>/oss:/frames/x.png`，`existsSync` 恒为 false —— 于是**每一个参考图都被
 * 静默判成"文件不存在"并悄悄丢弃**：角色定妆图锁不住外貌、分镜首帧进不了构图参考、
 * 道具图完全失效，而界面上没有任何提示，只表现为"效果突然变差"。
 *
 * 所以这里的语义必须是"引用可用"，而不是"本地磁盘上有这个文件"：
 *  - `oss://` / `asset://` / http(s)：DB 里的引用即事实，判为可用。
 *    真正的悬空引用会在 provider 那一步显式报错，那比静默丢弃好排查得多。
 *  - 本地路径：仍然查磁盘（自部署、未配置 OSS 的情况）。
 *
 * 保持同步函数：它在生成路径上被高频调用（每个角色、每个道具各一次），
 * 改成异步的 `artifactExists` 会给每次调用加一个网络 HEAD。
 */
export function shotFrameUsable(framePath: string | null | undefined): boolean {
  if (!framePath) return false;
  if (
    framePath.startsWith("oss://") ||
    framePath.startsWith("asset://") ||
    framePath.startsWith("http://") ||
    framePath.startsWith("https://")
  ) {
    return true;
  }
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
  return shotFrameUsable(candidate) ? candidate! : undefined;
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
