import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { shotPreviz, shots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectOwner, requireShotInProject } from "@/lib/api-guard";
import { saveArtifact } from "@/lib/storage/artifact-store";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * 3D 导演台的运镜视频：浏览器逐帧渲染的 JPEG 序列 → 服务端 ffmpeg 拼成 mp4 → 写一条 `shot_previz`。
 *
 * 收帧序列而不是收一段 webm：`canvas.captureStream()` + MediaRecorder 在 WebGL canvas 上
 * 实测一帧都抓不到（只产出 110 字节的空文件）。逐帧渲染换来的是**帧数严格等于 fps × 时长**，
 * 渲染慢只会导出得久一点，不会丢帧或让时长漂移。
 *
 * ## 为什么落进 shot_previz 而不是新开一张表
 *
 * 预演台已经有一整条验证过的链路：`shot_previz` → `shots.previz_selected_id` →
 * `decidePrevizReference` → `@视频N` → Seedance 的 `reference_video`。那条链路
 * **不关心视频是谁生成的**。所以 3D 导演台只是给 shot_previz 增加第二种生产者，
 * 后端零新增 —— 用 `model_id = "local-3d"` 区分来源。
 *
 * 意义：运镜验证从"调一次 Seedance"变成"本地渲染几秒"，每个镜头省一次生成调用。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const shotId = url.searchParams.get("shotId");
  if (!shotId) return NextResponse.json({ error: "Missing shotId" }, { status: 400 });
  const scope = await requireShotInProject(shotId, projectId);
  if (!scope.ok) return scope.response;

  const form = await request.formData();
  const frames = form.getAll("frames") as File[];
  const fps = Math.max(1, Math.min(60, Number(form.get("fps") ?? 24)));
  const duration = Number(form.get("duration") ?? 0);
  if (frames.length === 0) return NextResponse.json({ error: "没有收到任何画面帧" }, { status: 400 });
  const totalBytes = frames.reduce((n, f) => n + f.size, 0);
  if (totalBytes > MAX_BYTES) return NextResponse.json({ error: "帧序列过大" }, { status: 413 });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-previz3d-"));
  const framesDir = path.join(tmpDir, "frames");
  fs.mkdirSync(framesDir);
  const id = ulid();
  const mp4Path = path.join(tmpDir, `${id}.mp4`);
  const posterPath = path.join(tmpDir, `${id}.jpg`);

  try {
    // 客户端已按 00000.jpg 递增命名，但不能指望 FormData 的顺序 —— 按文件名排序落盘
    const sorted = [...frames].sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < sorted.length; i++) {
      fs.writeFileSync(
        path.join(framesDir, `${String(i).padStart(5, "0")}.jpg`),
        Buffer.from(await sorted[i].arrayBuffer())
      );
    }

    await execFileAsync("ffmpeg", [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(framesDir, "%05d.jpg"),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "26",
      "-pix_fmt", "yuv420p",
      // 与预览代理同一条教训：给浏览器实时解码的视频一律禁 B 帧，
      // 否则解码器要缓冲重排帧序，播放会周期性卡顿
      "-bf", "0",
      "-g", "48",
      "-movflags", "+faststart",
      "-r", String(fps),
      "-an",
      mp4Path,
    ]);

    await execFileAsync("ffmpeg", [
      "-y", "-i", mp4Path, "-frames:v", "1", "-vf", "scale=-2:480", "-q:v", "4", posterPath,
    ]);

    const [videoUrl, posterUrl] = await Promise.all([
      saveArtifact(`previz/${id}.mp4`, fs.readFileSync(mp4Path)),
      saveArtifact(`previz/${id}.jpg`, fs.readFileSync(posterPath)),
    ]);

    const previzId = ulid();
    await db.insert(shotPreviz).values({
      id: previzId,
      shotId,
      projectId,
      videoUrl,
      posterUrl,
      prompt: null,
      // 与 Seedance 生成的 take 区分开：来源不同，成本与可信度也不同
      modelId: "local-3d",
      // 不取整：镜头时长常是 3.5s 这类小数，previz_generate 那条路径存的也是原值，
      // 这里取整会让同一个镜头的两条 take 显示成不同时长
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      resolution: "480p",
      createdAt: Date.now(),
    });
    // 新出的自动选中，与 previz_generate 的行为保持一致
    await db.update(shots).set({ previzSelectedId: previzId }).where(eq(shots.id, shotId));

    return NextResponse.json({ previzId, videoUrl, posterUrl });
  } catch (err) {
    console.error(`[Previz3D] shot ${shotId}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不该影响主流程 */
    }
  }
}
