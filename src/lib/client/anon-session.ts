/**
 * 匿名身份 → 账号 的迁移与清理（**仅浏览器端**）。
 *
 * 单机匿名使用时，身份是 `src/proxy.ts` 下发的指纹 ID（`ai_comic_uid`），
 * 数据都挂在这个 ID 下。用户一旦登录/注册，就要把那批数据过继给真正的账号，
 * 否则他会看到一个空首页，而旧项目变成没人认领的孤儿。
 *
 * 这套逻辑原本写在设置页的 `auth-section.tsx` 里。新增 `/login` 页之后必须共用，
 * **不能各抄一份** —— 里面有三个不抄就会出错的细节：
 *
 *  1. `localStorage` 清掉还不够，**IndexedDB 里也存了一份 uid**，
 *     不清的话 `FingerprintProvider` 会在登录后把旧 ID 又恢复回去；
 *  2. 要写 `ai_comic_is_auth=1`，`FingerprintProvider` 看到它才会跳过匿名 ID 同步；
 *  3. 迁移接口失败必须**静默**吞掉 —— 数据还在服务器上没丢，
 *     为此把一次成功的登录判成失败，代价大得多。
 */

/** 浏览器里存的旧匿名 ID */
export function getAnonymousId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ai_comic_uid");
}

/**
 * 清除 IndexedDB 中保存的匿名 uid。
 *
 * 每条失败路径都 `resolve()` 而不是 reject：这只是清理，
 * 任何一步出问题都不该阻断登录流程。
 */
function clearIdbUid(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("ai_comic", 1);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction("session", "readwrite");
          tx.objectStore("session").delete("uid");
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 登录/注册成功后调用：把旧匿名数据迁到当前账号，再清掉本地的匿名痕迹 */
export async function migrateAndClearAnonymousId(): Promise<void> {
  const anonId = getAnonymousId();
  if (!anonId) {
    // 没有匿名数据也要打标志，否则 FingerprintProvider 会给已登录用户再同步一个匿名 ID
    localStorage.setItem("ai_comic_is_auth", "1");
    return;
  }
  try {
    await fetch("/api/auth/migrate-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromUserId: anonId }),
    });
  } catch {
    // 静默失败：数据在服务器上没丢，用户可以稍后手动恢复
  }
  localStorage.removeItem("ai_comic_uid");
  await clearIdbUid();
  localStorage.setItem("ai_comic_is_auth", "1");
}

/** 登出后调用：清掉登录标志，让 FingerprintProvider 恢复匿名 ID 同步 */
export function markLoggedOut(): void {
  localStorage.removeItem("ai_comic_is_auth");
}

/** 供 `/api/auth/me` 的结果同步本地标志用（兼容「旧会话已登录但标志缺失」） */
export function syncAuthFlag(loggedIn: boolean): void {
  if (loggedIn) localStorage.setItem("ai_comic_is_auth", "1");
  else localStorage.removeItem("ai_comic_is_auth");
}
