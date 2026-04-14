"use client";

import { DefaultModelPicker } from "@/components/settings/default-model-picker";
import { ProviderSection } from "@/components/settings/provider-section";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, Zap, Type, ImageIcon, VideoIcon, Wand2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import Link from "next/link";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();

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
        <LanguageSwitcher />
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
        </div>
      </main>
    </div>
  );
}
