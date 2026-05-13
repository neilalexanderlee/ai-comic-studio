"use client";

import { useEffect, useRef } from "react";
import { useModelStore } from "@/stores/model-store";
import { apiFetch } from "@/lib/api-fetch";
import type { ModelStorePersistPayload } from "@/lib/user-client-prefs";

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
  };
}

function hasPayloadContent(p: ModelStorePersistPayload) {
  return (
    p.providers.length > 0 ||
    !!p.defaultTextModel ||
    !!p.defaultImageModel ||
    !!p.defaultVideoModel
  );
}

/** 从服务端拉取 model-store 备份（密钥仍在 provider_secrets）；本地为空时合并；变更后防抖写回 */
export function ModelStoreServerSync() {
  const allowRemoteSave = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function pull() {
      try {
        const res = await apiFetch("/api/user-prefs/model-store");
        const data = (await res.json()) as ModelStorePersistPayload | null;
        if (cancelled || !data?.providers?.length) return;
        const localLen = useModelStore.getState().providers.length;
        if (localLen === 0) {
          useModelStore.setState({
            providers: data.providers.map((p) => ({
              ...p,
              apiKey: "",
              secretKey: undefined,
            })),
            defaultTextModel: data.defaultTextModel ?? null,
            defaultImageModel: data.defaultImageModel ?? null,
            defaultVideoModel: data.defaultVideoModel ?? null,
          });
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) allowRemoteSave.current = true;
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
