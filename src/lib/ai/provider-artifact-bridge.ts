import { isOssRef, materializeArtifact } from "@/lib/storage/artifact-store";
import type {
  AIProvider,
  ImageOptions,
  TextOptions,
  VideoProvider,
  VideoGenerateParams,
} from "./types";

/**
 * 存储引用 → provider 的桥。
 *
 * ## 它解决的问题
 *
 * 每个 provider 都是照着"素材是本地文件"写的：`fs.readFileSync(path)` 转 base64
 * （seedance 的 toDataUrl / toAudioDataUrl、openai 的 fileToBase64DataUri、
 * kling / jimeng / veo 同理）。产物迁到 OSS 之后，DB 里存的是 `oss://frames/x.png`，
 * 这些读取要么抛错，要么被上游的"文件存在吗"检查提前静默丢弃 ——
 * 表现为**角色定妆图、分镜首帧、道具图全部不再进入生成**，而界面上毫无提示。
 *
 * ## 为什么放在这一层
 *
 * 挨个改 provider 要动 6 个文件、而且每加一个新 provider 就会漏一次；
 * 挨个改调用方要动几十处。包在工厂出口这一层，是唯一一个"改一处、全覆盖、
 * 且新 provider 自动享受"的位置。provider 内部继续只认本地路径，不需要知道 OSS 存在。
 *
 * ## 不碰的三类引用
 *
 * - `asset://`：火山私域素材库 ID，必须原样传（用来绕过真人人脸拦截）
 * - `http(s)://`：已经是公网地址
 * - 参考**视频**：Seedance 2.5 的参考视频只接受 URL，下成本地文件反而走不通
 *   （见 providers/seedance.ts 的 toVideoUrl）
 */

/** 需要物化的引用：只有 OSS 引用；本地路径原样返回（零开销） */
function needsMaterialize(ref: string | undefined | null): ref is string {
  return !!ref && isOssRef(ref);
}

interface Materialized {
  resolve: (ref: string) => string;
  cleanup: () => void;
}

/** 一次性把一批引用下载到临时目录，返回 ref → 本地路径 的查表函数 */
async function materializeAll(refs: string[]): Promise<Materialized> {
  const unique = [...new Set(refs.filter(needsMaterialize))];
  const map = new Map<string, string>();
  const handles: Array<{ cleanup: () => void }> = [];
  try {
    for (const ref of unique) {
      const handle = await materializeArtifact(ref);
      handles.push(handle);
      map.set(ref, handle.path);
    }
  } catch (err) {
    for (const h of handles) h.cleanup();
    throw err;
  }
  return {
    resolve: (ref) => map.get(ref) ?? ref,
    cleanup: () => {
      for (const h of handles) h.cleanup();
    },
  };
}

/** 包装图片/文本 provider：物化 referenceImages 与 vision 输入图 */
export function withArtifactBridge<T extends AIProvider>(provider: T): T {
  const wrapped: AIProvider = {
    async generateText(prompt: string, options?: TextOptions) {
      if (!options?.images?.length) return provider.generateText(prompt, options);
      const mat = await materializeAll(options.images);
      try {
        return await provider.generateText(prompt, {
          ...options,
          images: options.images.map(mat.resolve),
        });
      } finally {
        mat.cleanup();
      }
    },

    async generateImage(prompt: string, options?: ImageOptions) {
      if (!options?.referenceImages?.length) return provider.generateImage(prompt, options);
      const mat = await materializeAll(options.referenceImages);
      try {
        return await provider.generateImage(prompt, {
          ...options,
          referenceImages: options.referenceImages.map(mat.resolve),
        });
      } finally {
        mat.cleanup();
      }
    },
  };

  // generateImages 是可选方法：provider 没实现就不要凭空加上，
  // 否则调用方的 `provider.generateImages ? ... : ...` 能力探测会被骗过去
  if (provider.generateImages) {
    wrapped.generateImages = async (prompts: string[], options?: ImageOptions) => {
      if (!options?.referenceImages?.length) return provider.generateImages!(prompts, options);
      const mat = await materializeAll(options.referenceImages);
      try {
        return await provider.generateImages!(prompts, {
          ...options,
          referenceImages: options.referenceImages.map(mat.resolve),
        });
      } finally {
        mat.cleanup();
      }
    };
  }

  // 保留原型上的其余成员（各 provider 的私有扩展方法）
  return Object.assign(Object.create(Object.getPrototypeOf(provider)), provider, wrapped) as T;
}

/** 包装视频 provider：物化首帧/尾帧/初始图/多模态图片与音频参考 */
export function withVideoArtifactBridge(provider: VideoProvider): VideoProvider {
  return {
    ...provider,
    async generateVideo(params: VideoGenerateParams) {
      const p = params as VideoGenerateParams & {
        anchorFirst?: string;
        anchorLastAi?: string;
        initialImage?: string;
      };

      const refs: string[] = [];
      for (const v of [p.anchorFirst, p.anchorLastAi, p.initialImage]) {
        if (v) refs.push(v);
      }
      for (const r of params.referenceImages ?? []) refs.push(r);
      for (const item of p.multimodalRefs ?? []) {
        // 参考视频必须保持 URL 形态：Seedance 2.5 不接受 base64，下成本地文件就废了
        if (item.type !== "video") refs.push(item.path);
      }

      if (!refs.some(needsMaterialize)) return provider.generateVideo(params);

      const mat = await materializeAll(refs);
      try {
        const next = { ...p } as typeof p;
        if (next.anchorFirst) next.anchorFirst = mat.resolve(next.anchorFirst);
        if (next.anchorLastAi) next.anchorLastAi = mat.resolve(next.anchorLastAi);
        if (next.initialImage) next.initialImage = mat.resolve(next.initialImage);
        if (next.referenceImages) next.referenceImages = next.referenceImages.map(mat.resolve);
        if (next.multimodalRefs) {
          next.multimodalRefs = next.multimodalRefs.map((item) =>
            item.type === "video" ? item : { ...item, path: mat.resolve(item.path) }
          );
        }
        return await provider.generateVideo(next as VideoGenerateParams);
      } finally {
        mat.cleanup();
      }
    },
  };
}
