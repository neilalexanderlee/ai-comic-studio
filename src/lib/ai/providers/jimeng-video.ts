/**
 * JimengVideoProvider
 *
 * 接入即梦AI视频生成接口（火山引擎 Visual API）。
 * 参考文档：https://www.volcengine.com/docs/85621/1791184
 * 版本：视频生成 3.0 720P · 图生视频 · 首尾帧
 *
 * 认证：火山引擎 AccessKey / SecretKey（AK/SK）。
 * 接口流程：
 *   1. CVSync2AsyncSubmitTask  提交异步任务，获取 task_id
 *   2. CVSync2AsyncGetResult   轮询任务状态，获取 video_urls
 *
 * model 参数对应 req_key，即调用的模型端点。常用值：
 *   - jimeng_i2v_v30   图生视频 3.0 720P（首尾帧 / 首帧）
 *   请以实际开放平台文档为准。
 *
 * 支持的生成模式（对应 VideoGenerateParams）：
 *   - KeyframeVideoParams (firstFrame + lastFrame)：首尾帧模式
 *   - ReferenceVideoParams (initialImage)：首帧/参考图模式
 */
import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
// @ts-ignore
import { Service } from "@volcengine/openapi";

/** 本地文件 → base64 Data URL */
function toBase64DataUrl(filePath: string): string {
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

/** 支持本地路径或 http(s) URL */
function toImageInput(imagePathOrUrl: string): string {
  if (
    imagePathOrUrl.startsWith("http://") ||
    imagePathOrUrl.startsWith("https://")
  ) {
    return imagePathOrUrl;
  }
  return toBase64DataUrl(imagePathOrUrl);
}

export class JimengVideoProvider implements VideoProvider {
  private accessKey: string;
  private secretKey: string;
  private baseUrl: string;
  /** req_key，对应具体的即梦视频生成模型端点 */
  private model: string;
  private uploadDir: string;
  private region: string;
  private visualService: unknown;

  constructor(params?: {
    apiKey?: string;
    secretKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
    region?: string;
  }) {
    this.accessKey = params?.apiKey || process.env.JIMENG_ACCESS_KEY || "";
    this.secretKey = params?.secretKey || process.env.JIMENG_SECRET_KEY || "";
    this.baseUrl = (params?.baseUrl || "https://visual.volcengineapi.com").replace(/\/+$/, "");
    this.model = params?.model || "jimeng_i2v_v30";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.region = params?.region || "cn-north-1";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new (Service as any)({
      service: "cv",
      version: "2022-08-31",
      host: this.baseUrl.replace(/^https?:\/\//, ""),
      region: this.region,
    });
    svc.setAccessKeyId(this.accessKey);
    svc.setSecretKey(this.secretKey);
    this.visualService = svc;
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const imageUrls: string[] = [];

    if ("firstFrame" in params && params.firstFrame) {
      imageUrls.push(toImageInput(params.firstFrame));
      if (params.lastFrame) {
        imageUrls.push(toImageInput(params.lastFrame));
      }
    } else if ("initialImage" in params && params.initialImage) {
      imageUrls.push(toImageInput(params.initialImage));
    }

    const submitBody: Record<string, unknown> = {
      req_key: this.model,
      prompt: params.prompt,
      aspect_ratio: params.ratio || "16:9",
      duration: params.duration || 5,
    };

    if (imageUrls.length > 0) {
      submitBody.image_urls = imageUrls;
    }

    console.log(
      `[JimengVideo] Submitting task: req_key=${this.model}, ` +
        `images=${imageUrls.length}, ratio=${submitBody.aspect_ratio}, duration=${submitBody.duration}`
    );

    const taskId = await this.submitTask(submitBody);
    console.log(`[JimengVideo] Task submitted: ${taskId}`);

    const videoUrl = await this.pollForResult(taskId);

    // 下载并保存到本地
    const videoRes = await fetch(videoUrl);
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const filename = `${ulid()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[JimengVideo] Saved to ${filepath}`);
    return { filePath: filepath };
  }

  private async submitTask(body: Record<string, unknown>): Promise<string> {
    const action = "CVSync2AsyncSubmitTask";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = this.visualService as any;
      const response = await svc.request(action, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (response.ResponseMetadata?.Error) {
        throw new Error(
          `Jimeng Video submit error: ${response.ResponseMetadata.Error.Message}`
        );
      }

      const taskId = response.data?.task_id;
      if (!taskId) {
        throw new Error(
          `Jimeng Video submit failed: no task_id in response. Raw: ${JSON.stringify(response)}`
        );
      }
      return taskId as string;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Jimeng Video SDK request failed: ${msg}`);
    }
  }

  private async pollForResult(taskId: string): Promise<string> {
    const action = "CVSync2AsyncGetResult";
    const maxAttempts = 120; // 最多等 10 分钟（120 × 5s）
    const body = { req_key: this.model, task_id: taskId };

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svc = this.visualService as any;
        const response = await svc.request(action, {
          method: "POST",
          body: JSON.stringify(body),
        });

        if (response.ResponseMetadata?.Error) {
          throw new Error(
            `Jimeng Video poll error: ${response.ResponseMetadata.Error.Message}`
          );
        }

        const status = response.data?.status as string | undefined;
        console.log(`[JimengVideo] Poll ${i + 1}: status=${status}`);

        if (status === "done" || status === "success") {
          const videoUrls = response.data?.video_urls as string[] | undefined;
          if (!videoUrls || videoUrls.length === 0) {
            throw new Error("Jimeng Video: no video_urls in result");
          }
          return videoUrls[0];
        }

        if (status === "failed") {
          throw new Error(
            `Jimeng Video generation failed: ${(response.data?.status_msg as string) || "unknown"}`
          );
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[JimengVideo] Poll attempt ${i + 1} failed: ${msg}`);
      }
    }

    throw new Error("Jimeng Video generation timed out after 10 minutes");
  }
}
