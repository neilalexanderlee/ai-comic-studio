"use client";

import { useEffect, useRef } from "react";
import { useModelStore } from "@/stores/model-store";
import { apiFetch } from "@/lib/api-fetch";
import type { ModelStorePersistPayload } from "@/stores/model-store";

function toPayload(state: ReturnType<typeof useModelStore.getState>): ModelStorePersistPayload {
  return {
    providers: state.providers.map((p) => ({
      ...p,
      apiKey: "",
      secretKey: undefined,
    })),
    defaultTextModel: state.defaultTextModel,
    defaultImageModel: state.defaultImageModel,
    defaultVideoModel: state.defaultVideoModel,
    defaultMusicModel: state.defaultMusicModel,
  };
}

function hasPayloadContent(p: ModelStorePersistPayload) {
  return (
    p.providers.length > 0 ||
    !!p.defaultTextModel ||
    !!p.defaultImageModel ||
    !!p.defaultVideoModel ||
    !!p.defaultMusicModel
  );
}

function applyPayload(data: ModelStorePersistPayload) {
  useModelStore.setState({
    providers: data.providers.map((p) => ({
      ...p,
      apiKey: "",
      secretKey: undefined,
    })),
    defaultTextModel: data.defaultTextModel ?? null,
    defaultImageModel: data.defaultImageModel ?? null,
    defaultVideoModel: data.defaultVideoModel ?? null,
    defaultMusicModel: data.defaultMusicModel ?? null,
  });
}

/**
 * 从服务端拉取 model-store 备份（密钥仍在 provider_secrets）；本地为空时合并；变更后防抖写回。
 *
 * 平台模式（`ALLOW_USER_PROVIDERS=0`）下的非管理员走另一条路：
 * **无条件采用管理员那份 provider 列表并停止写回**。
 * 「本地为空才合并」在这里是错的 —— 用户本地留着一份旧的（甚至是自己以前配的）
 * 列表时就不会更新，结果是管理员换了模型、用户这边还在用一个已经不存在的 providerId，
 * 而失败信息只会是「未配置 Key」。
 */
export function ModelStoreServerSync() {
  const allowRemoteSave = useRef(false);
  const managedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function pull() {
      try {
        const platformRes = await apiFetch("/api/platform/providers");
        const platform = (await platformRes.json()) as {
          managed?: boolean;
          payload?: ModelStorePersistPayload | null;
        };
        if (cancelled) return;
        if (platform?.managed) {
          managedRef.current = true;
          if (platform.payload?.providers?.length) applyPayload(platform.payload);
          return; // 托管：不再拉自己的备份，也不写回（finally 里 allowRemoteSave 保持 false）
        }

        const res = await apiFetch("/api/user-prefs/model-store");
        const data = (await res.json()) as ModelStorePersistPayload | null;
        if (cancelled || !data?.providers?.length) return;
        if (useModelStore.getState().providers.length === 0) applyPayload(data);
      } catch {
        // ignore
      } finally {
        if (!cancelled && !managedRef.current) allowRemoteSave.current = true;
      }
    }

    const t = window.setTimeout(() => void pull(), 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useModelStore.subscribe((state) => {
      if (!allowRemoteSave.current) return;
      const payload = toPayload(state);
      if (!hasPayloadContent(payload)) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await apiFetch("/api/user-prefs/model-store", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch {
          // ignore
        }
      }, 1200);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  return null;
}
