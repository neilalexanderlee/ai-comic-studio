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
  /**
   * 这条预演的时长（秒）。**取不到就传 null** —— 历史记录可能没写这一列，
   * 拿不到时一律放行，不能因为「不知道」就把能用的预演挡掉。
   */
  durationSec?: number | null;
}): PrevizReferenceDecision {
  const { mode, capability, selectedId, previzVideoUrl, isRemoteRef, durationSec } = params;

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

  // 时长越界必须在**提交前**挡下：参考视频的限制是异步校验的 ——
  // 任务照常创建，几十秒后才报错，那时候用户早就切走了，回来只看到一次失败。
  // 限制来自能力表（约定 7a），没声明就不检查。
  const limits = capability.refVideoLimits;
  if (limits && typeof durationSec === "number" && Number.isFinite(durationSec)) {
    if (durationSec < limits.minDurationSec || durationSec > limits.maxDurationSec) {
      return {
        use: false,
        note:
          `运镜预演时长 ${durationSec}s 超出 ${capability.label} 对参考视频的限制` +
          `（${limits.minDurationSec}–${limits.maxDurationSec}s），本次未使用`,
      };
    }
  }

  return { use: true, ref: previzVideoUrl };
}
