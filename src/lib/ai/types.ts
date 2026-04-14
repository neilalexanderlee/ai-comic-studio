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
}

export interface AIProvider {
  generateText(prompt: string, options?: TextOptions): Promise<string>;
  generateImage(prompt: string, options?: ImageOptions): Promise<string>;
}

// Keyframe mode: both firstFrame and lastFrame must be provided
type KeyframeVideoParams = {
  firstFrame: string;
  lastFrame: string;
  initialImage?: never;
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
  /** Character/style reference images for consistency (e.g. Veo 3.1 referenceImages) */
  referenceImages?: string[];
};

export interface VideoGenerateResult {
  filePath: string;
  lastFrameUrl?: string;
}

export interface VideoProvider {
  generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult>;
}
