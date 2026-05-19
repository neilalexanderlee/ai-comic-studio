export interface TextOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  images?: string[];  // local file paths for vision input
}

export interface ImageOptions {
  model?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  referenceImages?: string[];
  /** Labels for reference images, e.g. character names. Must match referenceImages order. */
  referenceLabels?: string[];
  /**
   * Seedream 5.0-lite: 顺序图片生成模式。
   * - 'auto'：模型自动决定是否批量生成（最多15张连贯图，适合分镜序列）
   * - 'none'：单张生成（默认）
   * 启用后，generateImages() 将返回多张连贯图片路径。
   */
  sequentialImageGeneration?: 'auto' | 'none';
  /**
   * 图片生成完成、下载开始之前回调，携带 API 返回的公网图片 URL。
   * 调用方可将此 URL 缓存，在后续视频生成时直接传给 Seedance，
   * 避免将本地文件转 base64，减少请求体积。
   */
  onRemoteUrl?: (url: string) => void;
}

export interface AIProvider {
  generateText(prompt: string, options?: TextOptions): Promise<string>;
  generateImage(prompt: string, options?: ImageOptions): Promise<string>;
  /**
   * 批量生成连贯图片序列（对应 Seedream sequential_image_generation）。
   * 默认实现：调用 generateImage n 次（顺序生成）。
   * Seedream 5.0-lite 实现：单次 API 调用生成最多 15 张一致性分镜帧。
   * @param prompts 每张图的描述（支持 1-15 个）
   * @param options 共用的图片生成选项
   * @returns 按顺序排列的本地文件路径数组
   */
  generateImages?(prompts: string[], options?: ImageOptions): Promise<string[]>;
}

// Keyframe mode: both firstFrame and lastFrame must be provided
type KeyframeVideoParams = {
  firstFrame: string;
  lastFrame: string;
  initialImage?: never;
  /** 首帧图片的公网 URL（来自图片生成 API），优先用于视频生成请求，避免 base64 转换 */
  firstFrameRemoteUrl?: string;
  /** 尾帧图片的公网 URL（来自图片生成 API），优先用于视频生成请求，避免 base64 转换 */
  lastFrameRemoteUrl?: string;
};

// Reference image mode: a single initial image (local path or http URL)
type ReferenceVideoParams = {
  firstFrame?: never;
  lastFrame?: never;
  initialImage: string;
};

export type VideoGenerateParams = (KeyframeVideoParams | ReferenceVideoParams) & {
  prompt: string;
  duration: number;
  ratio: string;
  /**
   * 视频分辨率（Seedance 2.0 新增参数）。
   * 支持值：「480p」「720p」「1080p」「2K」，默认由模型决定。
   */
  resolution?: string;
  /** Character/style reference images for consistency (e.g. Veo 3.1 referenceImages) */
  referenceImages?: string[];
  /**
   * Seedance 2.0 服务层级。
   * - 'auto'（默认）：标准优先级，正常排队
   * - 'flex'：弹性模式，成本降低约50%，生成时间较长
   */
  serviceTier?: 'auto' | 'flex';
  /** Called as soon as a provider has a reusable remote result URL, before local download. */
  onRemoteResult?: (result: { videoUrl: string; taskId?: string }) => Promise<void> | void;
};

export interface VideoGenerateResult {
  filePath: string;
  lastFrameUrl?: string;
  remoteVideoUrl?: string;
  remoteTaskId?: string;
}

export interface VideoProvider {
  generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult>;
}
