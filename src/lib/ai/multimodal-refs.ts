import type { VideoMode, VideoModelCapability } from "@/lib/ai/video-capabilities";

/**
 * 是否需要在构建 prompt 之前预解析角色定妆图。
 *
 * 必须提前解析的原因：`@参考N` 编号由 prompt 端生成、`multimodalRefs` 数组由 API 端组装，
 * 两者必须基于**同一份已过滤的角色列表**（只含磁盘上真有图的角色），否则编号会系统性错位。
 *
 * 判据从「是不是 Seedance 协议」改成了读能力描述符，这样新接入的品牌只要在
 * `video-capabilities.ts` 里声明支持多模态参考 + 用 seedance 方言，就自动享受这条路径。
 */
export function shouldResolveMultimodalCharacterRefs(params: {
  singleVideoMode: VideoMode;
  capability: VideoModelCapability;
  namedCharacterCount: number;
}): boolean {
  return (
    params.singleVideoMode === "multimodal" &&
    params.capability.promptDialect === "seedance-multi-param" &&
    params.capability.refs.image > 0 &&
    params.namedCharacterCount > 0
  );
}
