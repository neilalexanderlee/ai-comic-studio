"use client";

import { useEffect, useRef } from "react";
import { useModelStore } from "@/stores/model-store";
import { apiFetch } from "@/lib/api-fetch";
import type { ModelStorePersistPayload } from "@/stores/model-store";
import type { ModelStoreEnvelope } from "@/lib/model-store-envelope";

const EMPTY_STATE = {
  providers: [],
  defaultTextModel: null,
  defaultImageModel: null,
  defaultVideoModel: null,
  defaultMusicModel: null,
} satisfies ModelStorePersistPayload;

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

// ─── 同步元信息 ───────────────────────────────────────────────────────────────

/**
 * 「我手里这份是**谁的**、对应服务端**哪一版**」。
 *
 * 刻意不放进 zustand persist：它不是用户数据 —— 放进去就会被 `partialize`
 * 带着一起写回服务端、被 `migrate` 的版本机制管着、还会在每次更新时触发
 * 一轮写回订阅。它只是本机的一条同步记录，独立存。
 */
const SYNC_META_KEY = "model-store-sync";

interface SyncMeta {
  userId: string;
  /** 服务端时钟的毫秒时间戳 */
  updatedAt: number;
}

function readMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    if (typeof parsed?.userId !== "string") return null;
    return { userId: parsed.userId, updatedAt: Number(parsed.updatedAt) || 0 };
  } catch {
    return null;
  }
}

function writeMeta(meta: SyncMeta) {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // 隐私模式 / 存储被禁用：降级成「每次都按服务端那份来」，仍然是对的
  }
}

function clearMeta() {
  try {
    localStorage.removeItem(SYNC_META_KEY);
  } catch {
    // 同上
  }
}

/**
 * 从服务端同步 model-store（密钥始终在 `provider_secrets`，这里只同步列表与默认值）。
 *
 * ## 三种角色，三套规则
 *
 * | 谁 | provider 列表 | 默认模型 |
 * |---|---|---|
 * | 平台模式下的非管理员 | **无条件**采用管理员那份 | 自己的偏好优先，失效则回落管理员的 |
 * | owner / 自部署全员 | 服务端那份**更新**就采用 | 跟随列表 |
 *
 * 「本地为空才合并」在两种角色下都是错的，只是错法不同：
 * · 非管理员——用户本地留着一份旧列表就永远不更新，管理员换了模型他还在用一个
 *   已不存在的 providerId，而报错只会是「未配置 Key」；
 * · owner——他是唯一能改平台列表的人，却在 A 电脑删掉一个 provider 之后，
 *   B 电脑上那份旧列表原封不动，还会被防抖写回去**把 A 上的删除盖掉**。
 *   所以 owner 改用版本号（服务端时钟的 `updatedAt`）比较，谁新用谁。
 *
 * ## 换账号
 *
 * zustand persist 的 key 是固定的 `"model-store"`、**不带 userId**，
 * 所以同一台浏览器换账号时，上一个人的列表会留在本地。托管模式下无害
 * （管理员那份无条件覆盖），但自部署多账号下是真的串。这里用服务端返回的
 * `userId` 与本机记录比对，不一致就整体丢弃本地那份再走正常流程。
 *
 * ⚠️ 把管理员的列表写进用户自己的 `user_client_prefs` 是安全的（平台模式下
 * 非管理员不走「读自己的密钥」那条分支，平台 Key 的端点只从管理员的 prefs 取，
 * 见约定 8p 的同源不变量），但**没有必要** —— 每个人的行里存一份 11KB 的重复
 * JSON，排查时还容易被误认为是用户自己配的。所以托管模式下只写回默认模型偏好。
 */
export function ModelStoreServerSync() {
  /** 拉取完成前不许写回 —— 否则会用一个还没填充的空 store 覆盖服务端那份 */
  const allowRemoteSave = useRef(false);
  /** 拉取**成功**了吗。决定「允许写入空 payload」——见 saveIfChanged */
  const pullSucceeded = useRef(false);
  /** 平台托管模式（且本人不是 owner） */
  const managed = useRef(false);
  /** 上一次真正发出去的 payload，用来跳过无意义的重复写回 */
  const lastSentJson = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    /** 托管模式下非管理员只写回「自己选了哪个默认模型」，不重复存管理员那份列表 */
    function outgoingPayload(): ModelStorePersistPayload {
      const full = toPayload(useModelStore.getState());
      return managed.current ? { ...full, providers: [] } : full;
    }

    async function save(payload: ModelStorePersistPayload) {
      try {
        const res = await apiFetch("/api/user-prefs/model-store", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { userId?: string; updatedAt?: number };
        if (data?.userId && data?.updatedAt) {
          writeMeta({ userId: data.userId, updatedAt: data.updatedAt });
        }
        lastSentJson.current = JSON.stringify(payload);
      } catch (err) {
        console.warn("[model-store] 写回服务端失败：", err);
      }
    }

    async function pull() {
      let ok = false;
      try {
        const platformRes = await apiFetch("/api/platform/providers");
        const platform = (await platformRes.json()) as {
          managed?: boolean;
          payload?: ModelStorePersistPayload | null;
        };
        if (cancelled) return;
        managed.current = !!platform?.managed;

        // 自己那份。托管模式下只取其中的「默认模型」偏好，非托管下是全部数据；
        // 两种模式都要它的 userId / updatedAt —— 换账号判断与版本判断全靠这两个。
        let mine: ModelStoreEnvelope | null = null;
        try {
          const mineRes = await apiFetch("/api/user-prefs/model-store");
          mine = (await mineRes.json()) as ModelStoreEnvelope | null;
        } catch (err) {
          console.warn("[model-store] 读取本人偏好失败：", err);
        }
        if (cancelled) return;

        // 同一台浏览器换了账号 —— 本地那份属于上一个人，整体作废
        const meta = readMeta();
        if (mine?.userId && meta && meta.userId !== mine.userId) {
          applyPayload(EMPTY_STATE);
          clearMeta();
          lastSentJson.current = null;
        }

        if (managed.current) {
          const adminPayload = platform.payload;
          if (!adminPayload?.providers?.length) {
            // 平台模式下这等于「全站没有可用模型」。静默返回过一次坑：
            // 界面只表现为下拉框里只有一个「--」，看不出是没配还是没拉到。
            // 界面侧的提示在 `DefaultModelPicker`（managed + 空列表 → 明确文案）。
            console.warn(
              "[model-store] 平台托管模式，但 owner 还没配置任何 provider —— 模型列表会是空的"
            );
            ok = true;
            return;
          }

          const providers = adminPayload.providers;
          const minePayload = mine?.payload;
          applyPayload({
            providers,
            defaultTextModel:
              keepIfModelExists(minePayload?.defaultTextModel ?? null, providers) ??
              adminPayload.defaultTextModel ??
              null,
            defaultImageModel:
              keepIfModelExists(minePayload?.defaultImageModel ?? null, providers) ??
              adminPayload.defaultImageModel ??
              null,
            defaultVideoModel:
              keepIfModelExists(minePayload?.defaultVideoModel ?? null, providers) ??
              adminPayload.defaultVideoModel ??
              null,
            defaultMusicModel:
              keepIfModelExists(minePayload?.defaultMusicModel ?? null, providers) ??
              adminPayload.defaultMusicModel ??
              null,
          });
          if (mine?.userId) {
            writeMeta({ userId: mine.userId, updatedAt: mine.updatedAt ?? 0 });
          }
          ok = true;
          return;
        }

        // ── 非托管：owner 与自部署全员 ──
        ok = true;
        const serverPayload = mine?.payload;
        const localEmpty = useModelStore.getState().providers.length === 0;
        const serverStamp = mine?.updatedAt ?? 0;
        const localStamp = readMeta()?.updatedAt ?? 0;

        if (serverPayload?.providers?.length && (localEmpty || serverStamp > localStamp)) {
          applyPayload(serverPayload);
          if (mine?.userId) writeMeta({ userId: mine.userId, updatedAt: serverStamp });
          lastSentJson.current = JSON.stringify(toPayload(useModelStore.getState()));
          return;
        }

        if (mine?.userId) {
          writeMeta({ userId: mine.userId, updatedAt: serverStamp });
        }

        // 本地这份比服务端新（上一次写回没成功、或改完立刻关了页面）——
        // 主动补一次。不补的话它永远不会被写出去：写回只由「状态变化」触发，
        // 而这一份已经不会再变了，于是换台设备看到的永远是旧的。
        if (!localEmpty && serverStamp < localStamp) {
          await save(outgoingPayload());
        }
      } catch (err) {
        // 拉不到就保持现状（本地 persist 那份），但**不能一声不吭** ——
        // 「请求失败」和「服务端本来就没数据」在界面上长得一模一样（空下拉框），
        // 而这两者的处置完全相反。2026-09-11 那次「隐身窗口首次登录后模型列表为空」
        // 就是这里吞掉了一个 401（登录前拉的），排查时毫无线索。
        console.warn("[model-store] 从服务端同步模型列表失败：", err);
      } finally {
        if (!cancelled) {
          pullSucceeded.current = ok;
          allowRemoteSave.current = true;
        }
      }
    }

    const t = window.setTimeout(() => void pull(), 400);

    let timer: ReturnType<typeof setTimeout>;
    const unsub = useModelStore.subscribe(() => {
      if (!allowRemoteSave.current) return;
      const payload = outgoingPayload();
      const json = JSON.stringify(payload);
      if (json === lastSentJson.current) return;
      // ⚠️ 只有**确认拿到过服务端状态**时才允许写空。
      // 否则一次失败的拉取（例如 401）会留下一个空 store，随便一个状态变化
      // 就把服务端那份清掉 —— 用户看到的是「我的模型配置自己消失了」。
      // 而拉取成功过之后，空就是用户真的删光了，必须存得下去，
      // 不然表现为「删了刷新又回来」。
      if (!hasPayloadContent(payload) && !pullSucceeded.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => void save(payload), 1200);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      clearTimeout(timer);
      unsub();
    };
  }, []);

  return null;
}
