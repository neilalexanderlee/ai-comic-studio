import OpenAI, { APIError } from "openai";
import { ensureArkApiV3BaseUrl } from "../ark-base-url";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private defaultModel: string;
  private uploadDir: string;
  /** 规范化后的 baseURL，用于 404 时提示（SDK 会请求 `${baseURL}/images/generations`） */
  private readonly resolvedBaseUrl: string;

  constructor(params?: { apiKey?: string; baseURL?: string; model?: string; uploadDir?: string; }) {
    const apiKey = (params?.apiKey || process.env.OPENAI_API_KEY)?.trim();
    const rawBase = (params?.baseURL ?? process.env.OPENAI_BASE_URL)?.trim();
    const baseURL = rawBase
      ? ensureArkApiV3BaseUrl(rawBase.replace(/\/+$/, ""))
      : undefined;
    this.resolvedBaseUrl = baseURL ?? "https://api.openai.com/v1（OpenAI 默认）";
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
    this.defaultModel = params?.model || process.env.OPENAI_MODEL || "gpt-4o";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    if (options?.images?.length) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [];
      for (const imgPath of options.images) {
        try {
          const resolved = path.resolve(imgPath);
          if (fs.existsSync(resolved)) {
            const data = fs.readFileSync(resolved).toString("base64");
            const ext = path.extname(resolved).toLowerCase();
            const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
            content.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } });
          }
        } catch { /* skip unreadable */ }
      }
      content.push({ type: "text", text: prompt });
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const response = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    });
    return response.choices[0]?.message?.content || "";
  }

  /**
   * Convert a local file path to a base64 data URI.
   * Seedream 5.0 接受 "data:image/<ext>;base64,<data>" 格式。
   * @see https://www.volcengine.com/docs/82379/1541523
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

  /**
   * Build shared compatible params for Seedream (non-DALL-E) image requests.
   */
  private buildSeedreamCompatParams(options?: ImageOptions): Record<string, unknown> {
    const compatParams: Record<string, unknown> = {};
    if (options?.size) compatParams.size = options.size;
    if (options?.aspectRatio) compatParams.aspect_ratio = options.aspectRatio;
    if (!options?.size && !options?.aspectRatio) compatParams.aspect_ratio = "16:9";
    // Seedream 默认带水印，显式关闭
    compatParams.watermark = false;

    // Seedream 5.0/4.5/4.0 通过 `image` 参数传入参考图实现角色/风格一致性。
    // 文档：最多 14 张参考图，格式为 URL 字符串或 "data:image/<ext>;base64,..." 字符串。
    if (options?.referenceImages && options.referenceImages.length > 0) {
      const imageRefs: string[] = [];
      for (const ref of options.referenceImages) {
        if (ref.startsWith("http://") || ref.startsWith("https://")) {
          imageRefs.push(ref);
        } else {
          const dataUri = this.fileToBase64DataUri(ref);
          if (dataUri) imageRefs.push(dataUri);
        }
      }
      const capped = imageRefs.slice(0, 14);
      if (capped.length > 0) {
        compatParams.image = capped.length === 1 ? capped[0] : capped;
        console.log(`[OpenAI/Seedream] image refs: ${capped.length} ref(s)`);
      }
    }

    // Seedream 5.0-lite: sequential_image_generation 开启连贯批量分镜生成
    if (options?.sequentialImageGeneration === 'auto') {
      compatParams.sequential_image_generation = 'auto';
    }

    return compatParams;
  }

  /** 下载单个图片 URL 并保存到本地 frames 目录，返回文件路径。 */
  private async downloadImageUrl(imageUrl: string): Promise<string> {
    const imageResponse = await fetch(imageUrl);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const filename = `${ulid()}.png`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || this.defaultModel;
    const isDallE = model.startsWith("dall-e");

    // 豆包 Seedream：方舟「图片生成 API」，OpenAI 兼容 POST /images/generations
    // @see https://www.volcengine.com/docs/82379/1541523
    const compatParams = isDallE ? {} : this.buildSeedreamCompatParams(options);

    let response: OpenAI.ImagesResponse;
    try {
      response = await ((this.client.images.generate as unknown) as (params: Record<string, unknown>) => Promise<OpenAI.ImagesResponse>)({
        model,
        prompt,
        ...(isDallE && {
          size: (["1024x1024", "1792x1024", "1024x1792"].includes(options?.size ?? "")
            ? options!.size
            : "1792x1024") as "1024x1024" | "1792x1024" | "1024x1792",
          quality: (options?.quality as "standard" | "hd") || "standard",
        }),
        ...compatParams,
        n: 1,
      });
    } catch (e: unknown) {
      if (e instanceof APIError && e.status === 404) {
        throw new Error(
          `图像接口 404：当前 SDK 会请求「${this.resolvedBaseUrl}/images/generations」。` +
            `若使用火山方舟/豆包 Seedream，Base URL 一般为 https://ark.<地域>.volces.com/api/v3（勿漏 /api/v3）；` +
            `模型须填控制台里支持「图片生成」的 Endpoint ID。` +
            `若走自建网关，需确认已转发 OpenAI 兼容的 /images/generations。` +
            `（原始错误：${e.message}）`
        );
      }
      throw e;
    }

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) throw new Error("No image URL returned from OpenAI");

    // 在下载前把公网 URL 回传给调用方，可直接用于 Seedance 视频生成请求
    options?.onRemoteUrl?.(imageUrl);

    return this.downloadImageUrl(imageUrl);
  }

  /**
   * 批量生成连贯分镜帧序列（Seedream 5.0-lite sequential_image_generation）。
   *
   * 当模型支持 sequential_image_generation 时，将所有 prompts 合并为一次 API 调用，
   * 生成风格/角色高度一致的多张图片（最多 15 张）。API 返回多个 URL。
   *
   * 若模型不支持批量生成（如 DALL-E），则退化为逐张调用 generateImage。
   *
   * @param prompts 每张分镜帧的提示词，按顺序排列（最多 15 个）
   * @param options 共用图片选项（referenceImages、aspectRatio 等）
   */
  async generateImages(prompts: string[], options?: ImageOptions): Promise<string[]> {
    if (!prompts.length) return [];

    const model = options?.model || this.defaultModel;
    const isDallE = model.startsWith("dall-e");

    // DALL-E 不支持批量，退化为逐张生成
    if (isDallE) {
      const results: string[] = [];
      for (const p of prompts) {
        results.push(await this.generateImage(p, options));
      }
      return results;
    }

    // Seedream: 单次批量调用（最多 15 张）
    const batchSize = 15;
    if (prompts.length > batchSize) {
      console.warn(`[OpenAI/Seedream] generateImages: ${prompts.length} prompts exceeds max ${batchSize}. Truncating.`);
    }
    const batch = prompts.slice(0, batchSize);

    // 将多条提示词拼接为序列提示（使用官方推荐格式：分镜编号 + 描述）
    const combinedPrompt = batch
      .map((p, i) => `[分镜${i + 1}] ${p}`)
      .join("\n\n");

    const compatParams = this.buildSeedreamCompatParams({
      ...options,
      sequentialImageGeneration: 'auto',  // 启用顺序批量生成
    });

    console.log(`[OpenAI/Seedream] generateImages: ${batch.length} frames via sequential_image_generation`);

    let response: OpenAI.ImagesResponse;
    try {
      response = await ((this.client.images.generate as unknown) as (params: Record<string, unknown>) => Promise<OpenAI.ImagesResponse>)({
        model,
        prompt: combinedPrompt,
        ...compatParams,
        n: batch.length,
      });
    } catch (e: unknown) {
      // 若 sequential_image_generation 不被当前模型支持，退化为逐张生成
      console.warn(`[OpenAI/Seedream] generateImages batch failed (${(e as Error).message}), falling back to sequential single calls`);
      const results: string[] = [];
      for (const p of prompts) {
        results.push(await this.generateImage(p, options));
      }
      return results;
    }

    // 下载所有返回图片（可能少于 n，取实际返回数量）
    const urls = (response.data ?? []).map((d) => d.url).filter(Boolean) as string[];
    if (!urls.length) throw new Error("No images returned from sequential generateImages call");

    const filepaths: string[] = [];
    for (const url of urls) {
      filepaths.push(await this.downloadImageUrl(url));
    }

    console.log(`[OpenAI/Seedream] generateImages: downloaded ${filepaths.length}/${batch.length} frames`);
    return filepaths;
  }
}
