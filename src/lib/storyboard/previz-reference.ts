import type { VideoMode, VideoModelCapability } from "@/lib/ai/video-capabilities";

/**
 * 「这次正式生成要不要把已确认的白模预演当作参考视频传给模型」的判定。
 *
 * 抽成纯函数是因为拒绝路径比接受路径多，而且每条拒绝都必须**能说出理由**：
 * 用户点过"选用这条运镜"之后，如果生成出来的成片跟预演毫无关系，却什么提示都没有，
 * 那就是最难排查的一类问题 —— 他会以为是模型不听话，而不是这条参考压根没送出去。
 */
export type PrevizReferenceDecision =
  | { use: true; ref: string }
  /** note 为空表示"本来就没选预演"，属于正常状态，不需要提示用户 */
  | { use: false; note?: string };

export function decidePrevizReference(params: {
  /** 降级之后的实际生成模式 */
  mode: VideoMode;
  capability: VideoModelCapability;
  /** shots.previzSelectedId */
  selectedId: string | null | undefined;
  /** 选中那条预演的存储引用；查不到（已删除）时传 null */
  previzVideoUrl: string | null | undefined;
  /** 该引用是否是对象存储引用（参考视频必须是公网 URL，本地路径走不通） */
  isRemoteRef: boolean;
}): PrevizReferenceDecision {
  const { mode, capability, selectedId, previzVideoUrl, isRemoteRef } = params;

  if (!selectedId) return { use: false };

  // 选过但记录没了（用户删掉了那条 take）—— 悬空 id 当作没选，不报错
  if (!previzVideoUrl) return { use: false };

  if (capability.refs.video <= 0 || !capability.refTransport.video.includes("url")) {
    return {
      use: false,
      note: `${capability.label} 不支持参考视频，本次未使用已确认的运镜预演`,
    };
  }

  // 参考视频只在"参考生视频"模式下有位置：首帧/首尾帧模式的请求体里根本没有它的字段
  if (mode !== "multimodal") {
    return {
      use: false,
      note: `本镜走的是${mode === "keyframe" ? "首尾帧" : "严格首帧"}模式，该模式不接受参考视频，运镜预演未参与生成`,
    };
  }

  if (!isRemoteRef) {
    return {
      use: false,
      note: "运镜预演存在本地，而参考视频必须是公网地址；配置对象存储后即可生效",
    };
  }

  return { use: true, ref: previzVideoUrl };
}
