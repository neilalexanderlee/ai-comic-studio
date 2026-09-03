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
import { resolveVideoCapability, type VideoModelCapability, type VideoMode } from "../video-capabilities";
import type { VideoProvider, VideoGenerateParams, VideoGenerateResult, MultimodalRefItem } from "../types";
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

// 支持本地路径、http(s) URL，或火山方舟私域素材库的 asset:// 引用（图片）
function toImageUrl(imagePathOrUrl: string): string {
  if (
    imagePathOrUrl.startsWith("http://") ||
    imagePathOrUrl.startsWith("https://") ||
    imagePathOrUrl.startsWith("asset://")
  ) {
    // asset:// 是私域虚拟人像素材资产库注册后的永久引用，原样传给 Seedance API，
    // 绕过真人人脸拦截（见 ark-asset-library.ts）。不能走 toDataUrl（本地无此文件）。
    return imagePathOrUrl;
  }
  return toDataUrl(imagePathOrUrl);
}

/**
 * 参考视频 URL。Seedance 2.5 的参考视频**只接受视频 URL 或素材 ID，不支持 base64**
 * （教程「使用限制 › 视频要求」），所以这里遇到本地路径必须直接抛错而不是降级成 data URI —
 * 静默降级会让任务提交后才异步报错，排查成本高得多。
 */
function toVideoUrl(videoPathOrUrl: string): string {
  if (
    videoPathOrUrl.startsWith("http://") ||
    videoPathOrUrl.startsWith("https://") ||
    videoPathOrUrl.startsWith("asset://")
  ) {
    return videoPathOrUrl;
  }
  throw new Error(
    `Seedance 参考视频只接受公网 URL 或 asset:// 素材引用，不支持本地路径（收到：${videoPathOrUrl}）。` +
      `请先将视频上传到对象存储后再传入其公网地址。`
  );
}

// 音频文件转 data URI（仅本地路径）
function toAudioDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "mp3" ? "audio/mpeg" :
    ext === "wav" ? "audio/wav" :
    ext === "m4a" ? "audio/mp4" :
    ext === "ogg" ? "audio/ogg" :
    ext === "flac" ? "audio/flac" :
    "audio/mpeg"; // fallback
  const base64 = fs.readFileSync(filePath, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}


export class SeedanceProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  /** 当前模型的能力描述符（时长区间、参考上限、输出格式等），见 video-capabilities.ts */
  private capability: VideoModelCapability;

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
    this.capability = resolveVideoCapability(this.model, "seedance");
  }

  /**
   * Seedance 2.5 与 2.0 的请求体差异（官方教程）：
   *   - 全模态参考生视频必须显式传 omni_reference_task_type，否则模型可能把任务判定成
   *     视频编辑/延长，触发异步报错 InvalidParameter.TaskTypeConstraint
   *   - 首帧/首尾帧任务的 ratio 强制 adaptive（这一条由 route 通过能力表的
   *     ratioLockedModes 传入，provider 侧只做兜底断言）
   *   - 支持 reference_video 参考素材与 mov 输出
   *
   * 注意这里用 model id 判断而不是读能力表：能力表描述的是「各家 provider 之间可比较的能力」，
   * 而请求体长什么样是**火山自己两个 API 版本之间**的差异，属于本 provider 的内部知识。
   */
  private isSeedance25(): boolean {
    return this.model.toLowerCase().includes("seedance-2-5");
  }

  /**
   * 是否需要显式声明 `omni_reference_task_type`。
   *
   * 2.5 和 2.0 mini 的模型元数据里 `task_type` 都同时含 `MultimodalToVideo` /
   * `VideoEditing` / `VideoExtension` —— 不显式声明子任务类型时，模型会按提示词意图
   * 自行判定，判成 edit/extend 后会因 ratio/duration 不符合那两类任务的限制而**异步**报错。
   * 实测 mini 接受这个参数（同一请求的报错落在别的参数上，说明它本身没被拒）。
   * 传了无害、不传有风险，所以两者都传。
   */
  private needsOmniReferenceTaskType(): boolean {
    const m = this.model.toLowerCase();
    return m.includes("seedance-2-5") || m.includes("seedance-2-0-mini");
  }

  /**
   * 获取服务层级：优先使用调用方传入的值，其次读取环境变量 SEEDANCE_SERVICE_TIER，默认不传（即 auto）。
   * 'flex' 模式成本降低约 50%，但生成时间更长，适合非实时批量任务。
   *
   * ⚠️ 这个参数**不是所有模式都接受**。参考生视频（r2v）下传它会被同步拒绝：
   * `InvalidParameter: the specified parameter service_tier is not supported for
   *  model doubao-seedance-2-0 in r2v, must be empty`。
   * 哪些模式接受由能力表的 `features.serviceTierModes` 说了算 —— 不接受的模式
   * 这里直接吞掉，而不是让调用方去记住这条约束（换模型时它还会变）。
   */
  private resolveServiceTier(
    mode: VideoMode,
    requested?: 'auto' | 'flex'
  ): string | undefined {
    if (!this.capability.features.serviceTierModes.includes(mode)) return undefined;
    const tier = requested ?? (process.env.SEEDANCE_SERVICE_TIER as 'auto' | 'flex' | undefined);
    if (tier === 'flex') return 'flex';
    return undefined; // 不传则使用 API 默认（auto）
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const isKeyframe = "anchorFirst" in params && !!params.anchorFirst;
    const isMultimodal = "multimodalRefs" in params && !!params.multimodalRefs;
    const buildBody = (useRemoteUrls: boolean) => {
      if (isMultimodal) {
        // 多模态参考模式不依赖远端 URL，始终用本地文件
        const body = this.buildMultimodalBody(params as VideoGenerateParams & { multimodalRefs: MultimodalRefItem[] });
        if (params.resolution) (body as Record<string, unknown>).resolution = params.resolution;
        const serviceTier = this.resolveServiceTier("multimodal", params.serviceTier);
        if (serviceTier) (body as Record<string, unknown>).service_tier = serviceTier;
        return body;
      }
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
      const serviceTier = this.resolveServiceTier(
        isKeyframe ? "keyframe" : "initialImage",
        params.serviceTier
      );
      if (serviceTier) (body as Record<string, unknown>).service_tier = serviceTier;
      return body;
    };

    const kfParams = params as VideoGenerateParams & { anchorFirstRemoteUrl?: string; anchorLastAiRemoteUrl?: string };
    const hasRemoteUrls = isKeyframe && !!(kfParams.anchorFirstRemoteUrl || kfParams.anchorLastAiRemoteUrl);

    const body = buildBody(true /* useRemoteUrls */);
    const mmRefs = isMultimodal ? (params as VideoGenerateParams & { multimodalRefs: MultimodalRefItem[] }).multimodalRefs : [];
    console.log(
      `[Seedance] Submitting task: model=${body.model}, ` +
        `duration=${body.duration}, ratio=${body.ratio}` +
        (params.resolution ? `, resolution=${params.resolution}` : "") +
        (isMultimodal ? `, multimodal refs=${mmRefs.filter(r => r.type === "image").length}img+${mmRefs.filter(r => r.type === "audio").length}audio` : hasRemoteUrls ? ", frames=remoteUrl" : ", frames=base64")
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
   * - duration === -1：不传（让模型在有效时长内自选）
   * - duration > 0：向上取整为整数秒（API 只接受整数），再 clamp 到当前模型的有效区间
   * - 其他：回退到该模型的下限
   *
   * clamp 用能力表的区间而不是写死数字：2.0 是 4~15s，2.5 是 4~30s。
   * 低于下限会被 API 拒绝，高于上限历史上出现过 400（见 CLAUDE.md 的 duration=7.5 陷阱）。
   */
  private resolveDuration(duration: number): number | undefined {
    if (duration === -1) return undefined;   // auto
    const { min, max } = this.capability.duration;
    if (duration > 0) return Math.min(max, Math.max(min, Math.ceil(duration)));
    return min;                               // fallback
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

  /**
   * 参考图模式：「图生视频-首帧」，单张初始图片作为严格起始帧。
   *
   * API 说明（火山方舟）：图生视频-首帧、图生视频-首尾帧、多模态参考生视频为互斥场景，不可混用。
   * 若同时传入角色定妆图会切换为多模态参考模式，initialImage 会从首帧锚点降级为普通参考图，
   * 导致视频不从指定首帧开始。因此参考图模式始终只传 initialImage，角色定妆图在首帧已有
   * 视觉锚定，无需额外传入。
   */
  private buildReferenceBody(
    params: VideoGenerateParams & { initialImage: string }
  ): Record<string, unknown> {
    const dur = this.resolveDuration(params.duration);
    const generateAudio = params.generateAudio ?? true;
    const promptText = generateAudio ? this.suppressBgmInPrompt(params.prompt) : params.prompt;

    // 图生视频-首帧：单张图片。
    // 2.0：不带 role（等效 first_frame）—— 保持既有行为不动。
    // 2.5：必须显式 role="first_frame"，否则模型无法把任务判定为首帧生视频
    //      （教程「任务类型与限制」：首帧生视频的触发条件就是 content.role 设为 first_frame）。
    const firstFrameItem: Record<string, unknown> = {
      type: "image_url",
      image_url: { url: toImageUrl(params.initialImage) },
      ...(this.isSeedance25() && { role: "first_frame" }),
    };
    const body: Record<string, unknown> = {
      model: this.model,
      content: [{ type: "text", text: promptText }, firstFrameItem],
      ratio: params.ratio || "16:9",
      generate_audio: generateAudio,
      return_last_frame: true,
      watermark: false,
    };
    if (dur !== undefined) body.duration = dur;
    return body;
  }

  /**
   * 多模态参考模式：「多模态参考生视频」，对应 Toonflow 的 imageReference 数组模式。
   *
   * 用于单镜/批量视频生成，将角色定妆图、角度图、分镜首帧一并作为视觉参考（场景图已移除）。
   * 与单镜首帧模式互斥：此模式无严格首帧约束，内容由 prompt 的 @参考N 系统驱动。
   *
   * API content 顺序（与 @参考N 编号完全对应）：
   *   text → image_url × N（reference_image）→ audio_url × M（reference_audio）
   */
  private buildMultimodalBody(
    params: VideoGenerateParams & { multimodalRefs: MultimodalRefItem[] }
  ): Record<string, unknown> {
    const dur = this.resolveDuration(params.duration);
    const generateAudio = params.generateAudio ?? true;
    const promptText = generateAudio ? this.suppressBgmInPrompt(params.prompt) : params.prompt;

    const content: unknown[] = [{ type: "text", text: promptText }];

    // 图片先行（reference_image），顺序与 buildRefEntries 第1+2轮一致
    const imageRefs = params.multimodalRefs.filter((r) => r.type === "image");
    for (const ref of imageRefs) {
      content.push({
        type: "image_url",
        image_url: { url: toImageUrl(ref.path) },
        role: "reference_image",
      });
    }

    // 参考视频（reference_video，仅 2.5 支持），排在图片之后、音频之前，
    // 与 buildRefEntries 的 @视频N 轮次对应。只接受公网 URL / asset:// —— toVideoUrl 会拦本地路径。
    const videoRefs = params.multimodalRefs.filter((r) => r.type === "video");
    for (const ref of videoRefs) {
      content.push({
        type: "video_url",
        video_url: { url: toVideoUrl(ref.path) },
        role: "reference_video",
      });
    }

    // 音频殿后（reference_audio），顺序与 buildRefEntries 最后一轮一致
    const audioRefs = params.multimodalRefs.filter((r) => r.type === "audio");
    for (const ref of audioRefs) {
      content.push({
        type: "audio_url",
        audio_url: { url: toAudioDataUrl(ref.path) },
        role: "reference_audio",
      });
    }

    const body: Record<string, unknown> = {
      model: this.model,
      content,
      ratio: params.ratio || "16:9",
      generate_audio: generateAudio,
      return_last_frame: true,
      watermark: false,
    };
    if (dur !== undefined) body.duration = dur;

    // 2.5：显式声明这是「参考生视频」子任务。不传或传 auto 时，模型会自行按提示词意图
    // 判定任务类型，可能误判为视频编辑/延长并在任务启动后异步报错
    // InvalidParameter.TaskTypeConstraint；显式指定可把校验前置到提交时同步返回。
    if (this.needsOmniReferenceTaskType()) {
      body.omni_reference_task_type = "reference";
    }
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
