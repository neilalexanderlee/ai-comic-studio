/**
 * VolcengineEnhanceProvider
 *
 * 接入火山引擎 AI MediaKit（智能处理）画质增强功能。
 * 参考文档：
 *   - 画质增强开发指南：https://www.volcengine.com/docs/6448/2279961
 *   - 基础概念及准备工作（API Key 认证）：https://www.volcengine.com/docs/6448/2300661
 *
 * 认证：AI MediaKit 使用独立的 MediaKit API Key（Bearer Token 形式），
 * 与即梦 / Seedance 的 AK/SK 体系完全不同。
 * 在 https://console.volcengine.com/imp/ai-mediakit/tools 的 API Key 管理页面获取。
 *
 * 工作流（异步任务）：
 *   1. POST /api/v1/tools/enhance-video → 返回 task_id
 *   2. 轮询 GET /api/v1/tasks/{task_id} → status = "completed" → result.video_url
 *
 * 典型使用场景：
 *   先以 480p 生成（成本更低），再通过画质增强升至 1080p，
 *   总成本远低于直接生成高分辨率视频。
 *
 * 环境变量（备用，优先使用 DB 中存储的用户密钥）：
 *   VOLCENGINE_ENHANCE_API_KEY  - AI MediaKit 的 API Key
 */
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

/** AI MediaKit API 基础 URL */
const API_BASE = "https://mediakit.cn-beijing.volces.com";

/** 提交任务响应 */
interface EnhanceSubmitResponse {
  success?: boolean;
  task_id?: string;
  request_id?: string;
  // 错误时
  message?: string;
  code?: number | string;
}

/** 查询任务响应 */
interface EnhanceQueryResponse {
  success?: boolean;
  task_id?: string;
  task_type?: string;
  /** "processing" | "completed" | "failed" */
  status?: string;
  result?: {
    duration?: number;
    fps?: number;
    resolution?: string;
    tool_version?: string;
    /** 增强后视频下载地址（有效期 48 小时） */
    video_url?: string;
  };
  expires_at?: number;
  created_at?: number;
  finished_at?: number;
  request_id?: string;
  // 错误时
  message?: string;
  code?: number | string;
}

export class VolcengineEnhanceProvider {
  private uploadDir: string;
  private apiKey: string;

  constructor(params?: {
    apiKey?: string;
    uploadDir?: string;
  }) {
    this.apiKey =
      params?.apiKey ||
      process.env.VOLCENGINE_ENHANCE_API_KEY ||
      "";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  /**
   * 对给定视频执行画质增强，返回增强后本地保存的文件路径。
   *
   * @param videoPathOrUrl 待增强视频的本地路径或可公开访问的 URL
   * @param publicBaseUrl  当 videoPathOrUrl 是本地路径时，转为外网可访问 URL 的前缀
   * @param options        可选参数：resolution（目标分辨率）、scene（场景）
   */
  async enhanceVideo(
    videoPathOrUrl: string,
    publicBaseUrl?: string,
    options?: {
      resolution?: "720p" | "1080p" | "4k";
      scene?: "aigc" | "short_series" | "ugc" | "old_film";
      toolVersion?: "standard" | "professional";
    }
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error(
        "[VolcengineEnhance] API Key 未配置。请前往「设置 → AI MediaKit」填写 API Key。"
      );
    }

    const videoUrl = this.resolvePublicUrl(videoPathOrUrl, publicBaseUrl);
    if (!videoUrl) {
      throw new Error(
        "[VolcengineEnhance] Cannot resolve public URL for video. " +
          "Set NEXT_PUBLIC_BASE_URL or pass publicBaseUrl to provide an accessible URL."
      );
    }

    console.log(`[VolcengineEnhance] Submitting enhance task for: ${videoUrl}`);

    const taskId = await this.submitTask(videoUrl, options);
    console.log(`[VolcengineEnhance] Task submitted: ${taskId}`);

    const enhancedUrl = await this.pollForResult(taskId);
    console.log(`[VolcengineEnhance] Enhanced video URL: ${enhancedUrl}`);

    // 下载并保存到本地
    const videoRes = await fetch(enhancedUrl);
    if (!videoRes.ok) {
      throw new Error(
        `[VolcengineEnhance] Failed to download enhanced video: ${videoRes.status}`
      );
    }
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const filename = `${ulid()}_enhanced.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[VolcengineEnhance] Saved enhanced video to: ${filepath}`);
    return filepath;
  }

  /** 提交画质增强任务，返回 task_id */
  private async submitTask(
    videoUrl: string,
    options?: {
      resolution?: "720p" | "1080p" | "4k";
      scene?: "aigc" | "short_series" | "ugc" | "old_film";
      toolVersion?: "standard" | "professional";
    }
  ): Promise<string> {
    const body: Record<string, unknown> = {
      video_url: videoUrl,
      scene: options?.scene ?? "aigc",
      resolution: options?.resolution ?? "1080p",
      tool_version: options?.toolVersion ?? "standard",
    };

    let response: EnhanceSubmitResponse;
    try {
      const res = await fetch(`${API_BASE}/api/v1/tools/enhance-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      response = (await res.json()) as EnhanceSubmitResponse;
      if (!res.ok || response.success === false) {
        throw new Error(
          `HTTP ${res.status}: ${response.message ?? JSON.stringify(response)}`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[VolcengineEnhance] Submit API error: ${msg}`);
    }

    const taskId = response.task_id;
    if (!taskId) {
      throw new Error(
        `[VolcengineEnhance] No task_id in submit response: ${JSON.stringify(response)}`
      );
    }
    return taskId;
  }

  /** 轮询任务状态，返回增强后视频 URL（result.video_url） */
  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 72; // 最多等 6 分钟（72 × 5s），标准版 RTF 6~10
    const interval = 5_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      let response: EnhanceQueryResponse;
      try {
        const res = await fetch(`${API_BASE}/api/v1/tasks/${taskId}`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        response = (await res.json()) as EnhanceQueryResponse;
        if (!res.ok) {
          console.warn(
            `[VolcengineEnhance] Poll ${i + 1} HTTP ${res.status}: ${response.message}`
          );
          continue;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[VolcengineEnhance] Poll ${i + 1} error: ${msg}`);
        continue;
      }

      const status = response.status ?? "";
      console.log(`[VolcengineEnhance] Poll ${i + 1}: status=${status}`);

      if (status === "completed" && response.result?.video_url) {
        return response.result.video_url;
      }

      if (status === "failed") {
        throw new Error(
          `[VolcengineEnhance] Enhancement task failed. task_id=${taskId}`
        );
      }
    }

    throw new Error(
      `[VolcengineEnhance] Enhancement timed out after ${(maxAttempts * interval) / 60000} minutes. task_id=${taskId}`
    );
  }

  /** 将本地路径或 URL 解析为可公开访问的 URL */
  private resolvePublicUrl(
    videoPathOrUrl: string,
    publicBaseUrl?: string
  ): string | null {
    if (
      videoPathOrUrl.startsWith("http://") ||
      videoPathOrUrl.startsWith("https://")
    ) {
      return videoPathOrUrl;
    }

    const base =
      publicBaseUrl ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.VOLCENGINE_ENHANCE_BASE_URL ||
      "";
    if (!base) return null;

    const uploadDir = (process.env.UPLOAD_DIR || "./uploads").replace(/\/+$/, "");
    const relative = videoPathOrUrl.replace(uploadDir, "").replace(/^\/+/, "");
    return `${base.replace(/\/+$/, "")}/uploads/${relative}`;
  }
}
