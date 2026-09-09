"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

export interface PlatformMode {
  /** 加载完成前为 null —— 用它避免「先渲染出配置 UI 再闪掉」 */
  ready: boolean;
  /** 平台托管模式：模型由平台统一配置，本人不该再填 Key */
  managed: boolean;
  /** 能进管理后台（owner 或运营 admin）—— 决定是否显示入口 */
  isStaff: boolean;
}

/**
 * 当前用户是不是管理员、这台部署是不是平台托管模式。
 *
 * ⚠️ 这两个值只用来**决定渲染什么**，不是权限边界 —— 真正的准入在 API 那层
 * （`requireAdmin` / `allowUserProviders` 的服务端检查）。改前端状态绕过它没有意义。
 *
 * ⚠️ 状态在 `useEffect` 里取，不在 render 里读任何浏览器专有对象：
 * 服务端渲染一份、客户端渲染另一份会造成 hydration mismatch（已知陷阱表有记录）。
 */
export function usePlatformMode(): PlatformMode {
  const [state, setState] = useState<Omit<PlatformMode, "ready">>({
    managed: false,
    isStaff: false,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, platformRes] = await Promise.all([
          apiFetch("/api/auth/me"),
          apiFetch("/api/platform/providers"),
        ]);
        const me = (await meRes.json()) as { isStaff?: boolean };
        const platform = (await platformRes.json()) as { managed?: boolean };
        if (cancelled) return;
        setState({ managed: !!platform?.managed, isStaff: !!me?.isStaff });
      } catch {
        // 取不到就按最宽松的「自部署 BYOK」渲染 —— 与改造前一致
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...state, ready };
}
