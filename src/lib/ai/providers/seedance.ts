/**
 * SeedanceProvider
 *
 * 接入火山方舟 Seedance 视频生成模型。
 * 参考文档：https://www.volcengine.com/docs/82379/1520757 （创建视频生成任务等）
 * Base URL：https://www.volcengine.com/docs/82379/1298459
 * 版本：Seedance 2.0（兼容 1.5）
 *
 * 认证：Bearer Token（方舟 API Key）。
 * 接口端点：POST {baseUrl}/contents/generations/tasks
 * 轮询端点：GET  {baseUrl}/contents/generations/tasks/{id}
 *
 * Seedance 2.0 参数说明（官方确认）：
 *   - duration：支持 5 / 10 / 15 秒（Seedance 2.0 最高 15s；1.5 最高 12s；1.0-lite 最高 5s）
 *   - resolution：视频分辨率，支持 "480p" | "720p" | "1080p" | "2K"
 *
 * 支持的生成模式：
 *   - 首尾帧模式（firstFrame + lastFrame）
 *   - 参考图模式（initialImage）
 */
import { ensureArkApiV3BaseUrl } from "../ark-base-url";
import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { downloadVideoWithRetry } from "./download-with-retry";

function toDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
  const base64 = fs.readFileSync(filePath, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}

// 支持本地路径或 http(s) URL
function toImageUrl(imagePathOrUrl: string): string {
  if (
    imagePathOrUrl.startsWith("http://") ||
    imagePathOrUrl.startsWith("https://")
  ) {
    return imagePathOrUrl;
  }
  return toDataUrl(imagePathOrUrl);
}

export class SeedanceProvider implements VideoProvider {
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
    this.apiKey = (params?.apiKey || process.env.SEEDANCE_API_KEY || "").trim();
    this.baseUrl = ensureArkApiV3BaseUrl(
      (
        params?.baseUrl ||
        process.env.SEEDANCE_BASE_URL ||
        "https://ark.cn-beijing.volces.com/api/v3"
      ).trim()
    ).replace(/\/+$/, "");
    // 默认使用 Seedance 2.0 模型
    this.model =
      params?.model || process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-260128";
    this.uploadDir =
      params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const body =
      "firstFrame" in params
        ? this.buildKeyframeBody(
            params as VideoGenerateParams & { firstFrame: string; lastFrame: string }
          )
        : this.buildReferenceBody(
            params as VideoGenerateParams & { initialImage: string }
          );

    // Seedance 2.0 新增 resolution 参数
    if (params.resolution) {
      (body as Record<string, unknown>).resolution = params.resolution;
    }

    console.log(
      `[Seedance] Submitting task: model=${body.model}, ` +
        `duration=${body.duration}, ratio=${body.ratio}` +
        (params.resolution ? `, resolution=${params.resolution}` : "")
    );

    const submitResponse = await fetch(
      `${this.baseUrl}/contents/generations/tasks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      throw new Error(
        `Seedance submit failed: ${submitResponse.status} ${errText}`
      );
    }

    const submitResult = (await submitResponse.json()) as { id: string };
    console.log(`[Seedance] Task submitted: ${submitResult.id}`);

    const { videoUrl, lastFrameUrl } = await this.pollForResult(submitResult.id);

    const filepath = await downloadVideoWithRetry(videoUrl, this.uploadDir, {
      logPrefix: "SeedanceDownload",
    });

    return { filePath: filepath, lastFrameUrl };
  }

  /** 首尾帧模式：提供第一帧和最后一帧图片 */
  private buildKeyframeBody(
    params: VideoGenerateParams & { firstFrame: string; lastFrame: string }
  ): Record<string, unknown> {
    return {
      model: this.model,
      content: [
        { type: "text", text: params.prompt },
        {
          type: "image_url",
          image_url: { url: toDataUrl(params.firstFrame) },
          role: "first_frame",
        },
        {
          type: "image_url",
          image_url: { url: toDataUrl(params.lastFrame) },
          role: "last_frame",
        },
      ],
      duration: params.duration || 5,
      ratio: params.ratio || "16:9",
      watermark: false,
    };
  }

  /** 参考图模式：使用单张初始图片（角色参考图或上一镜头的最后帧） */
  private buildReferenceBody(
    params: VideoGenerateParams & { initialImage: string }
  ): Record<string, unknown> {
    return {
      model: this.model,
      content: [
        { type: "text", text: params.prompt },
        { type: "image_url", image_url: { url: toImageUrl(params.initialImage) } },
      ],
      duration: params.duration || 5,
      ratio: params.ratio || "16:9",
      return_last_frame: true,
      watermark: false,
    };
  }

  private async pollForResult(
    taskId: string
  ): Promise<{ videoUrl: string; lastFrameUrl?: string }> {
    const maxAttempts = 120;
    const interval = 5_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const response = await fetch(
        `${this.baseUrl}/contents/generations/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }
      );

      if (!response.ok) continue;

      const result = (await response.json()) as {
        status: string;
        content?: { video_url?: string; last_frame_url?: string };
        error?: { message?: string };
      };

      console.log(`[Seedance] Poll ${i + 1}: status=${result.status}`);

      if (result.status === "succeeded" && result.content?.video_url) {
        return {
          videoUrl: result.content.video_url,
          lastFrameUrl: result.content.last_frame_url,
        };
      }
      if (result.status === "failed") {
        throw new Error(
          `Seedance generation failed: ${result.error?.message || "unknown"}`
        );
      }
    }

    throw new Error("Seedance generation timed out after 10 minutes");
  }
}
