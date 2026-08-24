/**
 * MiniMaxVideoProvider
 *
 * 接入 MiniMax H3 视频生成模型（v2 异步任务 API）。
 * 参考文档：
 *   创建任务：https://platform.minimax.io/docs/api-reference/video-generation-v2-create
 *   查询任务：https://platform.minimax.io/docs/api-reference/video-generation-v2-query
 *
 * 认证：Bearer Token（MiniMax API Key）。
 * 接口端点：POST {baseUrl}/v2/video_generation
 * 轮询端点：GET  {baseUrl}/v2/query/video_generation/{task_id}
 *
 * MiniMax H3 参数说明（官方确认）：
 *   - model：固定 "MiniMax-H3"
 *   - duration：4-15 秒（整数）
 *   - resolution："768P" | "2K"
 *   - ratio：图生视频（含首帧/首尾帧/多模态参考）场景锁定为 "adaptive"
 *
 * 支持的生成模式：
 *   - 首尾帧模式（anchorFirst + anchorLastAi）→ image_url role: first_frame / last_frame
 *   - 参考图模式（initialImage）→ image_url role: first_frame
 *   - 多模态参考模式（multimodalRefs）→ image_url role: reference_image + audio_url role: reference_audio
 */
import type { VideoProvider, VideoGenerateParams, VideoGenerateResult, MultimodalRefItem } from "../types";
import fs from "node:fs";
import path from "node:path";
import { downloadVideoWithRetry } from "./download-with-retry";

function toDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : "image/png";
  const base64 = fs.readFileSync(filePath, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}

function toImageUrl(imagePathOrUrl: string): string {
  if (imagePathOrUrl.startsWith("http://") || imagePathOrUrl.startsWith("https://")) {
    return imagePathOrUrl;
  }
  return toDataUrl(imagePathOrUrl);
}

function toAudioDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "wav" ? "audio/wav" :
    ext === "m4a" ? "audio/mp4" :
    ext === "ogg" ? "audio/ogg" :
    ext === "flac" ? "audio/flac" :
    "audio/mpeg"; // mp3 / fallback
  const base64 = fs.readFileSync(filePath, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}

type MiniMaxTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface MiniMaxTaskResponse {
  task: {
    id: string;
    status: MiniMaxTaskStatus;
    content?: { url?: string };
    error?: { message?: string };
  };
}

export class MiniMaxVideoProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = (params?.apiKey || process.env.MINIMAX_API_KEY || "").trim();
    this.baseUrl = (params?.baseUrl || "https://api.minimaxi.com").replace(/\/+$/, "");
    this.model = params?.model || "MiniMax-H3";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  /** duration：4-15 秒整数，向上取整避免视频被截断 */
  private resolveDuration(duration: number): number {
    const d = Math.ceil(duration || 5);
    return Math.max(4, Math.min(15, d));
  }

  /** resolution：仅支持 "768P" / "2K"，其余项目内常见值（480p/720p/1080p/undefined）就近映射到 768P */
  private resolveResolution(resolution?: string): "768P" | "2K" {
    return resolution?.toUpperCase() === "2K" ? "2K" : "768P";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const isKeyframe = "anchorFirst" in params && !!params.anchorFirst;
    const isMultimodal = "multimodalRefs" in params && !!params.multimodalRefs;

    const body = isMultimodal
      ? this.buildMultimodalBody(params as VideoGenerateParams & { multimodalRefs: MultimodalRefItem[] })
      : isKeyframe
        ? this.buildKeyframeBody(params as VideoGenerateParams & { anchorFirst: string; anchorLastAi: string })
        : this.buildReferenceBody(params as VideoGenerateParams & { initialImage: string });

    const mmRefs = isMultimodal ? (params as VideoGenerateParams & { multimodalRefs: MultimodalRefItem[] }).multimodalRefs : [];
    console.log(
      `[MiniMax Video] Submitting task: model=${this.model}, duration=${body.duration}, resolution=${body.resolution}` +
        (isMultimodal ? `, multimodal refs=${mmRefs.filter((r) => r.type === "image").length}img+${mmRefs.filter((r) => r.type === "audio").length}audio` : "")
    );

    const taskId = await this.submitBody(body);
    const videoUrl = await this.pollForResult(taskId);
    await params.onRemoteResult?.({ videoUrl, taskId });

    const filepath = await downloadVideoWithRetry(videoUrl, this.uploadDir, {
      logPrefix: "MiniMaxVideoDownload",
    });

    console.log(`[MiniMax Video] Saved to ${filepath}`);
    return { filePath: filepath, remoteVideoUrl: videoUrl, remoteTaskId: taskId };
  }

  private async submitBody(body: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v2/video_generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`MiniMax video submit failed: ${res.status} ${errBody}`);
    }
    const json = (await res.json()) as { task_id: string };
    console.log(`[MiniMax Video] Task submitted: ${json.task_id}`);
    return json.task_id;
  }

  /** 首尾帧模式：提供第一帧和最后一帧图片 */
  private buildKeyframeBody(
    params: VideoGenerateParams & { anchorFirst: string; anchorLastAi: string }
  ): Record<string, unknown> {
    return {
      model: this.model,
      content: [
        { type: "text", text: params.prompt },
        { type: "image_url", image_url: { url: toImageUrl(params.anchorFirst) }, role: "first_frame" },
        { type: "image_url", image_url: { url: toImageUrl(params.anchorLastAi) }, role: "last_frame" },
      ],
      resolution: this.resolveResolution(params.resolution),
      duration: this.resolveDuration(params.duration),
      ratio: "adaptive",
    };
  }

  /** 参考图模式：单张初始图片作为首帧（图生视频） */
  private buildReferenceBody(
    params: VideoGenerateParams & { initialImage: string }
  ): Record<string, unknown> {
    return {
      model: this.model,
      content: [
        { type: "text", text: params.prompt },
        { type: "image_url", image_url: { url: toImageUrl(params.initialImage) }, role: "first_frame" },
      ],
      resolution: this.resolveResolution(params.resolution),
      duration: this.resolveDuration(params.duration),
      ratio: "adaptive",
    };
  }

  /**
   * 多模态参考模式：图片（reference_image）+ 音频（reference_audio）。
   * 顺序与 buildRefEntries 的 @参考N 编号完全一致：图片先行，音频殿后。
   */
  private buildMultimodalBody(
    params: VideoGenerateParams & { multimodalRefs: MultimodalRefItem[] }
  ): Record<string, unknown> {
    const content: unknown[] = [{ type: "text", text: params.prompt }];

    const imageRefs = params.multimodalRefs.filter((r) => r.type === "image");
    for (const ref of imageRefs) {
      content.push({
        type: "image_url",
        image_url: { url: toImageUrl(ref.path) },
        role: "reference_image",
      });
    }

    const audioRefs = params.multimodalRefs.filter((r) => r.type === "audio");
    for (const ref of audioRefs) {
      content.push({
        type: "audio_url",
        audio_url: { url: toAudioDataUrl(ref.path) },
        role: "reference_audio",
      });
    }

    return {
      model: this.model,
      content,
      resolution: this.resolveResolution(params.resolution),
      duration: this.resolveDuration(params.duration),
      ratio: "adaptive",
    };
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120;
    const interval = 5_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const res = await fetch(`${this.baseUrl}/v2/query/video_generation/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        // 402/422 等属于不可重试错误，直接抛出终止轮询
        if (res.status === 402 || res.status === 422) {
          throw new Error(`MiniMax video generation error: ${res.status} ${errBody}`);
        }
        continue;
      }

      const json = (await res.json()) as MiniMaxTaskResponse;
      const { status, content, error } = json.task;
      console.log(`[MiniMax Video] Poll ${i + 1}: status=${status}`);

      if (status === "succeeded") {
        if (!content?.url) throw new Error("MiniMax video: no URL in result");
        return content.url;
      }
      if (status === "failed" || status === "cancelled") {
        throw new Error(`MiniMax video generation ${status}: ${error?.message || "unknown"}`);
      }
    }

    throw new Error("MiniMax video generation timed out after 10 minutes");
  }
}
