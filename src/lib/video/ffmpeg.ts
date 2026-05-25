import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

/**
 * Detect the best available CJK-capable font for FFmpeg subtitle rendering.
 * Returns a FontName string for use in force_style, or null if none found.
 */
function detectChineseFont(): string {
  const candidates = [
    // Common Linux/Docker fonts that cover CJK
    "Droid Sans Fallback",   // Ubuntu/Debian default, covers zh-CN
    "Noto Sans CJK SC",      // Google Noto CJK Simplified Chinese
    "Noto Sans SC",
    "WenQuanYi Micro Hei",   // 文泉驿微米黑, common on Linux
    "WenQuanYi Zen Hei",
    "Source Han Sans CN",    // 思源黑体
    "SimHei",                // Windows 黑体
    "Microsoft YaHei",       // Windows 微软雅黑
    "PingFang SC",           // macOS
    "STHeiti",               // macOS
    "Arial Unicode MS",      // broad unicode fallback
    "DejaVu Sans",           // covers latin but may have CJK via Droid fallback
  ];

  try {
    const { execSync } = require("node:child_process");
    const fcList = execSync("fc-list :lang=zh 2>/dev/null || true", { encoding: "utf8" }) as string;
    // Pick the first candidate that appears in fc-list output
    for (const font of candidates) {
      if (fcList.toLowerCase().includes(font.toLowerCase())) return font;
    }
    // fc-list had output — just use any font name from it
    const firstMatch = fcList.match(/:\s*([^:]+):/);
    if (firstMatch) return firstMatch[1].split(",")[0].trim();
  } catch {
    // fc-list not available — try font files directly
    const fontPaths = [
      "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    ];
    for (const p of fontPaths) {
      if (fs.existsSync(p)) return "Droid Sans Fallback";
    }
  }

  return "sans-serif"; // last resort — works for latin, may render □ for CJK
}

interface SubtitleEntry {
  text: string;
  shotSequence: number;
}

interface AssembleParams {
  videoPaths: string[];
  subtitles: SubtitleEntry[];
  projectId: string;
  shotDurations: number[];
}

function generateSrtFile(
  subtitles: SubtitleEntry[],
  shotDurations: number[],
  outputPath: string
): string {
  const srtPath = outputPath.replace(/\.mp4$/, ".srt");

  const shotStartTimes: number[] = [];
  let cumulative = 0;
  for (const duration of shotDurations) {
    shotStartTimes.push(cumulative);
    cumulative += duration;
  }

  const srtEntries: string[] = [];
  let index = 1;

  for (const sub of subtitles) {
    const shotIdx = sub.shotSequence - 1;
    if (shotIdx < 0 || shotIdx >= shotDurations.length) continue;

    const startTime = shotStartTimes[shotIdx];
    const endTime = startTime + shotDurations[shotIdx];

    srtEntries.push(
      `${index}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sub.text}\n`
    );
    index++;
  }

  fs.writeFileSync(srtPath, srtEntries.join("\n"));
  return srtPath;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// Escape path for ffmpeg subtitles filter (colon, backslash, single quote)
function escapeSubtitlePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
}

/**
 * 检测视频文件是否有音频轨道。
 * 用于判断是否需要对该片段执行音频处理（无音轨片段跳过）。
 */
async function hasAudioTrack(videoPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) { resolve(false); return; }
      const hasAudio = metadata.streams.some((s) => s.codec_type === "audio");
      resolve(hasAudio);
    });
  });
}

/**
 * 对单个视频片段的音频做预处理：
 * - 在片段开头 fade-in 0.5s（消除突入感）
 * - 在片段结尾 fade-out 1s（为下一片段入场留出过渡空间）
 * - loudnorm 响度归一化至 -14 LUFS（统一各片段音量基准）
 * 输出为同目录的临时文件，返回临时文件路径。
 */
async function preprocessClipAudio(
  inputPath: string,
  duration: number,
  outputDir: string,
  idx: number
): Promise<string> {
  const outPath = path.resolve(outputDir, `clip-audio-${idx}-${Date.now()}.mp4`);
  const fadeOutStart = Math.max(0, duration - 1);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v", "copy",                        // 视频流直接复制，不重编码
        "-c:a", "aac",
        "-af", [
          `afade=t=in:st=0:d=0.5`,             // 开头 0.5s 淡入
          `afade=t=out:st=${fadeOutStart}:d=1`, // 结尾 1s 淡出
          `loudnorm=I=-14:LRA=11:TP=-1.5`,     // 响度归一化 (-14 LUFS)
        ].join(","),
        "-y",
      ])
      .output(outPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Audio preprocess failed: ${err.message}`)))
      .run();
  });

  return outPath;
}

export async function assembleVideo(params: AssembleParams): Promise<string> {
  const { videoPaths, subtitles, projectId, shotDurations } = params;
  const outputDir = path.resolve(uploadDir, "videos");
  fs.mkdirSync(outputDir, { recursive: true });
  const fileId = ulid();
  const concatOutputPath = path.resolve(outputDir, `${projectId}-concat-${fileId}.mp4`);
  const outputPath = path.resolve(outputDir, `${projectId}-final-${fileId}.mp4`);

  // 记录预处理产生的临时文件，最终统一清理
  const tempFiles: string[] = [];

  // Step 1: 音频预处理 — 对有音轨的片段做淡入淡出 + 响度归一化
  // 目的：消除多片段拼接时各自独立 BGM/音效的硬切和音量不一致问题
  const processedPaths: string[] = [];
  for (let i = 0; i < videoPaths.length; i++) {
    const vp = videoPaths[i];
    const dur = shotDurations[i] ?? 10;
    try {
      const hasAudio = await hasAudioTrack(path.resolve(vp));
      if (hasAudio) {
        const processed = await preprocessClipAudio(path.resolve(vp), dur, outputDir, i);
        tempFiles.push(processed);
        processedPaths.push(processed);
      } else {
        processedPaths.push(path.resolve(vp));
      }
    } catch (err) {
      console.warn(`[FFmpeg] Audio preprocess failed for clip ${i}, using original: ${err}`);
      processedPaths.push(path.resolve(vp));
    }
  }

  // Step 2: Concatenate video clips
  if (processedPaths.length === 1) {
    fs.copyFileSync(processedPaths[0], concatOutputPath);
  } else {
    const concatListPath = path.resolve(outputDir, `${projectId}-concat.txt`);
    const concatContent = processedPaths
      .map((p) => `file '${p}'`)
      .join("\n");
    fs.writeFileSync(concatListPath, concatContent);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy"])
        .output(concatOutputPath)
        .on("end", () => {
          fs.unlinkSync(concatListPath);
          // 清理音频预处理临时文件
          for (const tf of tempFiles) {
            try { fs.unlinkSync(tf); } catch { /* ignore */ }
          }
          resolve();
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg concat failed: ${err.message}`));
        })
        .run();
    });
  }

  // Step 2: Burn in subtitles if any
  if (subtitles.length > 0) {
    const srtPath = generateSrtFile(subtitles, shotDurations, outputPath);
    const absSrtPath = path.resolve(srtPath);
    const escapedSrtPath = escapeSubtitlePath(absSrtPath);
    const chineseFont = detectChineseFont();
    const forceStyle = `FontName=${chineseFont},FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=1`;

    console.log(`[FFmpeg] Subtitle burn — font: "${chineseFont}", srt: ${absSrtPath}`);

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatOutputPath)
          .outputOptions([
            "-y",
            "-vf", `subtitles='${escapedSrtPath}':force_style='${forceStyle}'`,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
          ])
          .output(outputPath)
          .on("end", () => {
            fs.unlinkSync(concatOutputPath);
            // Keep SRT as sidecar so users can load it in video players
            resolve();
          })
          .on("error", (err) => {
            reject(err);
          })
          .run();
      });
    } catch (err) {
      // Subtitle burn failed — log the full error and fall back to no-subtitle video
      console.error(`[FFmpeg] Subtitle burn failed (font="${chineseFont}"): ${err}`);
      fs.renameSync(concatOutputPath, outputPath);
    }
  } else {
    // No subtitles, just rename
    fs.renameSync(concatOutputPath, outputPath);
  }

  // Return relative path for uploadUrl compatibility
  return path.relative(process.cwd(), outputPath);
}
