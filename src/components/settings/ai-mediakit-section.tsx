"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, ExternalLink, Sparkles } from "lucide-react";

/**
 * AI MediaKit（智能处理）独立配置区块。
 *
 * 火山引擎 AI MediaKit 是独立于即梦/Seedance 的 AI 多媒体开发套件，
 * 使用专属的 MediaKit API Key（Bearer Token 形式）鉴权。
 * 在 https://console.volcengine.com/imp/ai-mediakit/tools 的 API Key 管理页面获取。
 *
 * 密钥存储在 provider_secrets 表，providerId = "volcengine-ai-mediakit"。
 */

const PROVIDER_ID = "volcengine-ai-mediakit";

export function AiMediaKitSection() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/provider-secrets/${PROVIDER_ID}`);
        const data = (await res.json()) as { apiKey?: string; hasSecret?: boolean };
        if (!active) return;
        setApiKey(data.apiKey ?? "");
        setHasKey(!!data.apiKey);
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  async function handleSave() {
    if (!apiKey.trim()) {
      toast.error("请输入 API Key");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/provider-secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: PROVIDER_ID,
          apiKey: apiKey.trim(),
        }),
      });
      setHasKey(true);
      toast.success("AI MediaKit API Key 已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await apiFetch(`/api/provider-secrets/${PROVIDER_ID}`, { method: "DELETE" });
      setApiKey("");
      setHasKey(false);
      toast.success("AI MediaKit API Key 已清除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清除失败");
    }
  }

  return (
    <div className="rounded-2xl border border-[--border-subtle] bg-white p-5 space-y-4">
      {/* Section header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
            <Sparkles className="h-3.5 w-3.5" />
            AI MediaKit · 画质增强
          </h3>
          <p className="mt-1 text-xs text-[--text-muted] max-w-md">
            火山引擎智能处理套件，用于将 AI 生成视频超分至 1080p。
            独立于即梦/Seedance，需单独申请 MediaKit API Key。
          </p>
        </div>
        <a
          href="https://console.volcengine.com/imp/ai-mediakit/tools"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 flex items-center gap-1 rounded-lg border border-[--border-subtle] px-2.5 py-1.5 text-xs text-[--text-secondary] transition-colors hover:border-primary hover:text-primary"
        >
          <ExternalLink className="h-3 w-3" />
          控制台
        </a>
      </div>

      {/* API Key field */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">MediaKit API Key</Label>
          {hasKey && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
              已配置
            </span>
          )}
        </div>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={loading ? "" : apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={loading ? "加载中…" : "请输入 MediaKit API Key…"}
            disabled={loading}
            className="pr-10 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="text-[11px] text-[--text-muted]">
          在 AI MediaKit 控制台 → API Key 管理页面创建并复制。
          该 Key 仅用于画质增强服务，与其他提供商 Key 互相独立。
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-[--border-subtle] pt-3">
        <button
          onClick={handleDelete}
          disabled={loading || !hasKey}
          className="text-xs text-[--text-muted] transition-colors hover:text-destructive disabled:opacity-40"
        >
          清除 Key
        </button>
        <Button size="sm" onClick={handleSave} disabled={saving || loading}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          保存
        </Button>
      </div>
    </div>
  );
}
