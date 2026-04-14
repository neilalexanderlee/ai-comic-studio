import OpenAI from "openai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private defaultModel: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseURL?: string; model?: string; uploadDir?: string; }) {
    this.client = new OpenAI({
      apiKey: params?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: params?.baseURL || process.env.OPENAI_BASE_URL,
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

    // Build extra params for non-DALL-E OpenAI-compatible providers (e.g. seedream, doubao).
    // These APIs typically accept `size` as "WxH" and/or `aspect_ratio` as "W:H".
    const compatParams: Record<string, unknown> = {};
    if (!isDallE) {
      if (options?.size) compatParams.size = options.size;
      if (options?.aspectRatio) compatParams.aspect_ratio = options.aspectRatio;
      if (!options?.size && !options?.aspectRatio) compatParams.aspect_ratio = "16:9";
    }

    const response = await ((this.client.images.generate as unknown) as (params: Record<string, unknown>) => Promise<OpenAI.ImagesResponse>)({
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
