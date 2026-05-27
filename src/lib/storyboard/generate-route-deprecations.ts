export const DEPRECATED_PIPELINE_ACTION_MSG =
  "frame_generate / video_generate 任务队列已废弃，请使用 single_* 接口";

type DeprecatedResponse = { error: string; status: 410 };

/** 已废弃的 generate action → 410 响应；未命中返回 null，由路由继续处理。 */
export function resolveDeprecatedGenerateAction(action: string): DeprecatedResponse | null {
  if (action === "batch_frame_generate") {
    return {
      error: "批量生成首尾帧已移除，请逐镜使用「生成画面」或手动衔接上一镜尾帧",
      status: 410,
    };
  }
  if (action === "batch_video_generate") {
    return {
      error: "批量生成视频已移除，请逐镜生成视频；连续镜头可开启「镜头衔接（视频尾帧）」",
      status: 410,
    };
  }
  if (
    action === "batch_chain_generate" ||
    action === "single_scene_frame" ||
    action === "batch_scene_frame" ||
    action === "single_reference_video" ||
    action === "batch_reference_video"
  ) {
    return {
      error: "Reference/链式批量能力已移除，请使用单镜 keyframe 流程",
      status: 410,
    };
  }
  if (action === "frame_generate" || action === "video_generate") {
    return { error: DEPRECATED_PIPELINE_ACTION_MSG, status: 410 };
  }
  return null;
}
