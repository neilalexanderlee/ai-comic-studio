/** 视频完成后自动衔接的结果（可序列化到 API JSON） */
export type ShotAutoLinkResult =
  | { status: "disabled" }
  | { status: "not_attempted" }
  | { status: "linked"; nextShotId: string; nextSequence?: number }
  | { status: "skipped"; reason: string };

/** 返回需 Toast 的文案；null 表示不提示 */
export function describeShotAutoLinkToast(
  result: ShotAutoLinkResult | undefined,
  sourceSequence?: number
): { variant: "success" | "info"; message: string } | null {
  if (!result) return null;
  if (result.status === "linked") {
    const seq = result.nextSequence;
    return {
      variant: "success",
      message:
        seq != null
          ? `镜头 ${sourceSequence ?? "?"} 视频尾帧已自动衔接至镜头 ${seq} 首帧`
          : "已用本镜视频尾帧自动衔接下一镜首帧",
    };
  }
  if (result.status === "skipped" && result.reason !== "no_next_shot") {
    const msg = shotAutoLinkSkipMessage(result.reason);
    return msg ? { variant: "info", message: msg } : null;
  }
  return null;
}

export function shotAutoLinkSkipMessage(reason: string): string | null {
  switch (reason) {
    case "no_valid_cut_point":
      return "未保存有效视频尾帧，无法自动衔接下一镜";
    case "crowd_to_character_cut":
      return "群演→主角切换：已跳过自动衔接（请手动承接上一镜或独立生成）";
    case "no_next_shot":
      return null;
    default:
      return `镜头衔接未执行（${reason}）`;
  }
}
