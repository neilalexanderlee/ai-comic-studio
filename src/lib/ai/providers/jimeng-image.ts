/**
 * JimengImageProvider
 *
 * 接入即梦AI图片生成接口（火山引擎 Visual API）。
 * 参考文档：https://www.volcengine.com/docs/85621/2288388
 *
 * 认证：火山引擎 AccessKey / SecretKey（AK/SK）。
 * 接口流程：
 *   1. CVSync2AsyncSubmitTask  提交异步任务，获取 task_id
 *   2. CVSync2AsyncGetResult   轮询任务状态，获取 image_urls
 *
 * model 参数对应 req_key，即调用的模型端点。常用值：
 *   - jimeng_high_aes_general_v21_L  即梦图片生成（通用）
 *   请以实际开放平台文档为准。
 */
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
// @ts-ignore
import { Service } from "@volcengine/openapi";

function trimCred(v?: string): string {
  return (v ?? "").trim();
}

export class JimengImageProvider implements AIProvider {
  private accessKey: string;
  private secretKey: string;
  private baseUrl: string;
  /** req_key，对应具体的即梦图片生成模型端点 */
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
    this.model = params?.model || "jimeng_high_aes_general_v21_L";
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

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("JimengImage does not support text generation");
  }

  /**
   * Convert a local file path to a base64 data URI so it can be used as an ip_element URL.
   * Jimeng ip_elements accepts both public URLs and base64 data URIs.
   */
  private fileToBase64DataUri(filePath: string): string | null {
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase() || "png";
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    // 解析尺寸 / 宽高比 → width / height
    let width = 1024;
    let height = 1024;

    if (options?.size) {
      const parts = options.size.toLowerCase().split("x");
      if (parts.length === 2) {
        width = parseInt(parts[0]) || 1024;
        height = parseInt(parts[1]) || 1024;
      }
    } else if (options?.aspectRatio) {
      const [w, h] = options.aspectRatio.split(":").map(Number);
      if (w && h) {
        const base = 1024;
        const scale = base / Math.max(w, h);
        width = Math.round(w * scale);
        height = Math.round(h * scale);
      }
    }

    const submitBody: Record<string, unknown> = {
      req_key: this.model,
      prompt,
      width,
      height,
    };

    // Add character reference images via ip_elements (subject/character consistency)
    // Each reference image is passed as a base64 data URI with ip_adapter_scale=0.6
    if (options?.referenceImages && options.referenceImages.length > 0) {
      const ipElements: Array<{ url: string; ip_adapter_scale: number }> = [];
      for (const refPath of options.referenceImages) {
        // Skip if it looks like a URL (already a web resource)
        if (refPath.startsWith("http://") || refPath.startsWith("https://")) {
          ipElements.push({ url: refPath, ip_adapter_scale: 0.6 });
        } else {
          const dataUri = this.fileToBase64DataUri(refPath);
          if (dataUri) ipElements.push({ url: dataUri, ip_adapter_scale: 0.6 });
        }
      }
      if (ipElements.length > 0) {
        submitBody.ip_elements = ipElements;
        console.log(`[JimengImage] Using ${ipElements.length} character reference image(s)`);
      }
    }

    const taskId = await this.submitTask(submitBody);
    console.log(`[JimengImage] Task submitted: ${taskId}`);

    const imageUrl = await this.pollForResult(taskId);

    // 下载并保存到本地
    const imageRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const ext = imageUrl.split("?")[0].split(".").pop() || "png";
    const filename = `${ulid()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[JimengImage] Saved to ${filepath}`);
    return filepath;
  }

  private async submitTask(body: Record<string, unknown>): Promise<string> {
    try {
      const response = await this.submitApi(body);

      if (response.ResponseMetadata?.Error) {
        throw new Error(
          `Jimeng Image submit error: ${response.ResponseMetadata.Error.Message}`
        );
      }

      const taskId = response.data?.task_id;
      if (!taskId) {
        throw new Error(
          `Jimeng Image submit failed: no task_id in response. Raw: ${JSON.stringify(response)}`
        );
      }
      return taskId as string;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Jimeng Image SDK request failed: ${msg}`);
    }
  }

  private async pollForResult(taskId: string): Promise<string> {
    const action = "CVSync2AsyncGetResult";
    const maxAttempts = 60; // 最多等 5 分钟（60 × 5s）
    const body = { req_key: this.model, task_id: taskId };

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      try {
        const response = await this.pollApi(body);

        if (response.ResponseMetadata?.Error) {
          throw new Error(
            `Jimeng Image poll error: ${response.ResponseMetadata.Error.Message}`
          );
        }

        const status = response.data?.status as string | undefined;
        console.log(`[JimengImage] Poll ${i + 1}: status=${status}`);

        if (status === "done" || status === "success") {
          const urls = response.data?.image_urls as string[] | undefined;
          if (!urls || urls.length === 0) {
            throw new Error("Jimeng Image: no image_urls in result");
          }
          return urls[0];
        }

        if (status === "failed") {
          throw new Error(
            `Jimeng Image generation failed: ${(response.data?.status_msg as string) || "unknown"}`
          );
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[JimengImage] Poll attempt ${i + 1} failed: ${msg}`);
        // 非致命错误继续轮询
      }
    }

    throw new Error("Jimeng Image generation timed out after 5 minutes");
  }
}
