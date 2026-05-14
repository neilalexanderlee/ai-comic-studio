"use client";

import { DefaultModelPicker } from "@/components/settings/default-model-picker";
import { ProviderSection } from "@/components/settings/provider-section";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, Zap, Type, ImageIcon, VideoIcon, Wand2, Shield, Copy, Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

const STORAGE_KEY = "ai_comic_uid";
const COOKIE_NAME = "ai_comic_uid";
const MAX_AGE_SEC = 365 * 24 * 60 * 60;

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1];
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();
  const [currentUid, setCurrentUid] = useState("");
  const [restoreInput, setRestoreInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");

  useEffect(() => {
    const uid = localStorage.getItem(STORAGE_KEY) || readCookie(COOKIE_NAME) || "";
    setCurrentUid(uid);
  }, []);

  function handleCopy() {
    if (!currentUid) return;
    void navigator.clipboard.writeText(currentUid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleRestore() {
    const uid = restoreInput.trim().replace(/-/g, "");
    if (!uid || uid.length < 16) {
      setRestoreMsg("无效的 Session ID，请检查后重试");
      return;
    }
    localStorage.setItem(STORAGE_KEY, uid);
    document.cookie = `${COOKIE_NAME}=${uid}; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax`;
    setRestoreMsg("已恢复，正在刷新页面…");
    setTimeout(() => router.refresh(), 800);
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-white/80 backdrop-blur-xl px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings className="h-3.5 w-3.5" />
            </div>
            <span className="font-display text-sm font-semibold text-[--text-primary]">
              {t("title")}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 bg-[--surface] p-4 lg:p-6">
        <div className="mx-auto max-w-4xl animate-page-in space-y-5">
          {/* Default model selection */}
          <div className="rounded-2xl border border-[--border-subtle] bg-white p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
              <Zap className="h-3.5 w-3.5" />
              {t("defaultModels")}
            </h3>
            <DefaultModelPicker />
          </div>

          {/* Prompt Templates link */}
          <Link
            href="/settings/prompts"
            className="flex items-center gap-3 rounded-2xl border border-[--border-subtle] bg-white p-5 transition-all duration-200 hover:border-[--border-hover] hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <div className="font-display text-sm font-semibold">{t("promptTemplates")}</div>
              <div className="text-xs text-[--text-muted]">{t("promptTemplatesDesc")}</div>
            </div>
          </Link>

          {/* Language Models section */}
          <ProviderSection
            capability="text"
            label={t("languageModels")}
            icon={<Type className="h-3.5 w-3.5" />}
            defaultProtocol="openai"
            defaultBaseUrl="https://api.openai.com"
          />

          {/* Image Models section */}
          <ProviderSection
            capability="image"
            label={t("imageModels")}
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            defaultProtocol="kling"
            defaultBaseUrl="https://api.klingai.com"
          />

          {/* Video Models section */}
          <ProviderSection
            capability="video"
            label={t("videoModels")}
            icon={<VideoIcon className="h-3.5 w-3.5" />}
            defaultProtocol="kling"
            defaultBaseUrl="https://api.klingai.com"
          />

          {/* Session Recovery */}
          <div className="rounded-2xl border border-[--border-subtle] bg-white p-5">
            <h3 className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
              <Shield className="h-3.5 w-3.5" />
              会话恢复 / Session Recovery
            </h3>
            <p className="mb-4 text-xs text-[--text-muted]">
              清除浏览器数据后，系统会自动识别并恢复你的数据。如果自动恢复失败，可以粘贴下方的 Session ID 手动恢复。
            </p>

            {/* Current Session ID */}
            <div className="mb-4">
              <div className="mb-1.5 text-xs font-medium text-[--text-secondary]">当前 Session ID</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-[--border-subtle] bg-[--surface] px-3 py-2 font-mono text-xs text-[--text-primary] select-all break-all">
                  {currentUid || "—"}
                </code>
                <button
                  onClick={handleCopy}
                  disabled={!currentUid}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[--border-subtle] bg-white text-[--text-muted] transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                  title="复制 Session ID"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[--text-muted]">
                建议将此 ID 保存到安全的地方，清除浏览器数据后可用于恢复所有项目和 API Key。
              </p>
            </div>

            {/* Restore input */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-[--text-secondary]">粘贴旧 Session ID 恢复</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={restoreInput}
                  onChange={(e) => setRestoreInput(e.target.value)}
                  placeholder="粘贴旧 Session ID…"
                  className="flex-1 rounded-lg border border-[--border-subtle] bg-[--surface] px-3 py-2 font-mono text-xs text-[--text-primary] placeholder:text-[--text-muted] outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                />
                <button
                  onClick={handleRestore}
                  disabled={!restoreInput.trim()}
                  className="flex items-center gap-1.5 rounded-lg border border-[--border-subtle] bg-white px-3 py-2 text-xs font-medium text-[--text-secondary] transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复
                </button>
              </div>
              {restoreMsg && (
                <p className="mt-1.5 text-[11px] text-amber-600">{restoreMsg}</p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
