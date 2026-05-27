"use client";

import { RotateCcw } from "lucide-react";
import {
  formatRemoteVideoRecoveryLabels,
  isRecoverableRemoteVideo,
} from "@/lib/video/remote-video-recovery";

type RemoteVideoRecoveryHintProps = {
  remoteVideoUrl?: string | null;
  remoteVideoStatus?: string | null;
  remoteVideoExpiresAt?: string | Date | null;
  remoteVideoLastDownloadAt?: string | Date | null;
  hasLocalVideo: boolean;
  className?: string;
};

export function RemoteVideoRecoveryHint({
  remoteVideoUrl,
  remoteVideoStatus,
  remoteVideoExpiresAt,
  remoteVideoLastDownloadAt,
  hasLocalVideo,
  className,
}: RemoteVideoRecoveryHintProps) {
  if (
    !isRecoverableRemoteVideo({
      remoteVideoUrl,
      remoteVideoStatus,
      remoteVideoExpiresAt,
      hasLocalVideo,
    })
  ) {
    return null;
  }

  const { hintTitle, hintText } = formatRemoteVideoRecoveryLabels({
    remoteVideoExpiresAt,
    remoteVideoLastDownloadAt,
    remoteVideoStatus,
  });

  return (
    <div
      className={
        className ??
        "inline-flex h-7 items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 text-[11px] font-medium text-sky-700"
      }
      title={hintTitle}
    >
      <RotateCcw className="h-3 w-3 shrink-0" />
      {hintText}
    </div>
  );
}
