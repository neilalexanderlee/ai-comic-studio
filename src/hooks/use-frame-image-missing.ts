"use client";

import { useEffect, useState } from "react";
import { uploadUrl, type ThumbWidth } from "@/lib/utils/upload-url";

/**
 * 通过加载 /api/uploads 判断帧文件是否缺失（客户端不可用 node:fs）。
 *
 * ⚠️ **`w` 必须与同一处 `<img>` 用的宽度一致。** 这个探测是靠真的把图下下来完成的，
 * 传了不同的宽度就等于把每一张帧图**下载两遍**（浏览器按 URL 做缓存键，
 * 缩略图和原图是两个资源）—— 而这个 hook 恰好和渲染缩略图的组件成对使用。
 */
export function useFrameImageMissing(
  src: string | null | undefined,
  w?: ThumbWidth
): boolean {
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
    img.src = uploadUrl(src, w ? { w } : undefined);
    return () => {
      cancelled = true;
    };
  }, [src, w]);

  return !!src && missing;
}
