export type RemoteVideoMode = "keyframe" | "reference";
export type RemoteVideoStatus = "available" | "downloaded" | "download_failed" | "expired";

const DEFAULT_REMOTE_VIDEO_TTL_HOURS = Number(process.env.REMOTE_VIDEO_TTL_HOURS || 24);

export function getRemoteVideoExpiry(now = new Date()): Date {
  return new Date(now.getTime() + DEFAULT_REMOTE_VIDEO_TTL_HOURS * 60 * 60 * 1000);
}

export function isRemoteVideoReusable(params: {
  url: string | null | undefined;
  status: string | null | undefined;
  expiresAt: Date | null | undefined;
  now?: Date;
}): boolean {
  if (!params.url) return false;
  if (params.status === "expired") return false;
  const now = params.now ?? new Date();
  return !params.expiresAt || params.expiresAt > now;
}
