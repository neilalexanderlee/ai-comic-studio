"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Globe, Check } from "lucide-react";

const localeLabels: Record<string, string> = {
  zh: "中文",
  en: "EN",
  ja: "日本語",
  ko: "한국어",
};

const localeFullLabels: Record<string, string> = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function switchLocale(newLocale: string) {
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.replace(segments.join("/"));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[#9C9A92] transition-all duration-200 hover:bg-[#F0EEEA] hover:text-[#1A1A1A] cursor-pointer"
      >
        <Globe className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>{localeLabels[locale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[140px] overflow-hidden rounded-xl bg-white p-1 shadow-[0_4px_20px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]">
          {routing.locales.map((loc) => (
            <button
              key={loc}
              onClick={() => switchLocale(loc)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors duration-150 cursor-pointer ${
                loc === locale
                  ? "bg-[--primary]/[0.06] text-[--primary] font-semibold"
                  : "text-[#6B6B64] hover:bg-[#F7F7F5] hover:text-[#1A1A1A]"
              }`}
            >
              <span>{localeFullLabels[loc]}</span>
              {loc === locale && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
