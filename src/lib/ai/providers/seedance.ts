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
 *   - resolution：视频分辨率，支持 "480p" | "720p" | "1080p"（Seedance 2.0 fast 不支持 1080p）
 *
 * 支持的生成模式：
 *   - 首尾帧模式（anchorFirst + anchorLastAi）
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

  /**
   * 获取服务层级：优先使用调用方传入的值，其次读取环境变量 SEEDANCE_SERVICE_TIER，默认不传（即 auto）。
   * 'flex' 模式成本降低约 50%，但生成时间更长，适合非实时批量任务。
   */
  private resolveServiceTier(requested?: 'auto' | 'flex'): string | undefined {
    const tier = requested ?? (process.env.SEEDANCE_SERVICE_TIER as 'auto' | 'flex' | undefined);
    if (tier === 'flex') return 'flex';
    return undefined; // 不传则使用 API 默认（auto）
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const isKeyframe = "anchorFirst" in params;
    const buildBody = (useRemoteUrls: boolean) => {
      const body = isKeyframe
        ? this.buildKeyframeBody(
            useRemoteUrls
              ? (params as VideoGenerateParams & { anchorFirst: string; anchorLastAi: string; anchorFirstRemoteUrl?: string; anchorLastAiRemoteUrl?: string })
              : { ...(params as VideoGenerateParams & { anchorFirst: string; anchorLastAi: string }), anchorFirstRemoteUrl: undefined, anchorLastAiRemoteUrl: undefined }
          )
        : this.buildReferenceBody(
            params as VideoGenerateParams & { initialImage: string }
          );
      if (params.resolution) (body as Record<string, unknown>).resolution = params.resolution;
      const serviceTier = this.resolveServiceTier(params.serviceTier);
      if (serviceTier) (body as Record<string, unknown>).service_tier = serviceTier;
      return body;
    };

    const kfParams = params as VideoGenerateParams & { anchorFirstRemoteUrl?: string; anchorLastAiRemoteUrl?: string };
    const hasRemoteUrls = isKeyframe && !!(kfParams.anchorFirstRemoteUrl || kfParams.anchorLastAiRemoteUrl);

    const body = buildBody(true /* useRemoteUrls */);
    console.log(
      `[Seedance] Submitting task: model=${body.model}, ` +
        `duration=${body.duration}, ratio=${body.ratio}` +
        (params.resolution ? `, resolution=${params.resolution}` : "") +
        (hasRemoteUrls ? ", frames=remoteUrl" : ", frames=base64")
    );

    let taskId: string;
    try {
      taskId = await this.submitBody(body);
    } catch (err) {
      if (hasRemoteUrls) {
        // 提交被拒（HTTP 4xx/5xx），URL 可能已过期，降级为 base64 重试
        // 注：提交失败不消耗任何 token，因为任务尚未创建
        console.warn(`[Seedance] Remote URL submit failed, retrying with base64 fallback:`, err);
        taskId = await this.submitBody(buildBody(false /* base64 */));
        console.log(`[Seedance] Fallback task submitted: ${taskId}`);
      } else {
        throw err;
      }
    }

    let videoUrl: string;
    let lastFrameUrl: string | undefined;
    try {
      ({ videoUrl, lastFrameUrl } = await this.pollForResult(taskId));
    } catch (err) {
      if (hasRemoteUrls) {
        // 任务创建成功但执行失败，可能是 Seedance 拉取远端图片时 URL 已过期
        // 重新以 base64 提交（不计费的失败任务不影响此次重试的 token 消耗）
        console.warn(`[Seedance] Task ${taskId} failed (possibly expired URL), retrying with base64 fallback:`, err);
        const fallbackTaskId = await this.submitBody(buildBody(false /* base64 */));
        console.log(`[Seedance] Fallback task submitted: ${fallbackTaskId}`);
        ({ videoUrl, lastFrameUrl } = await this.pollForResult(fallbackTaskId));
      } else {
        throw err;
      }
    }

    await params.onRemoteResult?.({ videoUrl, taskId });

    const filepath = await downloadVideoWithRetry(videoUrl, this.uploadDir, {
      logPrefix: "SeedanceDownload",
    });

    return { filePath: filepath, lastFrameUrl, remoteVideoUrl: videoUrl, remoteTaskId: taskId };
  }

  /** 提交请求体，返回任务 ID */
  private async submitBody(body: Record<string, unknown>): Promise<string> {
    const response = await fetch(
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
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Seedance submit failed: ${response.status} ${errText}`);
    }
    const result = (await response.json()) as { id: string };
    console.log(`[Seedance] Task submitted: ${result.id}`);
    return result.id;
  }

  /**
   * 将时长值转换为 API 参数。
   * - duration > 0：直接传入秒数
   * - duration === -1：不传（让 Seedance 2.0 自动选择最优时长）
   * - duration <= 0（其他）：回退到 5 秒
   */
  private resolveDuration(duration: number): number | undefined {
    if (duration === -1) return undefined;   // auto
    if (duration > 0) return duration;
    return 5;                                 // fallback
  }

  /**
   * 在 prompt 末尾追加"禁止背景音乐"指令（若尚未包含）。
   * Seedance API 无法单独关闭 BGM（generate_audio 是全开/全关），
   * 只能通过 prompt 指令让模型只生成人声对白和环境音效、不生成 BGM。
   */
  private suppressBgmInPrompt(prompt: string): string {
    if (prompt.includes("禁止背景音乐") || prompt.includes("无背景音乐")) return prompt;
    return `${prompt}\n禁止背景音乐。`;
  }

  /** 首尾帧模式：提供第一帧和最后一帧图片 */
  private buildKeyframeBody(
    params: VideoGenerateParams & { anchorFirst: string; anchorLastAi: string; anchorFirstRemoteUrl?: string; anchorLastAiRemoteUrl?: string }
  ): Record<string, unknown> {
    const dur = this.resolveDuration(params.duration);
    // generate_audio: true 保留对白+音效；prompt 层禁止 BGM
    const generateAudio = params.generateAudio ?? true;
    const promptText = generateAudio ? this.suppressBgmInPrompt(params.prompt) : params.prompt;
    const body: Record<string, unknown> = {
      model: this.model,
      content: [
        { type: "text", text: promptText },
        {
          type: "image_url",
          // 优先使用图片生成 API 返回的公网 URL，省去本地读文件+base64 编码
          image_url: { url: params.anchorFirstRemoteUrl ?? toDataUrl(params.anchorFirst) },
          role: "first_frame",
        },
        {
          type: "image_url",
          image_url: { url: params.anchorLastAiRemoteUrl ?? toDataUrl(params.anchorLastAi) },
          role: "last_frame",
        },
      ],
      ratio: params.ratio || "16:9",
      generate_audio: generateAudio,
      return_last_frame: true,
      watermark: false,
    };
    if (dur !== undefined) body.duration = dur;
    return body;
  }

  /** 参考图模式：使用单张初始图片（角色参考图或上一镜头的最后帧） */
  private buildReferenceBody(
    params: VideoGenerateParams & { initialImage: string }
  ): Record<string, unknown> {
    const dur = this.resolveDuration(params.duration);
    const generateAudio = params.generateAudio ?? true;
    const promptText = generateAudio ? this.suppressBgmInPrompt(params.prompt) : params.prompt;
    const body: Record<string, unknown> = {
      model: this.model,
      content: [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: toImageUrl(params.initialImage) } },
      ],
      ratio: params.ratio || "16:9",
      generate_audio: generateAudio,
      return_last_frame: true,
      watermark: false,
    };
    if (dur !== undefined) body.duration = dur;
    return body;
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
