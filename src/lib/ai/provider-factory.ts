import { ensureArkApiV3BaseUrl } from "./ark-base-url";
import { withArtifactBridge, withVideoArtifactBridge } from "./provider-artifact-bridge";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import { VeoProvider } from "./providers/veo";
import { KlingImageProvider } from "./providers/kling-image";
import { KlingVideoProvider } from "./providers/kling-video";
import { JimengImageProvider } from "./providers/jimeng-image";
import { JimengVideoProvider } from "./providers/jimeng-video";
import { MiniMaxVideoProvider } from "./providers/minimax-video";
import { getAIProvider, getVideoProvider } from "./index";
import type { AIProvider, VideoProvider } from "./types";

interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  modelId: string;
}

export interface ModelConfigPayload {
  text?: ProviderConfig | null;
  image?: ProviderConfig | null;
  video?: ProviderConfig | null;
}

/**
 * 所有 provider 出口都过一道存储桥：DB 里存的是 `oss://…` 引用，而每个 provider
 * 内部都只会 `fs.readFileSync(本地路径)`。桥负责把 OSS 引用先下到临时文件再交给它们，
 * 调用结束即清理。少了这一层，参考图会被静默丢弃（详见 provider-artifact-bridge.ts）。
 */
export function createAIProvider(config: ProviderConfig, uploadDir?: string): AIProvider {
  return withArtifactBridge(createAIProviderRaw(config, uploadDir));
}

function createAIProviderRaw(config: ProviderConfig, uploadDir?: string): AIProvider {
  switch (config.protocol) {
    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingImageProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "jimeng":
      // 即梦AI 图片生成（火山引擎 Visual API，AK/SK 认证）
      // 参考：https://www.volcengine.com/docs/85621/2288388
      return new JimengImageProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "doubao":
      // 豆包 Seedream 图片生成（方舟 Ark API，OpenAI 兼容，Bearer Token 认证）
      // 参考：https://www.volcengine.com/docs/82379/1541523
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: ensureArkApiV3BaseUrl(
          (config.baseUrl || "https://ark.cn-beijing.volces.com/api/v3").trim()
        ),
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported AI protocol: ${config.protocol}`);
  }
}

/** 同 createAIProvider：出口统一过存储桥，provider 内部继续只认本地路径。 */
export function createVideoProvider(config: ProviderConfig, uploadDir?: string): VideoProvider {
  return withVideoArtifactBridge(createVideoProviderRaw(config, uploadDir));
}

function createVideoProviderRaw(config: ProviderConfig, uploadDir?: string): VideoProvider {
  switch (config.protocol) {
    case "seedance":
      // 火山方舟 Seedance 视频生成（Bearer Token 认证）
      // 参考：https://www.volcengine.com/docs/82379/1520757
      // 注：视频侧只认 "seedance" 协议。"doubao" 是图片（Seedream）协议，
      //     若误配成视频 provider 会落到下面的 default 抛错 —— 这是有意的，
      //     而不是遗漏了一个 case（两者的模型 id 与请求体完全不同）。
      return new SeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: ensureArkApiV3BaseUrl(
          (config.baseUrl || "https://ark.cn-beijing.volces.com/api/v3").trim()
        ),
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new VeoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingVideoProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "jimeng-video":
      // 即梦AI 视频生成（火山引擎 Visual API，AK/SK 认证）
      // 720P：https://www.volcengine.com/docs/85621/1792710
      // 1080P：https://www.volcengine.com/docs/85621/1792711
      return new JimengVideoProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "minimax-video":
      // MiniMax H3 视频生成（v2 异步任务 API，Bearer Token 认证）
      // 参考：https://platform.minimax.io/docs/api-reference/video-generation-v2-create
      return new MiniMaxVideoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}

export function resolveAIProvider(modelConfig?: ModelConfigPayload): AIProvider {
  if (modelConfig?.text) {
    return createAIProvider(modelConfig.text);
  }
  return withArtifactBridge(getAIProvider());
}

export function resolveImageProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): AIProvider {
  if (modelConfig?.image) {
    return createAIProvider(modelConfig.image, uploadDir);
  }
  return withArtifactBridge(getAIProvider(uploadDir));
}

export function resolveVideoProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): VideoProvider {
  if (modelConfig?.video) {
    return createVideoProvider(modelConfig.video, uploadDir);
  }
  return withVideoArtifactBridge(getVideoProvider(uploadDir));
}
