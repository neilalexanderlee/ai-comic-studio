"use client";

import { useEffect, useState } from "react";
import { uploadUrl } from "@/lib/utils/upload-url";

/** 通过加载 /api/uploads 判断帧文件是否缺失（客户端不可用 node:fs） */
export function useFrameImageMissing(src: string | null | undefined): boolean {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!src) {
      setMissing(false);
      return;
    }
    let cancelled = false;
    setMissing(false);
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setMissing(false);
    };
    img.onerror = () => {
      if (!cancelled) setMissing(true);
    };
    img.src = uploadUrl(src);
    return () => {
      cancelled = true;
    };
  }, [src]);

  return !!src && missing;
}
