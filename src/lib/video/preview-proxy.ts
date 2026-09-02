import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ulid } from "ulid";
import { materializeArtifact, saveArtifact } from "@/lib/storage/artifact-store";

const execFileAsync = promisify(execFile);

/**
 * 预览代理（低码率 480p）与封面帧生成。
 *
 * ## 为什么需要
 *
 * 编辑器用 WebCodecs 在浏览器里解码源片。源片是 1080p、单个可达 55MB，
 * 主线程忙于解视频帧时音频解码线程会被饿死，报
 * `MP4Clip.tick audio timeout, {"pcmLen":0,...}` 并严重卡顿。
 * 产物迁到 OSS 后叠加网络拉流延迟，问题更明显。
 *
 * 实测：55MB / 1882×1080 → 480p CRF30 后 764KB（**73 倍**），
 * 按 10MB/s 计加载时间 5.5s → 0.07s，转码本身只花 1.6s。
 *
 * **导出成片始终用原片 `videoUrl`，代理只服务于预览。**
 *
 * ## 顺带解决缩略图缺失
 *
 * 有些分镜有视频但从没生成过首帧（`anchorFirst` 为 NULL），编辑器里是个空占位图。
 * 转码时顺手抽一张封面帧，这些分镜就有缩略图了。
 */

/** 预览代理的目标高度。480 是"够看清构图"和"够小"的平衡点。 */
const PROXY_HEIGHT = 480;
/** CRF 30 对预览足够；再低画质收益不明显，体积却翻倍。 */
const PROXY_CRF = 30;

export interface ProxyResult {
  /** 预览代理的存储引用 */
  previewUrl: string;
  /** 封面帧（jpg）的存储引用 */
  posterUrl: string;
}

/**
 * 为一个视频产物生成预览代理 + 封面帧。
 *
 * @param videoRef 源视频的存储引用（本地路径或 `oss://`）
 * @param keyPrefix 代理在存储中的目录前缀，如 `projects/<pid>/<label>/previews`
 */
export async function buildPreviewProxy(
  videoRef: string,
  keyPrefix: string
): Promise<ProxyResult> {
  // ffmpeg 只能吃本地文件；OSS 引用先物化，本地引用零拷贝
  const src = await materializeArtifact(videoRef);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acs-proxy-"));
  const id = ulid();
  const proxyPath = path.join(tmpDir, `${id}.mp4`);
  const posterPath = path.join(tmpDir, `${id}.jpg`);

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", src.path,
      // -2 让宽度自动对齐到偶数（编码器要求），避免源片是 1882 这种奇怪宽度时报错
      "-vf", `scale=-2:${PROXY_HEIGHT}`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", String(PROXY_CRF),
      // 关键帧间隔调密，编辑器拖动播放头时 seek 更快
      "-g", "48",
      // ⚠️ 必须禁用 B 帧：B 帧要求解码器缓冲并重排帧序（先解未来帧才能输出当前帧），
      // 在浏览器 WebCodecs 实时播放里会造成周期性卡顿。实测代价只有 +12% 体积。
      // 项目的导出路由早就在用 -bf 0，代理这边最初漏了。
      "-bf", "0",
      "-tune", "fastdecode",
      "-profile:v", "main",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "96k",
      // moov 前置：让浏览器边下边播，不必等整个文件到齐
      "-movflags", "+faststart",
      proxyPath,
    ]);

    // 封面帧取第一帧。不用 -ss 跳到中间：有些片段开头就是关键信息，
    // 而且 AI 生成的片段普遍很短（10-15s），第一帧足够代表内容。
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", src.path,
      "-frames:v", "1",
      "-vf", `scale=-2:${PROXY_HEIGHT}`,
      "-q:v", "4",
      posterPath,
    ]);

    const [previewUrl, posterUrl] = await Promise.all([
      saveArtifact(`${keyPrefix}/${id}.mp4`, fs.readFileSync(proxyPath)),
      saveArtifact(`${keyPrefix}/${id}.jpg`, fs.readFileSync(posterPath)),
    ]);

    return { previewUrl, posterUrl };
  } finally {
    src.cleanup();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不该影响主流程 */
    }
  }
}

/**
 * 生成代理并吞掉所有错误 —— 供视频生成成功后「顺带」调用。
 *
 * 代理失败**绝不能**让整个视频生成失败：视频已经生成出来了（钱也花了），
 * 仅仅因为转码出问题就把结果判失败，是拿用户的成果去赌一个可选优化。
 * 失败时返回 null，编辑器回退到用原片（慢，但能用）。
 */
export async function tryBuildPreviewProxy(
  videoRef: string,
  keyPrefix: string
): Promise<ProxyResult | null> {
  try {
    return await buildPreviewProxy(videoRef, keyPrefix);
  } catch (err) {
    console.warn(
      `[PreviewProxy] 生成失败（不影响视频本身）：${videoRef} —`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
