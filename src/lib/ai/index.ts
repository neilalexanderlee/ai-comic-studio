import type { AIProvider, VideoProvider } from "./types";

export type { AIProvider, VideoProvider, TextOptions, ImageOptions, VideoGenerateParams } from "./types";

let defaultAIProvider: AIProvider | null = null;
let defaultVideoProvider: VideoProvider | null = null;

let defaultAIProviderFactory: ((uploadDir?: string) => AIProvider) | null = null;
let defaultVideoProviderFactory: ((uploadDir?: string) => VideoProvider) | null = null;

export function setDefaultAIProvider(provider: AIProvider, factory?: (uploadDir?: string) => AIProvider) {
  defaultAIProvider = provider;
  if (factory) defaultAIProviderFactory = factory;
}

export function setDefaultVideoProvider(provider: VideoProvider, factory?: (uploadDir?: string) => VideoProvider) {
  defaultVideoProvider = provider;
  if (factory) defaultVideoProviderFactory = factory;
}

export function getAIProvider(uploadDir?: string): AIProvider {
  if (uploadDir && defaultAIProviderFactory) {
    return defaultAIProviderFactory(uploadDir);
  }
  if (!defaultAIProvider) {
    throw new Error("No AI provider configured. Call setDefaultAIProvider() first.");
  }
  return defaultAIProvider;
}

export function getVideoProvider(uploadDir?: string): VideoProvider {
  if (uploadDir && defaultVideoProviderFactory) {
    return defaultVideoProviderFactory(uploadDir);
  }
  if (!defaultVideoProvider) {
    throw new Error("No video provider configured. Call setDefaultVideoProvider() first.");
  }
  return defaultVideoProvider;
}
