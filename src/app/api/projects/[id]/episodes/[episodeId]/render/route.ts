import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface SubtitleStyle {
  fontSize?: number;
  color?: string;
  background?: string;
  x?: number;
  y?: number;
  width?: number;
  textAlign?: "left" | "center" | "right";
}

interface VideoClip {
  type: "video";
  url: string;
  startTime: number;
  endTime: number;
  duration: number;
  /** 素材内部裁剪起点（秒），0 或 undefined 表示从头 */
  trimStart?: number;
  /** 素材内部裁剪终点（秒），undefined 表示用到结尾 */
  trimEnd?: number;
}

interface SubtitleClip {
  type: "subtitle";
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  subtitleStyle?: SubtitleStyle;
}

interface AudioClip {
  type: "audio" | "bgm";
  url?: string;       // 旧格式兼容
  audioUrl?: string;  // MediaLibrary 存的是 audioUrl
  startTime: number;
  endTime: number;
  duration: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

type Clip = VideoClip | SubtitleClip | AudioClip;

interface Track {
  type: "video" | "subtitle" | "bgm" | "audio";
  clips: Clip[];
  muted?: boolean;
  volume?: number;
}

interface TimelinePayload {
  tracks: Track[];
  canvasWidth?: number;
  canvasHeight?: number;
  /** 全局字幕样式，用于 ASS Default 样式层 */
  globalSubtitleStyle?: SubtitleStyle;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 本地文件路径：./uploads/xxx 或 /api/uploads/xxx → 绝对路径 */
function resolveLocalPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const stripped = normalized.replace(/^.*uploads\//, "");
  return path.resolve(uploadDir, stripped);
}


/**
 * 用 ffprobe 检查视频文件是否包含音频流。
 * 无音频轨时后续 BGM 混音不能引用 [0:a]。
 */
async function videoHasAudioTrack(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      videoPath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** 秒数 → ASS 时间戳格式 H:MM:SS.cc */
function toAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** CSS #RRGGBB → ASS &H00BBGGRR */
function hexToAssColor(hex: string): string {
  const c = hex.replace(/^#/, "");
  if (c.length !== 6) return "&H00FFFFFF";
  return `&H00${c.slice(4, 6).toUpperCase()}${c.slice(2, 4).toUpperCase()}${c.slice(0, 2).toUpperCase()}`;
}

/**
 * 生成 ASS 字幕文件。
 * globalStyle 作为 ASS [V4+ Styles] Default 基础样式（字号/颜色/垂直位置/对齐）。
 * 单条 clip 若有独立 subtitleStyle 覆盖则用 inline override tags 叠加。
 */
function buildAssFile(
  clips: SubtitleClip[],
  tmpDir: string,
  globalStyle?: SubtitleStyle,
): string | null {
  if (clips.length === 0) return null;

  const gs = globalStyle ?? {};
  // ASS Default Style 字段
  const fontSize  = gs.fontSize  ?? 32;
  const color     = gs.color     ? hexToAssColor(gs.color) : "&H00FFFFFF";
  // 垂直边距：y∈[0,1] → MarginV 像素（从底部算）
  const marginV   = gs.y !== undefined ? Math.round((1 - gs.y) * 1080) : 80;
  // 对齐：左1 / 中2（默认） / 右3，位于底部（ASS alignment 1-3 = 底部行）
  const align     = gs.textAlign === "left" ? 1 : gs.textAlign === "right" ? 3 : 2;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // OutlineColour=&H80000000（半透明黑描边），Shadow=1
    `Style: Default,Arial,${fontSize},${color},&H000000FF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,${align},10,10,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  // 全局字幕样式作为 ASS Default 基础；单条 clip 不再注入 override tags，
  // 避免 clip 初始化时写死的 subtitleStyle 覆盖全局设置。
  const dialogues = clips
    .sort((a, b) => a.startTime - b.startTime)
    .map((clip) => {
      const text = (clip.text ?? "").replace(/\n/g, "\\N");
      return `Dialogue: 0,${toAssTime(clip.startTime)},${toAssTime(clip.endTime)},Default,,0,0,0,,${text}`;
    })
    .join("\n");

  const assPath = path.join(tmpDir, "subtitles.ass");
  fs.writeFileSync(assPath, header + "\n" + dialogues + "\n", "utf-8");
  return assPath;
}

// ── SSE 事件类型 ──────────────────────────────────────────────────────────────

type RenderEvent =
  | { type: "progress"; stage: string; message: string }
  | { type: "done"; outputUrl: string }
  | { type: "error"; message: string };

// ── 主处理函数（SSE 流式输出） ─────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id: projectId, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  const isAuth = getAuthUserIdFromRequest(request) !== null;

  if (!isAuth) await reclaimLocalProjectsForUser(userId);

  // 鉴权：确认项目归属
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) return new Response("Not found", { status: 404 });

  const [episode] = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  if (!episode) return new Response("Episode not found", { status: 404 });

  // 解析时间线
  const body = await request.json() as { timeline: TimelinePayload };
  const { timeline } = body;
  const globalSubtitleStyle = timeline.globalSubtitleStyle;
  if (!timeline?.tracks?.length) {
    return new Response("Empty timeline", { status: 400 });
  }

  // ── 按轨道类型拆分（支持多条同类轨道） ──────────────────────────────────

  const videoClips = timeline.tracks
    .filter((t) => t.type === "video")
    .flatMap((t) =>
      t.clips.filter((c): c is VideoClip => c.type === "video" && !!c.url)
    )
    .sort((a, b) => a.startTime - b.startTime);

  if (videoClips.length === 0) {
    return NextResponse.json({ error: "No video clips in timeline" }, { status: 400 });
  }

  const subtitleClips = timeline.tracks
    .filter((t) => t.type === "subtitle")
    .flatMap((t) =>
      t.clips.filter((c): c is SubtitleClip => c.type === "subtitle" && !!c.text)
    );

  const bgmClips = timeline.tracks
    .filter((t) => (t.type === "bgm" || t.type === "audio") && !t.muted)
    .flatMap((t) =>
      t.clips.filter(
        (c): c is AudioClip =>
          (c.type === "bgm" || c.type === "audio") && !!(c.audioUrl || c.url)
      )
    );

  // 准备输出路径
  const rendersDir = path.join(uploadDir, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });

  const tmpDir = path.join(rendersDir, `tmp_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const outputPath = path.join(rendersDir, `${projectId}_${episodeId}_${Date.now()}.mp4`);

  // ── SSE 流式返回进度 ──────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: RenderEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        // ── Step 1：构建视频拼接 concat list（支持 trimStart / trimEnd） ────────
        send({ type: "progress", stage: "concat", message: `合并 ${videoClips.length} 个视频片段…` });
        const concatListPath = path.join(tmpDir, "concat.txt");
        const concatLines = videoClips
          .map((c) => {
            const absPath = resolveLocalPath(c.url);
            const escaped = absPath.replace(/'/g, "'\\''");
            const lines = [`file '${escaped}'`];
            if ((c.trimStart ?? 0) > 0) lines.push(`inpoint ${c.trimStart}`);
            if (c.trimEnd !== undefined && c.trimEnd > 0) lines.push(`outpoint ${c.trimEnd}`);
            return lines.join("\n");
          })
          .join("\n");
        fs.writeFileSync(concatListPath, concatLines, "utf-8");

        // ── Step 2：concat → 临时视频（始终 libx264 重编码）─────────────────────
        //
        // 重要：不能用 -c copy。AI 生成视频（Seedance/Kling）的 H.264 stream 有
        // ~41ms encoder delay（video PTS 从 0.041s 开始，audio 从 0 开始）。
        // libx264 重编码会把 PTS 从 0 开始重置，BGM adelay = stored clip.startTime
        // 即可精确对齐，无需额外补偿。
        const concatVideoPath = path.join(tmpDir, "concat.mp4");
        await execFileAsync("ffmpeg", [
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", concatListPath,
          "-c:v", "libx264",
          "-bf", "0",
          "-preset", "fast",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "192k",
          concatVideoPath,
        ]);

        // ── Step 3：字幕烧录（如有）──────────────────────────────────────
        const assPath = buildAssFile(subtitleClips, tmpDir, globalSubtitleStyle);
        let videoWithSubsPath = concatVideoPath;

        if (assPath) {
          send({ type: "progress", stage: "subtitle", message: `烧录字幕（${subtitleClips.length} 条）…` });
          const candidatePath = path.join(tmpDir, "with_subs.mp4");
          try {
            await execFileAsync("ffmpeg", [
              "-y",
              "-i", path.resolve(concatVideoPath),
              "-vf", "subtitles=subtitles.ass",
              "-c:v", "libx264",
              "-bf", "0",
              "-preset", "fast",
              "-crf", "23",
              "-c:a", "copy",
              path.resolve(candidatePath),
            ], { cwd: tmpDir });
            videoWithSubsPath = candidatePath;
          } catch (subtitleErr) {
            console.warn("[render] 字幕烧录跳过:", (subtitleErr as Error).message?.slice(0, 200));
          }
        }

        // ── Step 4：BGM 混音（如有）──────────────────────────────────────
        if (bgmClips.length > 0) {
          send({ type: "progress", stage: "bgm", message: `混合 ${bgmClips.length} 条背景音乐…` });

          const hasOrigAudio = await videoHasAudioTrack(videoWithSubsPath);

          // concat 已用 libx264 归零 PTS，存档 clip.startTime 直接等于视频帧位置，
          // 距 clip 边界 ≤80ms 的 BGM 起点吸附到精确边界（消除次帧手动对齐误差）
          const sortedVideoClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);
          const SNAP_MS = 0.08;
          function toActualTime(storedTime: number): number {
            let closestDist = Infinity, closestIdx = -1;
            for (let k = 0; k < sortedVideoClips.length; k++) {
              const dist = Math.abs(storedTime - sortedVideoClips[k].startTime);
              if (dist < closestDist) { closestDist = dist; closestIdx = k; }
            }
            if (closestDist <= SNAP_MS) return sortedVideoClips[closestIdx].startTime;
            return storedTime;
          }

          const totalVideoDuration = videoClips.reduce((s, c) => s + c.duration, 0);
          const padDur = (totalVideoDuration + 2).toFixed(3);

          const inputArgs: string[] = ["-y", "-i", videoWithSubsPath];
          for (const clip of bgmClips) {
            inputArgs.push("-i", resolveLocalPath(clip.audioUrl ?? clip.url ?? ""));
          }

          const filterParts: string[] = [];
          const mixLabels: string[] = [];

          if (hasOrigAudio) {
            filterParts.push("[0:a]volume=1.0[orig]");
            mixLabels.push("[orig]");
          }

          bgmClips.forEach((clip, i) => {
            const inputIdx = i + 1;
            const clipStart = toActualTime(clip.startTime ?? 0);
            const delayMs = Math.round(clipStart * 1000);
            const vol = clip.volume ?? 0.8;
            const fadeIn = clip.fadeIn ?? 0;
            const fadeOut = clip.fadeOut ?? 0;
            const clipDuration = clip.duration ?? 0;

            // atrim 先截断 → adelay 定位 → volume → afade → apad 填充到视频总时长
            let chain = `[${inputIdx}:a]atrim=duration=${clipDuration.toFixed(3)},adelay=${delayMs}|${delayMs},volume=${vol}`;
            if (fadeIn > 0) chain += `,afade=t=in:st=${clipStart.toFixed(3)}:d=${fadeIn}`;
            if (fadeOut > 0 && clipDuration > fadeOut) {
              chain += `,afade=t=out:st=${(clipStart + clipDuration - fadeOut).toFixed(3)}:d=${fadeOut}`;
            }
            chain += `,apad=whole_dur=${padDur}`;
            filterParts.push(`${chain}[bgm${i}]`);
            mixLabels.push(`[bgm${i}]`);
          });

          let filterComplex: string;
          let mapAudioArg: string;

          if (mixLabels.length === 1) {
            filterComplex = filterParts.join(";");
            mapAudioArg = mixLabels[0];
          } else {
            filterParts.push(
              `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=2:normalize=0[aout]`
            );
            filterComplex = filterParts.join(";");
            mapAudioArg = "[aout]";
          }

          await execFileAsync("ffmpeg", [
            ...inputArgs,
            "-filter_complex", filterComplex,
            "-map", "0:v",
            "-map", mapAudioArg,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            outputPath,
          ]);
        } else {
          // 无 BGM，直接重新封装确保音频为 aac
          send({ type: "progress", stage: "mux", message: "封装输出文件…" });
          await execFileAsync("ffmpeg", [
            "-y",
            "-i", videoWithSubsPath,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            outputPath,
          ]);
        }

        // ── Step 5：写入 DB ────────────────────────────────────────────────
        const relativeOutput = `./uploads/renders/${path.basename(outputPath)}`;
        await db
          .update(episodes)
          .set({ finalVideoUrl: relativeOutput })
          .where(eq(episodes.id, episodeId));

        fs.rmSync(tmpDir, { recursive: true, force: true });

        send({ type: "done", outputUrl: relativeOutput });
      } catch (err) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        console.error("[render] ffmpeg error:", err);
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
