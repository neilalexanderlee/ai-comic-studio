"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "ai_comic_uid";
const COOKIE_NAME = "ai_comic_uid";
const MAX_AGE_SEC = 365 * 24 * 60 * 60;

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];
}

/**
 * - 仅删 cookie 时：用 localStorage 里仍保留的旧 ID 写回 cookie，并 refresh，使服务端列表与 apiFetch 一致。
 * - 否则：把 middleware 下发的 cookie 同步到 localStorage，供 getUserId() / apiFetch 使用。
 */
export function FingerprintProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const cookieUid = readCookie(COOKIE_NAME);

    if (stored && stored !== cookieUid) {
      document.cookie = `${COOKIE_NAME}=${stored}; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax`;
      router.refresh();
      return;
    }

    if (cookieUid) {
      localStorage.setItem(STORAGE_KEY, cookieUid);
    }
  }, [router]);

  return <>{children}</>;
}
