/**
 * JimengVideoProvider
 *
 * 接入即梦AI视频生成接口（火山引擎 Visual API）。
 * 参考文档：
 *   - 720P（含首帧 / 首尾帧等，单一 req_key）：https://www.volcengine.com/docs/85621/1792710
 *   - 1080P（官方按模式拆分 req_key）：https://www.volcengine.com/docs/85621/1792711
 * 版本：视频生成 3.0（720P / 1080P）· 图生视频 · 首尾帧
 *
 * 认证：火山引擎 AccessKey / SecretKey（AK/SK）。
 * 接口流程：
 *   1. CVSync2AsyncSubmitTask  提交异步任务，获取 task_id
 *   2. CVSync2AsyncGetResult   轮询任务状态，获取 video_urls
 *
 * model 参数对应 req_key（或本库别名）。设置里只暴露两项即可：
 *   - jimeng_i2v_v30       720P，官方 `jimeng_i2v_v30` 即支持首帧与首尾帧等（见 720P 总文档）
 *   - jimeng_i2v_v30_1080  1080P 别名：无图 / 一图 / 两图时分别映射为文生、首帧、首尾帧对应 req_key（见 resolveJimengVideoReqKey）
 * 若需直连官方字符串，仍可把 model 配成如 `jimeng_i2v_first_v30_1080` 等。
 *
 * 支持的生成模式（对应 VideoGenerateParams）：
 *   - KeyframeVideoParams (firstFrame + lastFrame)：首尾帧模式
 *   - ReferenceVideoParams (initialImage)：首帧/参考图模式
 */
import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
// @ts-ignore
import { Service } from "@volcengine/openapi";
import { downloadVideoWithRetry } from "./download-with-retry";

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

/**
 * 1080P 在火山文档里按「文生 / 首帧 / 首尾帧」使用不同 req_key；720P 则可用单一 `jimeng_i2v_v30`。
 * 这里用别名 `jimeng_i2v_v30_1080` 在提交前按图片数量自动选对官方 key，避免在 UI 里列一长串。
 * @see https://www.volcengine.com/docs/85621/1792711
 */
export function resolveJimengVideoReqKey(
  configuredModel: string,
  imageCount: number
): string {
  if (configuredModel !== "jimeng_i2v_v30_1080") {
    return configuredModel;
  }
  if (imageCount === 0) {
    return "jimeng_t2v_v30_1080p";
  }
  if (imageCount === 1) {
    return "jimeng_i2v_first_v30_1080";
  }
  return "jimeng_i2v_first_tail_v30_1080";
}

function trimCred(v?: string): string {
  return (v ?? "").trim();
}

export class JimengVideoProvider implements VideoProvider {
  private accessKey: string;
  private secretKey: string;
  private baseUrl: string;
  /** req_key，对应具体的即梦视频生成模型端点 */
  private model: string;
  private uploadDir: string;
  private region: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private submitApi: (body: Record<string, unknown>) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pollApi: (body: Record<string, unknown>) => Promise<any>;

  constructor(params?: {
    apiKey?: string;
    secretKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
    region?: string;
  }) {
    this.accessKey =
      trimCred(params?.apiKey) || trimCred(process.env.JIMENG_ACCESS_KEY) || "";
    this.secretKey =
      trimCred(params?.secretKey) || trimCred(process.env.JIMENG_SECRET_KEY) || "";
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
    this.submitApi = svc.createJSONAPI("CVSync2AsyncSubmitTask", { Version: "2022-08-31" });
    this.pollApi   = svc.createJSONAPI("CVSync2AsyncGetResult",  { Version: "2022-08-31" });
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

    const reqKey = resolveJimengVideoReqKey(this.model, imageUrls.length);

    const submitBody: Record<string, unknown> = {
      req_key: reqKey,
      prompt: params.prompt,
      aspect_ratio: params.ratio || "16:9",
      duration: params.duration || 5,
    };

    if (imageUrls.length > 0) {
      submitBody.image_urls = imageUrls;
    }

    console.log(
      `[JimengVideo] Submitting task: req_key=${reqKey}` +
        (reqKey !== this.model ? ` (from model=${this.model})` : "") +
        `, images=${imageUrls.length}, ratio=${submitBody.aspect_ratio}, duration=${submitBody.duration}`
    );

    const taskId = await this.submitTask(submitBody);
    console.log(`[JimengVideo] Task submitted: ${taskId}`);

    const videoUrl = await this.pollForResult(taskId, reqKey);
    await params.onRemoteResult?.({ videoUrl, taskId });

    const filepath = await downloadVideoWithRetry(videoUrl, this.uploadDir, {
      logPrefix: "JimengVideoDownload",
    });

    console.log(`[JimengVideo] Saved to ${filepath}`);
    return { filePath: filepath, remoteVideoUrl: videoUrl, remoteTaskId: taskId };
  }

  private async submitTask(body: Record<string, unknown>): Promise<string> {
    try {
      const response = await this.submitApi(body);

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

  private async pollForResult(taskId: string, reqKey: string): Promise<string> {
    const action = "CVSync2AsyncGetResult";
    const maxAttempts = 120; // 最多等 10 分钟（120 × 5s）
    const body = { req_key: reqKey, task_id: taskId };

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      let response: Awaited<ReturnType<typeof this.pollApi>>;
      try {
        response = await this.pollApi(body);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[JimengVideo] Poll attempt ${i + 1} failed: ${msg}`);
        continue;
      }

      if (response.ResponseMetadata?.Error) {
        const msg = response.ResponseMetadata.Error.Message;
        console.warn(`[JimengVideo] Poll attempt ${i + 1} failed: ${msg}`);
        continue;
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
    }

    throw new Error("Jimeng Video generation timed out after 10 minutes");
  }
}
