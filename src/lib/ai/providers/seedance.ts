import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

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

// Accepts either a local file path or an http(s) URL
function toImageUrl(imagePathOrUrl: string): string {
  if (imagePathOrUrl.startsWith("http://") || imagePathOrUrl.startsWith("https://")) {
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
    this.apiKey = params?.apiKey || process.env.SEEDANCE_API_KEY || "";
    this.baseUrl = (
      params?.baseUrl ||
      process.env.SEEDANCE_BASE_URL ||
      "https://ark.cn-beijing.volces.com/api/v3"
    ).replace(/\/+$/, "");
    this.model =
      params?.model || process.env.SEEDANCE_MODEL || "doubao-seedance-1-5-pro-250528";
    this.uploadDir =
      params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const body = "firstFrame" in params
      ? this.buildKeyframeBody(params as VideoGenerateParams & { firstFrame: string; lastFrame: string })
      : this.buildReferenceBody(params as VideoGenerateParams & { initialImage: string });

    console.log(
      `[Seedance] Submitting task: model=${body.model}, duration=${body.duration}, ratio=${body.ratio}`
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

    const videoResponse = await fetch(videoUrl);
    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    const filename = `${ulid()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return { filePath: filepath, lastFrameUrl };
  }

  private buildKeyframeBody(params: VideoGenerateParams & { firstFrame: string; lastFrame: string }): Record<string, unknown> {
    return {
      model: this.model,
      content: [
        { type: "text", text: params.prompt },
        { type: "image_url", image_url: { url: toDataUrl(params.firstFrame) }, role: "first_frame" },
        { type: "image_url", image_url: { url: toDataUrl(params.lastFrame) }, role: "last_frame" },
      ],
      duration: params.duration || 5,
      ratio: params.ratio || "16:9",
      watermark: false,
    };
  }

  // Reference mode: use a single initial image (character reference or previous shot's last frame)
  private buildReferenceBody(params: VideoGenerateParams & { initialImage: string }): Record<string, unknown> {
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

  private async pollForResult(taskId: string): Promise<{ videoUrl: string; lastFrameUrl?: string }> {
    const maxAttempts = 120;
    const interval = 5000;

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
