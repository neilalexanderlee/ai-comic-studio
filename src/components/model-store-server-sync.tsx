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
 * 默认模型指向的那个**模型**还在不在列表里 —— 不在就不能留。
 *
 * ⚠️ 只比 providerId 是不够的：管理员把某个模型取消勾选、或换了一个模型 id 之后，
 * provider 还在、模型没了。此时下拉框因为 value 匹配不到任何 option 而显示空，
 * **但 store 里那个 ref 还在**，生成请求照样带着一个列表里根本没有的 modelId 发出去，
 * 失败信息只会是上游的「模型不存在」—— 看不出是默认值过期了。
 * 判据与 `default-model-picker` 的 `getOptions` 保持一致：必须是勾选过的模型。
 */
function keepIfModelExists(
  ref: ModelStorePersistPayload["defaultTextModel"],
  providers: ModelStorePersistPayload["providers"]
) {
  if (!ref) return null;
  const provider = providers.find((p) => p.id === ref.providerId);
  if (!provider) return null;
  return provider.models?.some((m) => m.id === ref.modelId && m.checked) ? ref : null;
}

/**
 * 从服务端拉取 model-store 备份（密钥仍在 provider_secrets）；本地为空时合并；变更后防抖写回。
 *
 * 平台模式（`ALLOW_USER_PROVIDERS=0`）下的非管理员：
 *
 * · **provider 列表无条件采用管理员那份**。「本地为空才合并」在这里是错的 ——
 *   用户本地留着一份旧列表就不会更新，结果是管理员换了模型、用户还在用一个
 *   已不存在的 providerId，而失败信息只会是「未配置 Key」。
 * · **但「默认用哪个模型」仍然是用户自己的偏好**，照常保留并继续写回。
 *   第一版把整个写回都关掉了，副作用是用户在设置页换了默认模型，
 *   刷新/换设备就被管理员那份覆盖回去 —— 改了没反应，且看不出为什么。
 *   指向已消失模型（provider 没了、或模型被取消勾选）的默认值会被丢弃，
 *   回落到管理员的默认值。
 *
 * ⚠️ 把管理员的列表写进用户自己的 `user_client_prefs` 是安全的：平台模式下
 * 非管理员根本不走「读自己的密钥」那条分支（`resolveOne` 的 `byokAllowed`），
 * 平台 Key 的端点只从**管理员**的 prefs 取（约定 8p 的同源不变量）。
 */
export function ModelStoreServerSync() {
  const allowRemoteSave = useRef(false);

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
          const adminPayload = platform.payload;
          if (!adminPayload?.providers?.length) {
            // 平台模式下这等于「全站没有可用模型」。静默返回过一次坑：
            // 界面只表现为下拉框里只有一个「--」，看不出是没配还是没拉到。
            console.warn(
              "[model-store] 平台托管模式，但 owner 还没配置任何 provider —— 模型列表会是空的"
            );
            return;
          }

          // 用户自己的默认模型选择（拿不到就用管理员的）
          let mine: ModelStorePersistPayload | null = null;
          try {
            const mineRes = await apiFetch("/api/user-prefs/model-store");
            mine = (await mineRes.json()) as ModelStorePersistPayload | null;
          } catch {
            // 取不到就退回管理员那份默认值，不影响 provider 列表本身
          }
          if (cancelled) return;

          const providers = adminPayload.providers;
          applyPayload({
            providers,
            defaultTextModel:
              keepIfModelExists(mine?.defaultTextModel ?? null, providers) ??
              adminPayload.defaultTextModel ??
              null,
            defaultImageModel:
              keepIfModelExists(mine?.defaultImageModel ?? null, providers) ??
              adminPayload.defaultImageModel ??
              null,
            defaultVideoModel:
              keepIfModelExists(mine?.defaultVideoModel ?? null, providers) ??
              adminPayload.defaultVideoModel ??
              null,
            defaultMusicModel:
              keepIfModelExists(mine?.defaultMusicModel ?? null, providers) ??
              adminPayload.defaultMusicModel ??
              null,
          });
          return;
        }

        const res = await apiFetch("/api/user-prefs/model-store");
        const data = (await res.json()) as ModelStorePersistPayload | null;
        if (cancelled || !data?.providers?.length) return;
        if (useModelStore.getState().providers.length === 0) applyPayload(data);
      } catch (err) {
        // 拉不到就保持现状（本地 persist 那份），但**不能一声不吭** ——
        // 「请求失败」和「服务端本来就没数据」在界面上长得一模一样（空下拉框），
        // 而这两者的处置完全相反。2026-09-11 那次「隐身窗口首次登录后模型列表为空」
        // 就是这里吞掉了一个 401（登录前拉的），排查时毫无线索。
        console.warn("[model-store] 从服务端同步模型列表失败：", err);
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
