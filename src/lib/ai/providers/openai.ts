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

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || this.defaultModel;
    const isDallE = model.startsWith("dall-e");

    // 豆包 Seedream：方舟「图片生成 API」，OpenAI 兼容 POST /images/generations
    // @see https://www.volcengine.com/docs/82379/1541523
    // Build extra params for non-DALL-E OpenAI-compatible providers (e.g. seedream, doubao).
    // These APIs typically accept `size` as "WxH" and/or `aspect_ratio` as "W:H".
    const compatParams: Record<string, unknown> = {};
    if (!isDallE) {
      if (options?.size) compatParams.size = options.size;
      if (options?.aspectRatio) compatParams.aspect_ratio = options.aspectRatio;
      if (!options?.size && !options?.aspectRatio) compatParams.aspect_ratio = "16:9";
    }

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

    const imageResponse = await fetch(imageUrl);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const filename = `${ulid()}.png`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }
}
