"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "ai_comic_uid";
const COOKIE_NAME = "ai_comic_uid";
const MAX_AGE_SEC = 365 * 24 * 60 * 60;
const IDB_DB_NAME = "ai_comic";
const IDB_STORE = "session";
const IDB_KEY = "uid";

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];
}

function writeCookie(value: string) {
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax`;
}

/** IndexedDB helpers — survives "Clear cookies" and "Clear localStorage" individually */
function idbGet(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => {
        const tx = req.result.transaction(IDB_STORE, "readonly");
        const get = tx.objectStore(IDB_STORE).get(IDB_KEY);
        get.onsuccess = () => resolve((get.result as string | undefined) ?? null);
        get.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbSet(value: string): void {
  try {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, IDB_KEY);
    };
  } catch { /* silent */ }
}

/**
 * Three-layer session persistence: cookie ↔ localStorage ↔ IndexedDB
 *
 * Recovery priority (first non-empty wins):
 *   1. localStorage  — survives "Clear cookies"
 *   2. IndexedDB     — survives "Clear localStorage" (but NOT Chrome's "Clear all site data")
 *   3. cookie        — set by middleware on every request
 *
 * On recovery: the found ID is written back to all 3 layers + cookie, then page refresh
 * ensures the server sees the restored user ID via x-user-id header.
 *
 * On first visit / total clear: middleware assigns a new UUID, reclaim-local-user.ts
 * automatically reassigns all DB data from previous orphan IDs to the new one.
 */
export function FingerprintProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    async function sync() {
      // ai_comic_auth is HttpOnly — JS cannot read it via document.cookie.
      // Instead, check a localStorage flag set by auth-section on login/logout.
      // This prevents restoring a stale anonymous ID from IDB after the user logs in.
      const isLoggedIn = localStorage.getItem("ai_comic_is_auth") === "1";
      if (isLoggedIn) return;

      const lsUid = localStorage.getItem(STORAGE_KEY);
      const cookieUid = readCookie(COOKIE_NAME);
      const idbUid = await idbGet();

      // Pick the best stored ID (localStorage > IndexedDB > cookie)
      const savedUid = lsUid || idbUid;

      if (savedUid && savedUid !== cookieUid) {
        // Restore: write saved ID to all layers and refresh so server picks it up
        writeCookie(savedUid);
        localStorage.setItem(STORAGE_KEY, savedUid);
        idbSet(savedUid);
        router.refresh();
        return;
      }

      // Normal case: sync cookie value to all local layers
      if (cookieUid) {
        localStorage.setItem(STORAGE_KEY, cookieUid);
        idbSet(cookieUid);
      }
    }

    void sync();
  }, [router]);

  return <>{children}</>;
}
