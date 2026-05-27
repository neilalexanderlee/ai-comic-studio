/** 远程视频是否可在本地无成片时通过「生成视频」恢复下载 */
export function isRecoverableRemoteVideo(params: {
  remoteVideoUrl: string | null | undefined;
  remoteVideoStatus: string | null | undefined;
  remoteVideoExpiresAt: string | Date | null | undefined;
  hasLocalVideo: boolean;
  nowMs?: number;
}): boolean {
  const { remoteVideoUrl, remoteVideoStatus, remoteVideoExpiresAt, hasLocalVideo } = params;
  if (!remoteVideoUrl || hasLocalVideo || remoteVideoStatus === "expired") {
    return false;
  }
  const expiresAtMs = remoteVideoExpiresAt
    ? new Date(remoteVideoExpiresAt).getTime()
    : null;
  const now = params.nowMs ?? Date.now();
  return expiresAtMs == null || expiresAtMs > now;
}

export function formatRemoteVideoRecoveryLabels(params: {
  remoteVideoExpiresAt: string | Date | null | undefined;
  remoteVideoLastDownloadAt: string | Date | null | undefined;
  remoteVideoStatus: string | null | undefined;
}): {
  expiryLabel: string;
  lastAttemptLabel: string | null;
  hintTitle: string;
  hintText: string;
} {
  const expiresAtMs = params.remoteVideoExpiresAt
    ? new Date(params.remoteVideoExpiresAt).getTime()
    : null;
  const expiryLabel = expiresAtMs
    ? new Date(expiresAtMs).toLocaleString()
    : "未知";
  const lastAttemptLabel = params.remoteVideoLastDownloadAt
    ? new Date(params.remoteVideoLastDownloadAt).toLocaleString()
    : null;
  const downloadFailed = params.remoteVideoStatus === "download_failed";
  const hintText = downloadFailed ? "可重下远程结果" : "可恢复远程结果";
  const hintTitle = downloadFailed
    ? `远程结果仍在，可优先重新下载；最近尝试：${lastAttemptLabel ?? "暂无"}；预计有效至：${expiryLabel}`
    : `已有远程结果，生成时会优先恢复下载；预计有效至：${expiryLabel}`;
  return { expiryLabel, lastAttemptLabel, hintTitle, hintText };
}
