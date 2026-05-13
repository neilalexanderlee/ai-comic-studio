/**
 * VolcengineEnhanceProvider
 *
 * 接入火山引擎 AI MediaKit（智能处理）画质增强功能。
 * 参考文档：
 *   - 画质增强指南：https://www.volcengine.com/docs/6448/2279961
 *   - 提交画质增强任务 API：https://www.volcengine.com/docs/6448/2279230
 *   - 查询任务信息 API：https://www.volcengine.com/docs/6448/2278532
 *   - 快速入门（视频生成后处理）：https://www.volcengine.com/docs/6448/2298704
 *
 * 认证：火山引擎 AccessKey / SecretKey（AK/SK）。
 * 与即梦 Jimeng 使用相同的 @volcengine/openapi Service 类进行签名。
 *
 * 工作流（异步任务）：
 *   1. 提交视频 URL → 获取 task_id
 *   2. 轮询任务状态 → 获取增强后的视频 URL
 *
 * 典型使用场景：
 *   先以 480p 生成（成本更低），再通过画质增强升至 720p，达到与直接生成 720p 接近的效果，但成本更低。
 *
 * 环境变量：
 *   VOLCENGINE_ENHANCE_ACCESS_KEY  - AI MediaKit 的 AccessKey
 *   VOLCENGINE_ENHANCE_SECRET_KEY  - AI MediaKit 的 SecretKey
 *   （若使用与 Jimeng 相同的 AK/SK 账号，可复用 JIMENG_ACCESS_KEY / JIMENG_SECRET_KEY）
 */
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
// @ts-ignore
import { Service } from "@volcengine/openapi";

/** AI MediaKit 画质增强任务响应结构 */
interface EnhanceSubmitResponse {
  ResponseMetadata?: { Error?: { Message: string } };
  /** 任务 ID（部分版本放在顶层） */
  TaskId?: string;
  /** 部分版本将结果放在 data 里 */
  data?: {
    task_id?: string;
    TaskId?: string;
  };
}

interface EnhanceQueryResponse {
  ResponseMetadata?: { Error?: { Message: string } };
  /** 任务状态：Processing | Success | Failed */
  Status?: string;
  /** 增强后的视频输出 URL */
  OutputVideoUrl?: string;
  /** 部分版本将结果放在 data 里 */
  data?: {
    status?: string;
    Status?: string;
    output_video_url?: string;
    OutputVideoUrl?: string;
    task_id?: string;
    TaskId?: string;
  };
}

export class VolcengineEnhanceProvider {
  private uploadDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private submitApi: (body: Record<string, unknown>) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queryApi: (body: Record<string, unknown>) => Promise<any>;

  constructor(params?: {
    accessKey?: string;
    secretKey?: string;
    uploadDir?: string;
    region?: string;
  }) {
    const accessKey =
      params?.accessKey ||
      process.env.VOLCENGINE_ENHANCE_ACCESS_KEY ||
      process.env.JIMENG_ACCESS_KEY ||
      "";
    const secretKey =
      params?.secretKey ||
      process.env.VOLCENGINE_ENHANCE_SECRET_KEY ||
      process.env.JIMENG_SECRET_KEY ||
      "";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    const region = params?.region || "cn-north-1";

    // AI MediaKit 使用 open.volcengineapi.com，服务名为 ai_media_kit
    // 注意：若官方文档有更新，请调整 service 与 version 参数
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new (Service as any)({
      service: "ai_media_kit",
      version: "2024-01-01",
      host: "open.volcengineapi.com",
      region,
    });
    svc.setAccessKeyId(accessKey);
    svc.setSecretKey(secretKey);

    // 提交画质增强任务：文档 https://www.volcengine.com/docs/6448/2279230
    this.submitApi = svc.createJSONAPI("SubmitVideoEnhanceTask", {
      Version: "2024-01-01",
    });
    // 查询任务信息（通用）：文档 https://www.volcengine.com/docs/6448/2278532
    this.queryApi = svc.createJSONAPI("GetVideoEnhanceTask", {
      Version: "2024-01-01",
    });
  }

  /**
   * 对给定视频文件执行画质增强，返回增强后本地保存的文件路径。
   *
   * @param videoPathOrUrl 待增强视频的本地路径或可公开访问的 URL
   * @param publicBaseUrl  当 videoPathOrUrl 是本地路径时，将其转为外网可访问 URL 的前缀
   *                       （如 "https://yourdomain.com/uploads"），若为空则原路透传
   */
  async enhanceVideo(
    videoPathOrUrl: string,
    publicBaseUrl?: string
  ): Promise<string> {
    // 确定视频公网 URL（API 需要可访问的 URL，不接受本地路径）
    const videoUrl = this.resolvePublicUrl(videoPathOrUrl, publicBaseUrl);
    if (!videoUrl) {
      throw new Error(
        "[VolcengineEnhance] Cannot resolve public URL for video. " +
          "Set NEXT_PUBLIC_BASE_URL or pass publicBaseUrl to provide an accessible URL."
      );
    }

    console.log(`[VolcengineEnhance] Submitting enhance task for: ${videoUrl}`);

    // 提交任务
    const taskId = await this.submitTask(videoUrl);
    console.log(`[VolcengineEnhance] Task submitted: ${taskId}`);

    // 轮询结果
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
  private async submitTask(videoUrl: string): Promise<string> {
    let response: EnhanceSubmitResponse;
    try {
      response = await this.submitApi({
        // 参考 https://www.volcengine.com/docs/6448/2279230
        // 注意：如果实际 API 参数名不同（如 video_url / VideoUrl），请根据文档调整
        VideoUrl: videoUrl,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[VolcengineEnhance] Submit SDK error: ${msg}`);
    }

    if (response.ResponseMetadata?.Error) {
      throw new Error(
        `[VolcengineEnhance] Submit API error: ${response.ResponseMetadata.Error.Message}`
      );
    }

    // 兼容不同版本的响应结构
    const taskId =
      response.TaskId ||
      response.data?.task_id ||
      response.data?.TaskId;

    if (!taskId) {
      throw new Error(
        `[VolcengineEnhance] No task_id in submit response: ${JSON.stringify(response)}`
      );
    }
    return taskId;
  }

  /** 轮询任务状态，返回增强后视频 URL */
  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 60; // 最多等 5 分钟（60 × 5s）
    const interval = 5_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      let response: EnhanceQueryResponse;
      try {
        response = await this.queryApi({ TaskId: taskId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[VolcengineEnhance] Poll attempt ${i + 1} error: ${msg}`);
        continue;
      }

      if (response.ResponseMetadata?.Error) {
        console.warn(
          `[VolcengineEnhance] Poll API error: ${response.ResponseMetadata.Error.Message}`
        );
        continue;
      }

      // 兼容多种响应结构
      const status =
        response.Status ||
        response.data?.status ||
        response.data?.Status ||
        "";
      const outputUrl =
        response.OutputVideoUrl ||
        response.data?.output_video_url ||
        response.data?.OutputVideoUrl;

      console.log(
        `[VolcengineEnhance] Poll ${i + 1}: status=${status}`
      );

      if ((status === "Success" || status === "success" || status === "done") && outputUrl) {
        return outputUrl;
      }

      if (status === "Failed" || status === "failed") {
        throw new Error(
          `[VolcengineEnhance] Enhancement task failed. Response: ${JSON.stringify(response)}`
        );
      }
    }

    throw new Error(
      "[VolcengineEnhance] Enhancement timed out after 5 minutes"
    );
  }

  /** 将本地路径或 URL 解析为可公开访问的 URL */
  private resolvePublicUrl(
    videoPathOrUrl: string,
    publicBaseUrl?: string
  ): string | null {
    // 已经是 http(s) URL，直接使用
    if (
      videoPathOrUrl.startsWith("http://") ||
      videoPathOrUrl.startsWith("https://")
    ) {
      return videoPathOrUrl;
    }

    // 本地路径：需要 publicBaseUrl 拼接为可访问 URL
    const base =
      publicBaseUrl ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.VOLCENGINE_ENHANCE_BASE_URL ||
      "";
    if (!base) return null;

    // 尝试提取相对于 uploads 目录的相对路径
    const uploadDir = (process.env.UPLOAD_DIR || "./uploads").replace(
      /\/+$/,
      ""
    );
    const relative = videoPathOrUrl.replace(uploadDir, "").replace(/^\/+/, "");
    return `${base.replace(/\/+$/, "")}/uploads/${relative}`;
  }
}
